"""
Deterministic consistency checks for a PatientProfile (no LLM needed).

These run first in POST /patients/{id}/validate; the LLM contradiction pass
runs after and catches what rules can't. Every check is generic - it reads
whatever profile it's given.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Optional

from pydantic import BaseModel

from .importers import tokens
from .schemas import ArtifactType, Disclosure, PatientProfile


class Issue(BaseModel):
    severity: str          # "error" | "warning" | "info"
    code: str
    message: str
    refs: list[str] = []   # fact / artifact / objective ids the Studio can jump to


# Medication -> words that should appear somewhere in diagnoses/history.
# Clinical knowledge table, not patient data; extend as needed.
MED_INDICATIONS: dict[str, list[str]] = {
    "metformin": ["diabetes", "prediabetes", "insulin resistance", "pcos", "metabolic"],
    "glipizide": ["diabetes"], "glyburide": ["diabetes"], "glimepiride": ["diabetes"],
    "insulin": ["diabetes"], "semaglutide": ["diabetes", "obesity"], "empagliflozin": ["diabetes", "heart failure", "kidney"],
    "lisinopril": ["hypertension", "heart failure", "kidney", "blood pressure"],
    "losartan": ["hypertension", "heart failure", "kidney", "blood pressure"],
    "amlodipine": ["hypertension", "blood pressure", "angina"],
    "hydrochlorothiazide": ["hypertension", "blood pressure", "edema"],
    "furosemide": ["heart failure", "edema", "kidney"],
    "carvedilol": ["heart failure", "hypertension"], "metoprolol": ["heart failure", "hypertension", "coronary", "arrhythmia", "atrial"],
    "spironolactone": ["heart failure", "hypertension"],
    "atorvastatin": ["dyslipidemia", "cholesterol", "hyperlipidemia", "coronary", "cardiovascular"],
    "rosuvastatin": ["dyslipidemia", "cholesterol", "hyperlipidemia", "coronary", "cardiovascular"],
    "simvastatin": ["dyslipidemia", "cholesterol", "hyperlipidemia", "coronary", "cardiovascular"],
    "aspirin": ["coronary", "cardiovascular", "stroke", "cabg", "artery"],
    "levothyroxine": ["hypothyroid", "thyroid"],
    "sertraline": ["depress", "anxiety", "ptsd"], "escitalopram": ["depress", "anxiety"],
}


def _num(s: str) -> Optional[float]:
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def _height_m(s: str) -> Optional[float]:
    if m := re.search(r"(\d+)\s*'\s*(\d+(?:\.\d+)?)?", s):
        return (int(m.group(1)) * 12 + float(m.group(2) or 0)) * 0.0254
    if m := re.search(r"(\d+(?:\.\d+)?)\s*cm", s, re.I):
        return float(m.group(1)) / 100
    return None


def _weight_kg(s: str) -> Optional[float]:
    if m := re.search(r"(\d+(?:\.\d+)?)\s*(lb|lbs|pounds)", s, re.I):
        return float(m.group(1)) * 0.453592
    if m := re.search(r"(\d+(?:\.\d+)?)\s*kg", s, re.I):
        return float(m.group(1))
    return None


def _all_rows(p: PatientProfile):
    """(ref, label, value) for every artifact row."""
    for a in p.artifacts:
        for i, it in enumerate(a.items):
            yield f"{a.id}#{i}", it.label, it.value, a


def check_bmi(p: PatientProfile) -> list[Issue]:
    issues: list[Issue] = []
    height = weight = None
    stated: list[tuple[str, float, str]] = []
    for ref, label, value, _ in _all_rows(p):
        lab = label.lower()
        if lab.startswith("height"):
            height = height or _height_m(value)
        elif lab.startswith("weight") and "change" not in lab:
            weight = weight or _weight_kg(value)
        elif (lab == "bmi" or lab.startswith("bmi ")) and "category" not in lab:
            if (v := _num(value)) is not None:
                stated.append((ref, v, value))
    for f in p.facts:  # e.g. "BMI 32 kg/m2" in findings or hidden info
        if m := re.search(r"\bBMI(?: is| of)?\s*:?\s*(\d+(?:\.\d+)?)", f.content, re.I):
            stated.append((f.id, float(m.group(1)), f.content))

    if height and weight:
        bmi = weight / height ** 2
        bad = [s for s in stated if abs(s[1] - bmi) > 0.6]
        if bad:
            issues.append(Issue(
                severity="error", code="bmi_mismatch",
                message=(f"Height and weight give BMI {bmi:.1f}, but the profile states "
                         + ", ".join(sorted({f'{v:g}' for _, v, _ in bad})) + "."),
                refs=sorted({r for r, _, _ in bad})))
    mislabelled = defaultdict(list)
    for ref, v, text in stated:
        if "underweight" in text.lower() and v >= 18.5:
            mislabelled[v].append(ref)
    for v, refs in mislabelled.items():
        issues.append(Issue(severity="warning", code="bmi_category",
                            message=f"BMI {v:g} is labelled underweight, but underweight is < 18.5.",
                            refs=refs))
    return issues


def check_med_indications(p: PatientProfile) -> list[Issue]:
    context = " ".join([p.primary_diagnosis, *p.secondary_diagnoses,
                        *[f.content for f in p.facts if f.category.value in ("history", "diagnosis")]]).lower()
    issues = []
    for m in p.medications:
        key = next((k for k in MED_INDICATIONS if k in m.name.lower()), None)
        if key and not any(w in context for w in MED_INDICATIONS[key]):
            issues.append(Issue(
                severity="warning", code="med_without_indication",
                message=f"{m.name} is listed but no matching condition "
                        f"({', '.join(MED_INDICATIONS[key][:3])}...) appears in diagnoses or history."))
    return issues


def check_duplicates(p: PatientProfile) -> list[Issue]:
    seen: dict[str, list[str]] = defaultdict(list)
    for f in p.facts:
        seen[re.sub(r"\W+", " ", f.content.lower()).strip()].append(f.id)
    issues = []
    for text, ids_ in seen.items():
        if len(ids_) > 1:
            tiers = {p.fact(i).disclosure.value for i in ids_}
            msg = f"Duplicate fact “{p.fact(ids_[0]).content[:70]}”"
            if len(tiers) > 1:
                msg += f" appears in conflicting disclosure tiers ({', '.join(sorted(tiers))})."
            else:
                msg += " appears more than once."
            issues.append(Issue(severity="warning", code="duplicate_fact", message=msg, refs=ids_))
    for a in p.artifacts:
        rows = [re.sub(r"\W+", " ", f"{i.label} {i.value}".lower()) for i in a.items]
        dupes = {r for r in rows if rows.count(r) > 1}
        if dupes:
            issues.append(Issue(severity="info", code="duplicate_row",
                                message=f"{a.title} has repeated rows.", refs=[a.id]))
    return issues


def check_vitals_agree(p: PatientProfile) -> list[Issue]:
    bp: dict[str, set[str]] = defaultdict(set)
    for ref, label, value, _ in _all_rows(p):
        if m := re.search(r"(\d{2,3})\s*/\s*(\d{2,3})", value):
            if "bp" in label.lower() or "blood pressure" in label.lower():
                bp[f"{m.group(1)}/{m.group(2)}"].add(ref)
    if len(bp) > 1:
        return [Issue(severity="warning", code="vitals_conflict",
                      message="Blood pressure differs between records: " + ", ".join(sorted(bp)),
                      refs=sorted({r for refs in bp.values() for r in refs}))]
    return []


def check_misplaced_rows(p: PatientProfile) -> list[Issue]:
    issues = []
    for a in p.artifacts:
        if a.type == ArtifactType.lab_report:
            for i, it in enumerate(a.items):
                if re.match(r"bmi|weight|height|blood pressure|bp\b", it.label, re.I):
                    issues.append(Issue(severity="info", code="misplaced_row",
                                        message=f"“{it.label}” is not a lab value; move it to vitals/anthropometrics.",
                                        refs=[f"{a.id}#{i}"]))
    return issues


def check_objectives(p: PatientProfile) -> list[Issue]:
    issues = []
    if not p.objectives:
        issues.append(Issue(severity="error", code="no_objectives",
                            message="No learning objectives: feedback has nothing to grade against."))
    unlinked = [d.id for o in p.objectives for d in o.expected_discoveries if not d.linked_fact_ids]
    if unlinked:
        issues.append(Issue(severity="info", code="unlinked_discoveries",
                            message=f"{len(unlinked)} expected discoveries are not linked to any fact; "
                                    "they will be graded from the transcript only.",
                            refs=unlinked))
    return issues


FILLER = {"young", "adult", "newly", "diagnosed", "recent", "recently", "history", "occasional",
          "user", "mild", "chronic", "stage", "nyha", "uncontrolled", "poorly", "controlled"}


def check_faculty_drift(p: PatientProfile) -> list[Issue]:
    """Every condition faculty wrote in their summary must survive into the profile.
    Searches facts only (not the free-text description, which can mention a
    dropped diagnosis while explaining why it was dropped)."""
    if not p.faculty_brief or not p.faculty_brief.summary:
        return []
    corpus = " ".join([
        p.primary_diagnosis, *p.secondary_diagnoses, *[f.content for f in p.facts],
        *[o.objective + " " + " ".join(d.text for d in o.expected_discoveries) for o in p.objectives],
        *p.assumptions]).lower()
    prefixes = {w[:4] for w in re.findall(r"[a-z]+", corpus) if len(w) >= 4}

    def present(w: str) -> bool:
        if w.isupper() and len(w) <= 4:          # MS, HF, CKD: whole-word match only
            return bool(re.search(rf"\b{re.escape(w)}\b", corpus, re.I))
        return w.lower()[:4] in prefixes          # smoker~smoking, recovering~recovery

    missing = []
    for term in re.split(r",|;|\band\b|\bwith\b", p.faculty_brief.summary, flags=re.I):
        raw = term.strip()
        key = [w for w in re.findall(r"[A-Za-z]+", raw)
               if w.lower() not in FILLER and (tokens(w) or (w.isupper() and len(w) >= 2))]
        if not key:
            continue
        # most of the term's content words must survive ("alcohol abuse" ~ "alcohol use disorder")
        if sum(present(w) for w in key) / len(key) < 0.5:
            missing.append(raw)
    if missing:
        return [Issue(severity="error", code="faculty_drift",
                      message="Faculty summary mentions " + "; ".join(f"“{m}”" for m in missing)
                              + " but the profile does not contain it.")]
    return []


FACULTY_NUM = re.compile(r"\d+(?:\.\d+)?(?:/\d+)?")


def check_faculty_numbers(p: PatientProfile) -> list[Issue]:
    """Every number faculty typed in notes/summary (LDL 145, BP 155/110, BMI 32) must appear
    in the profile. Small rounding is fine (32 vs 32.1). Ages and ranges are skipped."""
    if not p.faculty_brief:
        return []
    src = " ".join([p.faculty_brief.notes, p.faculty_brief.summary])
    src = re.sub(r"\d+\s*-\s*\d+", " ", src)                    # ranges like "2-8 drinks"
    wanted = [n for n in FACULTY_NUM.findall(src) if n != str(p.persona.age or "")]
    corpus = " ".join([*(f.content for f in p.facts),
                       *(f"{i.label} {i.value}" for a in p.artifacts for i in a.items),
                       *((a.text or "") for a in p.artifacts)])
    have = FACULTY_NUM.findall(corpus)
    have_set = set(have)

    def close(n: str) -> bool:
        if n in have_set:
            return True
        if "/" in n:
            return False
        try:
            v = float(n)
        except ValueError:
            return False
        return any("/" not in h and abs(float(h) - v) <= 0.5 for h in have)

    missing = sorted({n for n in wanted if not close(n)}, key=lambda x: float(x.split("/")[0]))
    if missing:
        return [Issue(severity="error", code="faculty_number_missing",
                      message="Faculty wrote " + ", ".join(missing) +
                              " but the profile doesn't contain " + ("it." if len(missing) == 1 else "them."))]
    return []


def check_disclosure_balance(p: PatientProfile) -> list[Issue]:
    tiers = defaultdict(int)
    for f in p.facts:
        tiers[f.disclosure] += 1
    issues = []
    if not tiers[Disclosure.initial]:
        issues.append(Issue(severity="warning", code="no_opening",
                            message="Nothing is marked 'initial': the patient has no chief complaint to open with."))
    if not (tiers[Disclosure.reluctant] + tiers[Disclosure.hidden]):
        issues.append(Issue(severity="info", code="no_reluctant",
                            message="No reluctant or hidden facts: rapport will not change what the student learns."))
    return issues


CHECKS = [check_faculty_drift, check_faculty_numbers, check_bmi, check_med_indications, check_vitals_agree,
          check_duplicates, check_misplaced_rows, check_objectives,
          check_disclosure_balance]


def validate(p: PatientProfile) -> list[Issue]:
    issues: list[Issue] = []
    for check in CHECKS:
        issues.extend(check(p))
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(issues, key=lambda i: order[i.severity])
