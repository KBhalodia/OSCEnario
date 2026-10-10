"""
Patient profile schema for the Virtual Patient Encounter system.

Structure follows the organizers' VHS dataset
(huggingface.co/datasets/joeljames270/virtual-patient-profiles-sample),
so judges recognise it, plus what the encounter engine needs on top:
  - an id on every fact, so disclosure can be tracked and objectives linked
  - a disclosure tier + origin on every fact
  - artifacts (labs, vitals, notes, images) with release rules
  - encounter settings (student role, rubric)

Rule of thumb: NOTHING here is patient-specific. Every field except the
patient's name is optional, because a judge typing a patient live will
only fill in a few of them; the Studio generator fills the rest.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------

class Disclosure(str, Enum):
    """How a fact reaches the student. Mirrors the dataset's four tiers."""
    initial = "initial"            # patient volunteers it early, unprompted
    discoverable = "discoverable"  # revealed when the student asks about the topic
    reluctant = "reluctant"        # revealed only once trust is high enough
    hidden = "hidden"              # patient never says it outright; deepest trust or chart only
    chart = "chart"                # never spoken; appears in the chart when released


class Origin(str, Enum):
    """Where a fact came from. Drives the 'please review' highlight in the Studio."""
    faculty = "faculty"      # typed or uploaded by faculty; generator must not change it
    dataset = "dataset"      # imported from the VHS seed dataset
    generated = "generated"  # added by the LLM generator; needs faculty review


class FactCategory(str, Enum):
    demographics = "demographics"
    diagnosis = "diagnosis"
    history = "history"
    symptom = "symptom"
    finding = "finding"
    allergy = "allergy"
    medication = "medication"
    nutrition = "nutrition"
    lifestyle = "lifestyle"      # activity, sleep, substance use, hydration
    psychosocial = "psychosocial"
    social = "social"
    other = "other"


class ArtifactType(str, Enum):
    lab_report = "lab_report"
    vitals = "vitals"
    anthropometrics = "anthropometrics"
    ecg = "ecg"
    imaging = "imaging"          # X-ray, CT, MRI
    prior_note = "prior_note"
    other = "other"


class ReleaseTrigger(str, Enum):
    at_start = "at_start"        # visible in the chart from the first second (referral info)
    on_request = "on_request"    # student asks for it ("can I see the labs?")
    after_fact = "after_fact"    # released once a given fact has been disclosed
    manual = "manual"            # faculty/demo control only


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------

class Fact(BaseModel):
    """One atomic, disclosable piece of patient information."""
    id: str                                   # "f001" - stable within a patient
    category: FactCategory = FactCategory.other
    topic: str = ""                           # short label the router sees, e.g. "medication adherence"
    content: str                              # what is actually true; the patient model only sees disclosed ones
    disclosure: Disclosure = Disclosure.discoverable
    min_trust: int = Field(0, ge=0, le=3)     # 0 = none needed; reluctant ~2; hidden ~3
    show_in_chart: bool = True                # once disclosed, does it appear on the right-hand panel?
    origin: Origin = Origin.dataset
    source_path: Optional[str] = None         # e.g. "information_disclosure.reluctant_information[1]"


class ReleaseRule(BaseModel):
    trigger: ReleaseTrigger = ReleaseTrigger.on_request
    request_keywords: list[str] = []          # hints for the router: "labs", "bloodwork", "A1c"
    after_fact_id: Optional[str] = None


class ArtifactItem(BaseModel):
    """One row in a structured artifact, e.g. a lab value."""
    label: str
    value: str
    flag: Optional[str] = None                # "H", "L", "critical", ...


class Artifact(BaseModel):
    id: str                                   # "a001"
    type: ArtifactType
    title: str
    items: list[ArtifactItem] = []            # structured rows (labs, vitals)
    text: Optional[str] = None                # free text (prior note, imaging report)
    file_path: Optional[str] = None           # uploaded image/PDF, relative to uploads/
    release: ReleaseRule = ReleaseRule()
    origin: Origin = Origin.dataset


class Medication(BaseModel):
    name: str
    dose: str = ""
    frequency: str = ""
    purpose: str = ""
    adherence: str = ""
    patient_concerns: str = ""


class ExpectedDiscovery(BaseModel):
    id: str                                   # "o1.d2"
    text: str
    linked_fact_ids: list[str] = []           # facts that count as "elicited" for this item
    link_method: str = "none"                 # "lexical" (auto), "llm", "faculty"


class LearningObjective(BaseModel):
    id: str                                   # "o1"
    objective: str
    expected_discoveries: list[ExpectedDiscovery] = []
    possible_patient_reactions: list[str] = []
    points: Optional[int] = None              # for checklist-style rubrics (pediatric docx)
    min_level: Optional[str] = None           # lowest year level this is graded at ("M1".."M4"); None = all


# --------------------------------------------------------------------------
# Profile sections (dataset shape)
# --------------------------------------------------------------------------

class Persona(BaseModel):
    """Who the patient is and how they talk. Goes into the patient system prompt."""
    name: str
    age: Optional[int] = None
    sex: Optional[str] = None
    description: str = ""
    keywords: list[str] = []
    occupation: str = ""
    residence: str = ""
    ethnicity: str = ""
    language: str = ""
    marital_status: Optional[str] = None
    education_level: str = ""
    insurance: str = ""
    cultural_context: str = ""
    personality: str = ""
    communication_style: str = ""
    support_system: str = ""
    readiness_to_change: str = ""
    portrait_path: Optional[str] = None       # patient image for the avatar


class EncounterSettings(BaseModel):
    student_role: str = "Dietetics student"   # the VHS cases target nutrition counseling
    encounter_goal: str = "Nutrition assessment and counseling (Nutrition Care Process)"
    setting: str = "Outpatient clinic"
    rubric_id: str = "encounter_evaluation_rubric"
    checklist_rubric_ids: list[str] = []      # extra points checklists, e.g. pediatric_hearing_treatment_checklist
    opening_trust: int = Field(1, ge=0, le=3) # guarded patients (Walter, Dominic) can start at 0
    difficulty_notes: str = ""                # set per encounter from the year level (levels.py)


class FacultyBrief(BaseModel):
    """What faculty originally typed (CSV row or Studio quick-create). Kept verbatim
    so the validator can catch the generator drifting away from it."""
    background: str = ""
    notes: str = ""
    personality: str = ""
    summary: str = ""


class DocumentKind(str, Enum):
    patient_record = "patient_record"   # about THIS patient (labs, prior notes): becomes facts/chart items
    reference = "reference"             # guidelines, papers, syllabus: used for objectives + grading, never spoken


class SourceDocument(BaseModel):
    """A file faculty uploaded. Text is extracted once at upload."""
    id: str                             # "d1"
    name: str
    kind: DocumentKind = DocumentKind.reference
    file_path: Optional[str] = None     # relative to uploads/
    text: str = ""
    summary: str = ""                   # for images: what Claude saw (ECG, X-ray)


class ProfileStatus(str, Enum):
    draft = "draft"
    published = "published"


class PatientProfile(BaseModel):
    id: str
    status: ProfileStatus = ProfileStatus.draft
    version: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    persona: Persona
    settings: EncounterSettings = EncounterSettings()
    faculty_brief: Optional[FacultyBrief] = None

    # structured clinical summary (for the chart header + consistency checks)
    primary_diagnosis: str = ""
    secondary_diagnoses: list[str] = []
    medications: list[Medication] = []
    allergies: list[str] = []

    facts: list[Fact] = []
    artifacts: list[Artifact] = []
    objectives: list[LearningObjective] = []

    knowledge_sources: list[str] = []         # (legacy) extracted text of uploaded guidelines/papers
    documents: list[SourceDocument] = []      # faculty uploads: patient records + reference material
    assumptions: list[str] = []               # what the generator inferred -> show for review
    optional_details: list[str] = []          # colour the patient can use in small talk

    # ---- helpers the engine uses -------------------------------------------
    def fact(self, fact_id: str) -> Fact:
        return next(f for f in self.facts if f.id == fact_id)

    def router_index(self) -> list[dict]:
        """What the router model sees: ids + topics only, never the content."""
        return [{"id": f.id, "category": f.category.value, "topic": f.topic}
                for f in self.facts if f.disclosure != Disclosure.chart]

    def artifact_index(self) -> list[dict]:
        return [{"id": a.id, "type": a.type.value, "title": a.title,
                 "keywords": a.release.request_keywords}
                for a in self.artifacts if a.release.trigger == ReleaseTrigger.on_request]


# --------------------------------------------------------------------------
# Encounter state (one per student attempt)
# --------------------------------------------------------------------------

class Speaker(str, Enum):
    student = "student"
    patient = "patient"
    system = "system"


class Turn(BaseModel):
    n: int
    speaker: Speaker
    text: str
    at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    disclosed_fact_ids: list[str] = []
    released_artifact_ids: list[str] = []
    tags: list[str] = []                      # router tags: open_question, empathy, jargon, off_script...


class EncounterState(BaseModel):
    id: str
    patient_id: str
    patient_version: int
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: Optional[datetime] = None
    level: str = "M2"                         # year level the student is assessed at (levels.py)
    student_id: Optional[str] = None
    assignment_id: Optional[str] = None
    trust: int = 1
    disclosed_fact_ids: list[str] = []        # ordered by first disclosure
    released_artifact_ids: list[str] = []
    turns: list[Turn] = []
