"""
Studio generator: faculty input (+ uploaded documents) -> full PatientProfile.

    generate_profile(FacultyInput, documents, llm) -> (PatientProfile, issues)

Pipeline
 1. Patient-record documents (lab reports, prior notes) are given to Claude IN FULL:
    they are faculty-provided truth about this patient.
 2. Reference documents (guidelines, syllabus) are searched with RAG for passages
    relevant to the case; those passages shape the learning objectives.
 3. One smart-model call writes a record in the organizers' VHS format (the same
    format as patients.jsonl), with Wyatt's record as the example.
 4. The record goes through the SAME importer as the seed patients -> ids,
    disclosure tiers, chart artifacts. No separate code path for new patients.
 5. Facts that match what faculty typed or uploaded are marked origin=faculty;
    everything else is origin=generated and highlighted for review.
 6. Objectives are linked to facts, rules run, and the draft goes back to the Studio.
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from .. import levels
from ..bedrock import LLM, smart_model
from ..importers import read_json_objects, slugify, tokens, vhs_record_to_profile
from ..linking import link_objectives
from ..rules import Issue, validate
from ..schemas import (
    Artifact, ArtifactType, DocumentKind, EncounterSettings, FacultyBrief, Origin,
    PatientProfile, ReleaseRule, ReleaseTrigger, SourceDocument,
)
from .rag import KnowledgeIndex

DATA = Path(__file__).resolve().parents[2] / "data"
EXAMPLE_NAME = "Wyatt Nelson"


class FacultyInput(BaseModel):
    """What the Studio's quick-create form sends. Mirrors the faculty CSV columns,
    plus who the student is. Only `name` is required."""
    name: str
    age: Optional[int] = None
    gender: str = ""
    ethnicity: str = ""
    background: str = ""
    personality: str = ""
    notes: str = ""                 # the clinical heart of it: numbers, meds, history
    summary: str = ""               # main diagnoses / topic, e.g. "Hypertension, obesity"
    student_role: str = "Dietetics student"
    encounter_goal: str = ""
    setting: str = ""
    portrait_path: Optional[str] = None


# --------------------------------------------------------------------------
# Output schema for the LLM (the VHS record shape, kept loose on purpose)
# --------------------------------------------------------------------------

S = {"type": "string"}
L = {"type": "array", "items": {"type": "string"}}


def _obj(props: dict, required: Optional[list[str]] = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props)}


def record_schema() -> dict:
    lv = levels.level_names()
    return _obj({
        "patient_overview": _obj({"name": S, "age": {"type": "integer"}, "sex": S,
                                  "description": S, "keywords": L}),
        "demographics": _obj({k: S for k in ["occupation", "residence", "ethnicity", "language",
                                             "marital_status", "education_level", "insurance",
                                             "cultural_context"]}),
        "clinical_profile": _obj({"primary_diagnosis": S, "secondary_diagnoses": L, "medical_history": L,
                                  "current_symptoms": L, "allergies": L, "clinical_findings": L,
                                  "laboratory_data": L, "vital_signs": L, "anthropometrics": L}),
        "medication_profile": _obj({
            "medications": {"type": "array", "items": _obj({k: S for k in [
                "name", "dose", "frequency", "purpose", "adherence", "patient_concerns"]})},
            "supplements_and_otc": L}),
        "nutrition_profile": _obj({"dietary_pattern": S, "food_preferences": L,
                                   "foods_or_behaviors_to_explore": L, "meal_pattern": S, "hydration": S,
                                   "physical_activity": S, "substance_use": S, "sleep": S}),
        "psychosocial_profile": _obj({"personality": S, "communication_style": S, "goals": L,
                                      "concerns": L, "beliefs": L, "motivations": L, "fears": L,
                                      "barriers": L, "strengths": L, "support_system": S,
                                      "readiness_to_change": S}),
        "information_disclosure": _obj({"initial_information": L, "discoverable_information": L,
                                        "reluctant_information": L, "hidden_information": L}),
        "learning_opportunities": _obj({"opportunities": {"type": "array", "items": _obj({
            "learning_objective": S, "expected_discoveries": L, "possible_patient_reactions": L,
            "min_level": {"type": "string", "enum": lv,
                          "description": "Lowest year level at which this objective is graded"},
        })}}),
        "metadata": _obj({"assumptions": L, "optional_details": L}),
    })


SYSTEM = """You are a clinical educator building a virtual standardized patient for health-professions students.
You turn a faculty member's short description (and any patient documents) into one complete, internally
consistent patient record in the exact JSON structure of the example.

ABSOLUTE RULES
1. Faculty information is ground truth. Copy every number, diagnosis, medication, dose, and history item from
   the FACULTY INPUT and PATIENT DOCUMENTS exactly, with the same values and units. Never drop, rename or
   "correct" a condition faculty wrote, even if it seems unusual. If something faculty wrote seems clinically
   inconsistent, keep it and explain the concern in metadata.assumptions.
2. Fill gaps with plausible, conservative details that fit the faculty information: labs consistent with the
   diagnoses, vitals, and anthropometrics where BMI equals weight/height^2. Don't add major diagnoses faculty
   didn't mention unless they are a direct, common consequence; list every invented clinical detail in
   metadata.assumptions.
3. information_disclosure:
   - initial_information: what the patient says early unprompted (chief concern, obvious symptoms).
   - discoverable_information: what they share when asked about the topic.
   - reluctant_information: embarrassing or sensitive things they share only once they trust the student.
   - hidden_information: things the patient won't say. Write record-type items as "Medical records show ...",
     "Prior note documents ...", "Parent reports ..." so they appear in the chart instead of in conversation.
4. learning_opportunities: 4-6 objectives appropriate to the STUDENT ROLE and ENCOUNTER GOAL, each with
   3-5 concrete expected_discoveries (things the student should find out from this patient) and
   possible_patient_reactions. Set min_level: basic history and rapport objectives at M1; deeper assessment
   at M2; integrated reasoning, plans and coordination at M3 or M4. Use REFERENCE EXCERPTS when relevant.
5. The personality and communication style must reflect the faculty's description, and the patient should be
   realistic, not a caricature. Avoid stereotypes about culture, ethnicity or socioeconomic status.
6. Write lists as short, specific, plain-English items. No markdown."""


def _example_record() -> str:
    try:
        recs = read_json_objects((DATA / "patients.jsonl").read_text(encoding="utf-8"))
        ex = next(r for r in recs if r.get("patient_overview", {}).get("name") == EXAMPLE_NAME)
        return json.dumps(ex, indent=1)
    except (OSError, StopIteration):
        return "(example unavailable)"


def _faculty_text(fi: FacultyInput) -> str:
    rows = [("Name", fi.name), ("Age", fi.age), ("Gender", fi.gender), ("Race/ethnicity", fi.ethnicity),
            ("Background", fi.background), ("Personality", fi.personality),
            ("Clinical notes", fi.notes), ("Summary / main problems", fi.summary)]
    return "\n".join(f"{k}: {v}" for k, v in rows if v not in (None, ""))


def build_prompt(fi: FacultyInput, patient_docs: list[SourceDocument], reference_ctx: str) -> str:
    docs = "\n\n".join(
        f"--- {d.name}{f' ({d.doc_type})' if d.doc_type else ''} ---\n"
        f"{f'Faculty note: {d.summary}' + chr(10) if d.summary and d.summary != d.text else ''}{d.text[:15000]}"
        for d in patient_docs) or "(none)"
    return f"""STUDENT ROLE: {fi.student_role}
ENCOUNTER GOAL: {fi.encounter_goal or 'Patient interview and counseling appropriate to the student role'}
SETTING: {fi.setting or 'Outpatient clinic'}

FACULTY INPUT (ground truth):
{_faculty_text(fi)}

PATIENT DOCUMENTS (ground truth about this patient):
{docs}

REFERENCE EXCERPTS (guidelines/curriculum; use for objectives and realistic values, never as patient facts):
{reference_ctx or '(none)'}

EXAMPLE RECORD (follow this structure and level of detail, NOT its content):
{_example_record()}

Write the complete record for the patient described in FACULTY INPUT."""


# --------------------------------------------------------------------------
# Origin marking: which facts came from faculty?
# --------------------------------------------------------------------------

NUM = re.compile(r"\d+(?:\.\d+)?(?:/\d+)?")


def _faculty_corpus(fi: FacultyInput, patient_docs: list[SourceDocument]) -> str:
    return " ".join([fi.background, fi.notes, fi.summary, *(d.text for d in patient_docs)]).lower()


def mark_origins(profile: PatientProfile, corpus: str) -> PatientProfile:
    """origin=faculty when a fact repeats a faculty number, or mostly repeats faculty wording."""
    corpus_nums = set(NUM.findall(corpus))
    corpus_toks = tokens(corpus)
    for f in profile.facts:
        nums = set(NUM.findall(f.content))
        ft = tokens(f.content)
        overlap = len(ft & corpus_toks) / len(ft) if ft else 0.0
        if (nums and nums & corpus_nums and overlap >= 0.3) or overlap >= 0.75:
            f.origin = Origin.faculty
        else:
            f.origin = Origin.generated
    for a in profile.artifacts:
        vals = [set(NUM.findall(i.value)) for i in a.items if NUM.search(i.value)]
        if vals and sum(bool(v & corpus_nums) for v in vals) / len(vals) >= 0.5:
            a.origin = Origin.faculty
        else:
            a.origin = Origin.generated
    return profile


# Faculty document labels (Studio upload form). Reference types never become chart items.
DOC_TYPE_TO_ARTIFACT = {
    "lab_report": ArtifactType.lab_report, "imaging": ArtifactType.imaging, "ecg": ArtifactType.ecg,
    "prior_note": ArtifactType.prior_note,
    "medication_list": ArtifactType.prior_note, "other_record": ArtifactType.other,
}
DOC_TYPE_LABEL = {
    "lab_report": "Lab report", "imaging": "Imaging", "ecg": "ECG",
    "prior_note": "Prior note", "medication_list": "Medication list", "other_record": "Record",
}
REFERENCE_DOC_TYPES = {"guideline", "syllabus", "reference"}


def _is_image(file_path) -> bool:
    return bool(file_path) and Path(str(file_path)).suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _document_artifacts(profile: PatientProfile, patient_docs: list[SourceDocument]) -> None:
    """Every uploaded patient document also becomes a chart item the student can open."""
    n = len(profile.artifacts)
    for d in patient_docs:
        n += 1
        low = d.name.lower()
        atype = DOC_TYPE_TO_ARTIFACT.get(d.doc_type) or (
                 ArtifactType.ecg if "ecg" in low or "ekg" in low else
                 ArtifactType.imaging if any(w in low for w in ("xray", "x-ray", "ct", "mri", "scan")) else
                 ArtifactType.lab_report if any(w in low for w in ("lab", "cbc", "panel", "blood")) else
                 ArtifactType.prior_note)
        title = Path(d.name).stem.replace("_", " ")
        label = DOC_TYPE_LABEL.get(d.doc_type, "")
        if label and label.split()[0].lower() not in title.lower():   # e.g. "Imaging: chest film"
            title = f"{label}: {title}"
        profile.artifacts.append(Artifact(
            id=f"a{n:03d}", type=atype, title=title,
            text=None if _is_image(d.file_path) else d.text[:8000], file_path=d.file_path, origin=Origin.faculty,
            release=ReleaseRule(trigger=ReleaseTrigger.on_request,
                                request_keywords=[atype.value.replace("_", " "), Path(d.name).stem])))


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------

def generate_profile(fi: FacultyInput, documents: list[SourceDocument], llm: LLM,
                     model: Optional[str] = None, link: bool = True,
                     patient_id: Optional[str] = None) -> tuple[PatientProfile, list[Issue]]:
    model = model or smart_model()
    patient_docs = [d for d in documents if d.kind == DocumentKind.patient_record]
    reference = [d for d in documents if d.kind == DocumentKind.reference]

    ref_ctx = ""
    if reference:
        idx = KnowledgeIndex(reference)
        query = " ".join([fi.summary, fi.notes, fi.student_role, fi.encounter_goal])
        ref_ctx = idx.context(query, k=6, max_chars=6000)

    record = llm.call_json(model=model, system=SYSTEM, schema=record_schema(), tool_name="patient_record",
                           user=build_prompt(fi, patient_docs, ref_ctx), max_tokens=8000)

    # identity fields are always exactly what faculty typed
    ov = record.setdefault("patient_overview", {})
    ov["name"] = fi.name
    if fi.age is not None:
        ov["age"] = fi.age
    if fi.gender:
        ov["sex"] = fi.gender
    if fi.ethnicity:
        record.setdefault("demographics", {})["ethnicity"] = fi.ethnicity

    brief = FacultyBrief(background=fi.background, notes=fi.notes,
                         personality=fi.personality, summary=fi.summary)
    pid = patient_id or f"{slugify(fi.name)}-{uuid.uuid4().hex[:6]}"
    profile = vhs_record_to_profile(record, patient_id=pid, origin=Origin.generated,
                                    faculty_brief=brief, portrait_path=fi.portrait_path)
    profile.settings = EncounterSettings(
        student_role=fi.student_role,
        encounter_goal=fi.encounter_goal or EncounterSettings().encounter_goal,
        setting=fi.setting or EncounterSettings().setting)
    profile.documents = list(documents)
    _document_artifacts(profile, patient_docs)
    mark_origins(profile, _faculty_corpus(fi, patient_docs))

    if link:
        link_objectives(profile, llm, model=model)
    return profile, validate(profile)
