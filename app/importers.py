"""
Importers: turn the organizers' data into PatientProfile objects.

  load_vhs_dataset(path)    -> patients.jsonl from the Hugging Face dataset
  load_faculty_csv(path)    -> faculty-provided-sample-patient-details.csv
  vhs_record_to_profile()   -> the mapping itself (also reused by the Studio
                               generator: ask Claude for a VHS-shaped record,
                               then run it through this same function)

Nothing here knows about any specific patient.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from .schemas import (
    Artifact, ArtifactItem, ArtifactType, Disclosure, EncounterSettings,
    ExpectedDiscovery, Fact, FactCategory, FacultyBrief, LearningObjective,
    Medication, Origin, PatientProfile, Persona, ReleaseRule, ReleaseTrigger,
)

# --------------------------------------------------------------------------
# Reading the raw files
# --------------------------------------------------------------------------

def read_json_objects(text: str) -> list[dict]:
    """The HF file is called .jsonl but is actually pretty-printed objects
    back to back. This handles real JSONL, a JSON array, or concatenated objects."""
    dec = json.JSONDecoder()
    out, i, n = [], 0, len(text)
    while i < n:
        while i < n and text[i] in " \t\r\n,[]":
            i += 1
        if i >= n:
            break
        obj, i = dec.raw_decode(text, i)
        out.append(obj)
    return out


def normalize_keys(obj: Any) -> Any:
    """'Primary Diagnosis' / 'primary diagnosis' -> 'primary_diagnosis'."""
    if isinstance(obj, dict):
        return {re.sub(r"[\s\-]+", "_", k.strip().lower()): normalize_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [normalize_keys(v) for v in obj]
    return obj


def clean_csv_cell(s: str) -> str:
    s = (s or "").strip()
    while len(s) >= 2 and s[0] == s[-1] == '"':
        s = s[1:-1].strip()
    return s.replace("“", '"').replace("”", '"')


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    return [str(x).strip() for x in v if str(x).strip()]


def _str(v: Any) -> str:
    return "" if v is None else str(v).strip()


# --------------------------------------------------------------------------
# Small text helpers
# --------------------------------------------------------------------------

STOP = set("""a an the and or of to in on for with without his her he she him its it is are was
were be been being has have had do does did at by as from that this these those their them
they patient patients student students clinician will may can could would should about into
over under due very more most less some any not no only also than then there when what which
who how why own s t""".split())


def tokens(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z0-9]+", text.lower()):
        if w in STOP or len(w) < 3:
            continue
        for suf in ("ing", "ies", "es", "ed", "s"):
            if w.endswith(suf) and len(w) - len(suf) >= 4:
                w = w[: -len(suf)]
                break
        out.add(w)
    return out


def short_topic(text: str, limit: int = 60) -> str:
    t = re.sub(r"^(he|she|they|patient)\s+(may\s+)?(initially\s+)?", "", text.strip(), flags=re.I)
    return t if len(t) <= limit else t[: limit - 1].rsplit(" ", 1)[0] + "…"


def split_label_value(item: str) -> ArtifactItem:
    """'HbA1c: 8.9%' -> label/value. 'Total cholesterol 260 mg/dL' -> split at first digit."""
    item = item.strip()
    if ":" in item:
        label, value = item.split(":", 1)
    else:
        m = re.search(r"\d", item)
        label, value = (item[: m.start()], item[m.start():]) if m else (item, "")
    value = value.strip()
    flag = None
    low = value.lower()
    if re.search(r"\bhigh\b|elevated|\(h\)", low):
        flag = "H"
    elif re.search(r"\blow\b|\(l\)", low):
        flag = "L"
    return ArtifactItem(label=label.strip(" -"), value=value, flag=flag)


# Hidden-tier items that read like third-party records belong in the chart,
# not in the patient's mouth. Purely linguistic - no patient-specific logic.
RECORD_PREFIX = re.compile(
    r"^(medical records?|records?|chart|parent|mother|father|school nurse|nurse|"
    r"peer interviews?|(his|her|their) (hba1c|bmi|medical history|medication history|"
    r"social context|labs?|record))\b", re.I)


# --------------------------------------------------------------------------
# VHS record -> PatientProfile
# --------------------------------------------------------------------------

class _Ids:
    def __init__(self) -> None:
        self.f = 0
        self.a = 0

    def fact(self) -> str:
        self.f += 1
        return f"f{self.f:03d}"

    def art(self) -> str:
        self.a += 1
        return f"a{self.a:03d}"


def vhs_record_to_profile(
    record: dict,
    patient_id: Optional[str] = None,
    origin: Origin = Origin.dataset,
    faculty_brief: Optional[FacultyBrief] = None,
    portrait_path: Optional[str] = None,
) -> PatientProfile:
    r = normalize_keys(record)
    ov, demo = r.get("patient_overview", {}), r.get("demographics", {})
    clin, medp = r.get("clinical_profile", {}), r.get("medication_profile", {})
    nut, psy = r.get("nutrition_profile", {}), r.get("psychosocial_profile", {})
    disc, lo = r.get("information_disclosure", {}), r.get("learning_opportunities", {})
    meta = r.get("metadata", {})

    ids = _Ids()
    facts: list[Fact] = []
    artifacts: list[Artifact] = []

    def add(content: str, cat: FactCategory, disclosure: Disclosure, path: str,
            topic: Optional[str] = None, trust: Optional[int] = None, chart: bool = True) -> None:
        content = content.strip()
        if not content:
            return
        default_trust = {Disclosure.reluctant: 2, Disclosure.hidden: 3}.get(disclosure, 0)
        facts.append(Fact(
            id=ids.fact(), category=cat, topic=topic or short_topic(content), content=content,
            disclosure=disclosure, min_trust=default_trust if trust is None else trust,
            show_in_chart=chart, origin=origin, source_path=path))

    D, C = Disclosure, FactCategory

    # --- identity / social --------------------------------------------------
    for key, label in [("occupation", "occupation"), ("residence", "living situation"),
                       ("marital_status", "marital status"), ("education_level", "education"),
                       ("insurance", "insurance"), ("language", "language")]:
        v = _str(demo.get(key))
        if v:
            add(v, C.social, D.discoverable, f"demographics.{key}", topic=label)
    if _str(psy.get("support_system")):
        add(psy["support_system"], C.social, D.discoverable,
            "psychosocial_profile.support_system", topic="support system")

    # --- clinical -----------------------------------------------------------
    primary = _str(clin.get("primary_diagnosis"))
    secondary = _list(clin.get("secondary_diagnoses"))
    if primary:
        add(primary, C.diagnosis, D.initial, "clinical_profile.primary_diagnosis",
            topic="main diagnosis / reason for visit")
    for i, d in enumerate(secondary):
        add(d, C.diagnosis, D.discoverable, f"clinical_profile.secondary_diagnoses[{i}]",
            topic=f"other condition: {short_topic(d, 40)}")
    for i, h in enumerate(_list(clin.get("medical_history"))):
        add(h, C.history, D.discoverable, f"clinical_profile.medical_history[{i}]")
    for i, s in enumerate(_list(clin.get("current_symptoms"))):
        add(s, C.symptom, D.initial, f"clinical_profile.current_symptoms[{i}]",
            topic=f"symptom: {short_topic(s, 45)}")
    allergies = _list(clin.get("allergies"))
    if allergies:
        for i, a in enumerate(allergies):
            add(a, C.allergy, D.discoverable, f"clinical_profile.allergies[{i}]", topic="allergies")
    else:
        # explicit negative so the patient can truthfully say "no allergies"
        add("No known allergies", C.allergy, D.discoverable, "clinical_profile.allergies",
            topic="allergies")

    # --- medications --------------------------------------------------------
    meds: list[Medication] = []
    for i, m in enumerate(medp.get("medications") or []):
        if isinstance(m, str):
            m = {"name": m}
        med = Medication(**{k: _str(m.get(k)) for k in Medication.model_fields})
        meds.append(med)
        p = f"medication_profile.medications[{i}]"
        regimen = " ".join(x for x in [med.name, med.dose, med.frequency] if x)
        add(f"Takes {regimen}" + (f" for {med.purpose}" if med.purpose else ""),
            C.medication, D.discoverable, p, topic=f"medication: {med.name}")
        if med.adherence:
            add(f"{med.name} adherence: {med.adherence}", C.medication, D.discoverable,
                p + ".adherence", topic=f"how they take {med.name}", trust=1)
        if med.patient_concerns and med.patient_concerns.lower() not in ("none", "n/a"):
            add(f"About {med.name}: {med.patient_concerns}", C.medication, D.discoverable,
                p + ".patient_concerns", topic=f"concerns/side effects of {med.name}", trust=1)
    for i, s in enumerate(_list(medp.get("supplements_and_otc"))):
        add(f"Takes {s}", C.medication, D.discoverable,
            f"medication_profile.supplements_and_otc[{i}]", topic="supplements / OTC")

    # --- nutrition & lifestyle ---------------------------------------------
    for key, cat, label in [("dietary_pattern", C.nutrition, "usual diet"),
                            ("meal_pattern", C.nutrition, "meal timing / pattern"),
                            ("hydration", C.nutrition, "fluids / hydration"),
                            ("physical_activity", C.lifestyle, "physical activity"),
                            ("substance_use", C.lifestyle, "alcohol / tobacco / drugs"),
                            ("sleep", C.lifestyle, "sleep")]:
        v = _str(nut.get(key))
        if v:
            add(v, cat, D.discoverable, f"nutrition_profile.{key}", topic=label,
                trust=1 if key == "substance_use" else 0)
    for i, f in enumerate(_list(nut.get("food_preferences"))):
        add(f, C.nutrition, D.discoverable, f"nutrition_profile.food_preferences[{i}]",
            topic="food likes / preferences")
    for i, f in enumerate(_list(nut.get("foods_or_behaviors_to_explore"))):
        add(f, C.nutrition, D.discoverable, f"nutrition_profile.foods_or_behaviors_to_explore[{i}]",
            trust=1)

    # --- psychosocial -------------------------------------------------------
    for key, disclosure, trust in [("goals", D.discoverable, 0), ("motivations", D.discoverable, 0),
                                   ("strengths", D.discoverable, 0), ("beliefs", D.discoverable, 1),
                                   ("concerns", D.discoverable, 1), ("barriers", D.discoverable, 1),
                                   ("fears", D.reluctant, 2)]:
        for i, v in enumerate(_list(psy.get(key))):
            add(v, C.psychosocial, disclosure, f"psychosocial_profile.{key}[{i}]",
                topic=f"{key[:-1] if key.endswith('s') else key}: {short_topic(v, 45)}", trust=trust)

    # --- the dataset's own disclosure tiers --------------------------------
    record_notes: list[str] = []
    for tier, disclosure in [("initial_information", D.initial),
                             ("discoverable_information", D.discoverable),
                             ("reluctant_information", D.reluctant),
                             ("hidden_information", D.hidden)]:
        for i, v in enumerate(_list(disc.get(tier))):
            path = f"information_disclosure.{tier}[{i}]"
            if disclosure is D.hidden and RECORD_PREFIX.match(v):
                record_notes.append(v)
                add(v, C.history, D.chart, path, topic="prior record")
            else:
                add(v, C.other, disclosure, path)

    # --- artifacts ----------------------------------------------------------
    def artifact(atype: ArtifactType, title: str, rows: list[str], trigger: ReleaseTrigger,
                 keywords: list[str]) -> None:
        if rows:
            artifacts.append(Artifact(
                id=ids.art(), type=atype, title=title,
                items=[split_label_value(x) for x in rows],
                release=ReleaseRule(trigger=trigger, request_keywords=keywords), origin=origin))

    referral = ([f"Primary diagnosis: {primary}"] if primary else []) + \
               [f"Secondary diagnosis: {d}" for d in secondary] + \
               [f"Medication: {m.name} {m.dose} {m.frequency}".strip() for m in meds] + \
               [f"Allergies: {', '.join(allergies) if allergies else 'NKA'}"]
    artifact(ArtifactType.prior_note, "Referral summary", referral, ReleaseTrigger.at_start, [])
    artifact(ArtifactType.vitals, "Vital signs", _list(clin.get("vital_signs")),
             ReleaseTrigger.on_request, ["vitals", "blood pressure", "heart rate", "temperature"])
    artifact(ArtifactType.anthropometrics, "Anthropometrics", _list(clin.get("anthropometrics")),
             ReleaseTrigger.on_request, ["weight", "height", "BMI", "measurements", "waist"])
    artifact(ArtifactType.lab_report, "Laboratory results", _list(clin.get("laboratory_data")),
             ReleaseTrigger.on_request, ["labs", "bloodwork", "blood test", "A1c", "cholesterol", "glucose"])
    artifact(ArtifactType.other, "Clinical findings", _list(clin.get("clinical_findings")),
             ReleaseTrigger.on_request, ["exam", "findings", "physical exam"])
    if record_notes:
        artifacts.append(Artifact(
            id=ids.art(), type=ArtifactType.prior_note, title="Prior records & collateral",
            text="\n".join(f"- {x}" for x in record_notes),
            release=ReleaseRule(trigger=ReleaseTrigger.on_request,
                                request_keywords=["records", "prior notes", "chart", "history", "previous visits"]),
            origin=origin))

    # --- learning objectives -----------------------------------------------
    objectives = []
    for i, o in enumerate(lo.get("opportunities") or [], start=1):
        oid = f"o{i}"
        discoveries = [
            ExpectedDiscovery(id=f"{oid}.d{j}", text=t, **_link(t, facts))
            for j, t in enumerate(_list(o.get("expected_discoveries")), start=1)
        ]
        objectives.append(LearningObjective(
            id=oid, objective=_str(o.get("learning_objective")),
            expected_discoveries=discoveries,
            possible_patient_reactions=_list(o.get("possible_patient_reactions")),
            min_level=_str(o.get("min_level")) or None))

    name = _str(ov.get("name")) or "Unnamed patient"
    return PatientProfile(
        id=patient_id or slugify(name),
        persona=Persona(
            name=name, age=ov.get("age"), sex=_str(ov.get("sex")) or None,
            description=_str(ov.get("description")), keywords=_list(ov.get("keywords")),
            occupation=_str(demo.get("occupation")), residence=_str(demo.get("residence")),
            ethnicity=_str(demo.get("ethnicity")), language=_str(demo.get("language")),
            marital_status=_str(demo.get("marital_status")) or None,
            education_level=_str(demo.get("education_level")), insurance=_str(demo.get("insurance")),
            cultural_context=_str(demo.get("cultural_context")),
            personality=_str(psy.get("personality")),
            communication_style=_str(psy.get("communication_style")),
            support_system=_str(psy.get("support_system")),
            readiness_to_change=_str(psy.get("readiness_to_change")),
            portrait_path=portrait_path),
        settings=EncounterSettings(),
        faculty_brief=faculty_brief,
        primary_diagnosis=primary, secondary_diagnoses=secondary,
        medications=meds, allergies=allergies,
        facts=facts, artifacts=artifacts, objectives=objectives,
        assumptions=_list(meta.get("assumptions")),
        optional_details=_list(meta.get("optional_details")),
    )


def _link(text: str, facts: list[Fact], threshold: float = 0.34, top: int = 3) -> dict:
    """Cheap first-pass link from an expected discovery to the facts that satisfy it.
    Marked 'lexical' so the Studio shows it for review; the LLM generator or faculty
    can replace it with better links."""
    t = tokens(text)
    if not t:
        return {"linked_fact_ids": [], "link_method": "none"}
    scored = []
    for f in facts:
        ft = tokens(f.content + " " + f.topic)
        if ft:
            s = len(t & ft) / len(t)
            if s >= threshold:
                scored.append((s, f.id))
    scored.sort(reverse=True)
    ids_ = [fid for _, fid in scored[:top]]
    return {"linked_fact_ids": ids_, "link_method": "lexical" if ids_ else "none"}


# --------------------------------------------------------------------------
# Faculty CSV
# --------------------------------------------------------------------------

def load_faculty_csv(path: str | Path) -> dict[str, dict]:
    """Returns {normalised_name: {"uuid", "brief": FacultyBrief, "row": {...}}}."""
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for raw in csv.DictReader(fh):
            row = {re.sub(r"[^a-z]+", "_", k.lower()).strip("_"): clean_csv_cell(v)
                   for k, v in raw.items() if k}
            name = row.get("patient_name", "")
            out[name_key(name)] = {
                "uuid": row.get("patient_uuid"),
                "brief": FacultyBrief(background=row.get("background", ""), notes=row.get("notes", ""),
                                      personality=row.get("personality", ""), summary=row.get("summary", "")),
                "row": row,
            }
    return out


def name_key(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower())


def match_portrait(name: str, image_dir: Optional[Path]) -> Optional[Path]:
    """Image files are named 'Wyatt Nelson, Patient.png', 'Vadko Bareche patient.png'...
    Match on surname, then first name."""
    if not image_dir or not image_dir.exists():
        return None
    files = [p for p in image_dir.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg")]
    parts = [p.lower() for p in name.split()]
    for part in reversed(parts):  # surname first
        hits = [f for f in files if part in f.name.lower()]
        if len(hits) == 1:
            return hits[0]
    return None


def load_vhs_dataset(path: str | Path, faculty_csv: Optional[str | Path] = None,
                     image_dir: Optional[str | Path] = None) -> list[PatientProfile]:
    records = read_json_objects(Path(path).read_text(encoding="utf-8"))
    briefs = load_faculty_csv(faculty_csv) if faculty_csv else {}
    imgs = Path(image_dir) if image_dir else None
    profiles = []
    for rec in records:
        name = _str(normalize_keys(rec).get("patient_overview", {}).get("name"))
        b = briefs.get(name_key(name), {})
        portrait = match_portrait(name, imgs)
        pid = b.get("uuid") or slugify(name)
        profiles.append(vhs_record_to_profile(
            rec, patient_id=pid, faculty_brief=b.get("brief"),
            portrait_path=f"portraits/{pid}{portrait.suffix.lower()}" if portrait else None))
    return profiles


def iter_router_preview(p: PatientProfile) -> Iterable[str]:
    for f in p.router_index():
        yield f"{f['id']}  [{f['category']}]  {f['topic']}"
