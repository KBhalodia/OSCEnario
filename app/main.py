"""
OSCEnario API: teacher portal (Studio + assignments), student portal (encounters +
feedback), grading config, and the voice routes when the voice module is present.

Run:  uvicorn app.main:app --reload --port 8000      (docs at http://localhost:8000/docs)

Everything patient-specific lives in the stored PatientProfile JSON; these routes only
load/save records and call the engine, generator, levels and feedback functions.
"""
from __future__ import annotations

import json
import secrets
import shutil
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, ValidationError

from app import levels
from app.bedrock import get_llm, smart_model
from app.db import delete_record, get_record, init_db, list_records, save_record
from app.encounter import engine
from app.feedback.diagnosis import grade_diagnosis
from app.feedback.engine import build_feedback
from app.linking import link_objectives
from app.rules import validate
from app.schemas import (
    DocumentKind, EncounterState, FactCategory, PatientProfile, ProfileStatus, SourceDocument,
)
from app.studio.documents import IMAGE_EXT, load_document
from app.studio.generator import REFERENCE_DOC_TYPES, FacultyInput, _document_artifacts, generate_profile

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "samples"
UPLOADS_DIR = ROOT / "uploads"
RUBRIC_DIR = ROOT / "data" / "rubrics"
PORTRAIT_DIRS = [SAMPLES_DIR / "portraits", UPLOADS_DIR / "portraits", ROOT / "portraits"]
MAX_UPLOAD = 15 * 1024 * 1024


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Optional voice module (feature/voice-avatar branch). The API works without it.
# --------------------------------------------------------------------------
try:
    from app.voice.profiles import ensure_voice as _ensure_voice  # type: ignore
except ImportError:  # voice branch not merged yet
    _ensure_voice = None


def with_voice(profile: PatientProfile) -> PatientProfile:
    if _ensure_voice is not None:
        try:
            _ensure_voice(profile)
        except Exception:      # a voice problem must never block saving a patient
            pass
    return profile


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    UPLOADS_DIR.mkdir(exist_ok=True)
    yield


app = FastAPI(title="OSCEnario API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
    expose_headers=["X-TTS-Provider"],
)


def llm_dep():
    """Swappable in tests via app.dependency_overrides[llm_dep]."""
    return get_llm()


@app.exception_handler(ValidationError)
async def _pydantic_error(_, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": json.loads(exc.json())})


def _ai_error(exc: Exception) -> HTTPException:
    name = type(exc).__name__
    if "Credential" in name or "ExpiredToken" in str(exc):
        return HTTPException(502, "AWS credentials missing or expired. Refresh them from the workshop page.")
    return HTTPException(502, f"AI call failed ({name}): {str(exc)[:300]}")


# --------------------------------------------------------------------------
# Record helpers
# --------------------------------------------------------------------------

def load_profile(patient_id: str) -> PatientProfile:
    data = get_record("patients", patient_id)
    if data is None:
        raise HTTPException(404, "Patient not found")
    return PatientProfile.model_validate(data)


def save_profile(p: PatientProfile) -> dict:
    data = p.model_dump(mode="json")
    save_record("patients", p.id, data)
    return data


def load_encounter(encounter_id: str) -> dict:
    rec = get_record("encounters", encounter_id)
    if rec is None:
        raise HTTPException(404, "Encounter not found")
    return rec


def _state(rec: dict) -> EncounterState:
    return EncounterState.model_validate(rec["state"])


def _issues(p: PatientProfile) -> list[dict]:
    return [i.model_dump() for i in validate(p)]


def _summary(p: PatientProfile) -> dict:
    return {
        "id": p.id, "name": p.persona.name, "age": p.persona.age, "sex": p.persona.sex,
        "status": p.status.value, "version": p.version, "primary_diagnosis": p.primary_diagnosis,
        "description": p.persona.description[:240], "portrait": p.persona.portrait_path,
        "student_role": p.settings.student_role, "has_voice": getattr(p.persona, "voice", None) is not None,
    }


def _student_summary(p: PatientProfile) -> dict:
    """What a student may see before the interview: who they're meeting, nothing clinical."""
    return {"id": p.id, "name": p.persona.name, "age": p.persona.age, "sex": p.persona.sex,
            "portrait": p.persona.portrait_path, "has_voice": getattr(p.persona, "voice", None) is not None}


async def _save_upload(file: UploadFile) -> tuple[Path, str]:
    name = Path(file.filename or "file").name
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File exceeds 15 MB")
    dest = UPLOADS_DIR / f"{uuid.uuid4().hex[:8]}_{name}"
    dest.write_bytes(data)
    return dest, dest.name


def _load_doc(path: Path, stored: str, kind: str, doc_id: str, llm, meta: Optional[dict] = None) -> SourceDocument:
    """meta (Studio upload form): {"name", "type", "summary"}. The type decides the kind:
    guideline/syllabus/reference -> reference material; anything else -> about this patient."""
    meta = meta or {}
    dtype = (meta.get("type") or "").strip()
    if dtype:
        kind = "reference" if dtype in REFERENCE_DOC_TYPES else "patient_record"
    try:
        doc = load_document(path, kind, doc_id, llm=llm, vision_model=smart_model(), stored_path=stored)
    except ValueError as e:
        raise HTTPException(400, str(e))
    doc.name = (meta.get("name") or "").strip() or stored.split("_", 1)[-1]
    doc.doc_type = dtype
    if (meta.get("summary") or "").strip():
        doc.summary = meta["summary"].strip()
    if Path(stored).suffix.lower() in IMAGE_EXT:
        doc.text = doc.summary     # faculty's read only; never shown to students
    return doc


def _parse_json_form(raw: str, what: str):
    try:
        return json.loads(raw or "[]")
    except ValueError:
        raise HTTPException(422, f"Bad {what}: expected JSON")


def _patient_assignments(patient_id: str) -> list[dict]:
    return [a for a in list_records("assignments") if a.get("patient_id") == patient_id]


# --------------------------------------------------------------------------
# Config (levels, rubrics, EPAs) for the frontend
# --------------------------------------------------------------------------

@app.get("/")
def home():
    return {"message": "OSCEnario backend is running!", "docs": "/docs"}


@app.get("/config/grading")
def grading_config():
    from app.grading_config import build
    return build()


@app.get("/config/levels")
def level_list():
    return [{"key": k, "label": levels.get_level(k)["label"]} for k in levels.level_names()]


@app.get("/rubrics")
def rubric_list():
    out = []
    for f in sorted(RUBRIC_DIR.glob("*.json")):
        r = json.loads(f.read_text())
        out.append({"id": f.stem, "title": r.get("title", f.stem), "type": r.get("type", "domain_rubric"),
                    "max_points": r.get("max_points") or r.get("scoring", {}).get("max_total")})
    return out


@app.post("/rubrics/import")
async def rubric_import(file: UploadFile = File(...), llm=Depends(llm_dep)):
    """Faculty upload a checklist rubric (DOCX/PDF/TXT) -> stored as data/rubrics/<id>.json."""
    from app.studio.rubric_import import import_checklist
    path, _ = await _save_upload(file)
    try:
        return import_checklist(path, llm=llm, model=smart_model())
    except ValueError as e:
        raise HTTPException(400, str(e))


# --------------------------------------------------------------------------
# Teacher portal: patients (Studio)
# --------------------------------------------------------------------------

@app.get("/patients")
def get_patients(status: Optional[str] = None):
    out = [_summary(PatientProfile.model_validate(d)) for d in list_records("patients")]
    return [p for p in out if status is None or p["status"] == status]


@app.get("/patients/{patient_id}")
def get_patient(patient_id: str):
    return load_profile(patient_id).model_dump(mode="json")


@app.put("/patients/{patient_id}")
def update_patient(patient_id: str, patient_data: dict):
    """Faculty edits in the Studio. Editing a published patient puts it back to draft."""
    old = load_profile(patient_id)
    patient_data["id"] = patient_id
    p = PatientProfile.model_validate(patient_data)
    p.version = old.version + 1
    if old.status == ProfileStatus.published:
        p.status = ProfileStatus.draft
    save_profile(p)
    return {"patient": p.model_dump(mode="json"), "issues": _issues(p)}


@app.post("/patients/import")
def import_patients(publish: bool = True):
    """Load the 8 seed patients from samples/ (published by default so students can use them)."""
    if not SAMPLES_DIR.exists():
        raise HTTPException(404, "Samples directory not found")
    imported, errors = [], []
    for path in sorted(SAMPLES_DIR.glob("*.json")):
        try:
            p = PatientProfile.model_validate_json(path.read_text(encoding="utf-8"))
            if publish:
                p.status = ProfileStatus.published
            save_profile(with_voice(p))
            imported.append(p.id)
        except (ValueError, OSError) as exc:
            errors.append({"file": path.name, "error": str(exc)[:300]})
    return {"imported_count": len(imported), "patient_ids": imported, "errors": errors}


@app.post("/patients/generate")
async def generate_patient(
    brief: str = Form(..., description="FacultyInput as JSON: name, age, gender, ethnicity, background, "
                                       "personality, notes, summary, student_role, encounter_goal"),
    files: list[UploadFile] = File(default=[]),
    kinds: str = Form("[]", description='JSON list, one per file: "patient_record" or "reference"'),
    checklist_rubric_ids: str = Form("[]", description="JSON list of checklist rubric ids to attach"),
    doc_meta: str = Form("[]", description='JSON list, one per file: {"name", "type", "summary"}'),
    class_id: Optional[str] = Form(None, description="Add the new patient to this class"),
    llm=Depends(llm_dep),
):
    """The judge demo: a short description (+ optional files) -> full draft patient. ~30-90 s."""
    try:
        fi = FacultyInput.model_validate_json(brief)
        kind_list = json.loads(kinds or "[]")
        checklists = json.loads(checklist_rubric_ids or "[]")
    except (ValidationError, ValueError) as e:
        raise HTTPException(422, f"Bad form data: {e}")

    metas = _parse_json_form(doc_meta, "doc_meta")
    docs = []
    for i, f in enumerate(files, start=1):
        path, stored = await _save_upload(f)
        kind = kind_list[i - 1] if i - 1 < len(kind_list) else "reference"
        docs.append(_load_doc(path, stored, kind, f"d{i}", llm, metas[i - 1] if i - 1 < len(metas) else None))
    cls = _load_class(class_id) if class_id else None
    try:
        profile, _ = generate_profile(fi, docs, llm)
    except HTTPException:
        raise
    except Exception as e:
        raise _ai_error(e)
    profile.settings.checklist_rubric_ids = [c for c in checklists if (RUBRIC_DIR / f"{c}.json").exists()]
    with_voice(profile)
    save_profile(profile)
    if cls is not None and profile.id not in cls["patient_ids"]:
        cls["patient_ids"].append(profile.id)
        save_record("classes", cls["id"], cls)
    return {"patient": profile.model_dump(mode="json"), "issues": _issues(profile)}


@app.post("/patients/{patient_id}/regenerate")
async def regenerate_patient(
    patient_id: str,
    brief: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    doc_meta: str = Form("[]"),
    checklist_rubric_ids: Optional[str] = Form(None),
    llm=Depends(llm_dep),
):
    """'Edit description': rebuild a patient from a changed brief, keeping its id, classes, documents
    and photo. Not allowed once students have been assigned it (their results refer to it)."""
    old = load_profile(patient_id)
    if _patient_assignments(patient_id):
        raise HTTPException(409, "This patient is already assigned. Duplicate it instead of rebuilding it.")
    try:
        fi = FacultyInput.model_validate_json(brief)
    except ValidationError as e:
        raise HTTPException(422, f"Bad brief: {e}")
    metas = _parse_json_form(doc_meta, "doc_meta")
    docs = list(old.documents)
    for i, f in enumerate(files, start=1):
        path, stored = await _save_upload(f)
        docs.append(_load_doc(path, stored, "reference", f"d{len(docs) + 1}", llm,
                              metas[i - 1] if i - 1 < len(metas) else None))
    try:
        profile, _ = generate_profile(fi, docs, llm, patient_id=patient_id)
    except Exception as e:
        raise _ai_error(e)
    profile.version = old.version + 1
    profile.persona.portrait_path = profile.persona.portrait_path or old.persona.portrait_path
    profile.settings.checklist_rubric_ids = (
        json.loads(checklist_rubric_ids) if checklist_rubric_ids else old.settings.checklist_rubric_ids)
    with_voice(profile)
    save_profile(profile)
    return {"patient": profile.model_dump(mode="json"), "issues": _issues(profile)}


@app.delete("/patients/{patient_id}")
def delete_patient(patient_id: str):
    """Delete a patient nobody has been assigned (drafts, test cases)."""
    load_profile(patient_id)
    if _patient_assignments(patient_id):
        raise HTTPException(409, "This patient is assigned to students, so it can't be deleted.")
    for c in list_records("classes"):
        if patient_id in c.get("patient_ids", []):
            c["patient_ids"].remove(patient_id)
            save_record("classes", c["id"], c)
    delete_record("patients", patient_id)
    return {"deleted": patient_id}


@app.post("/patients/{patient_id}/documents")
async def add_document(patient_id: str, file: UploadFile = File(...),
                       kind: str = Form("patient_record"), name: str = Form(""),
                       doc_type: str = Form(""), summary: str = Form(""), llm=Depends(llm_dep)):
    """Attach a lab report / ECG / X-ray / guideline after creation. Patient records become chart items."""
    p = load_profile(patient_id)
    path, stored = await _save_upload(file)
    doc = _load_doc(path, stored, kind, f"d{len(p.documents) + 1}", llm,
                    {"name": name, "type": doc_type, "summary": summary})
    p.documents.append(doc)
    if doc.kind == DocumentKind.patient_record:
        _document_artifacts(p, [doc])
    p.version += 1
    save_profile(p)
    return {"document": doc.model_dump(mode="json"), "patient": p.model_dump(mode="json"), "issues": _issues(p)}


@app.post("/patients/{patient_id}/artifacts")
async def upload_patient_artifact(patient_id: str, file: UploadFile = File(...), llm=Depends(llm_dep)):
    """Kept for the original frontend contract: same as /documents with kind=patient_record."""
    return await add_document(patient_id, file=file, kind="patient_record", llm=llm)


@app.post("/patients/{patient_id}/validate")
def validate_patient(patient_id: str):
    p = load_profile(patient_id)
    issues = _issues(p)
    return {"patient_id": patient_id, "valid": not any(i["severity"] == "error" for i in issues), "issues": issues}


@app.post("/patients/{patient_id}/link")
def relink_patient(patient_id: str, llm=Depends(llm_dep)):
    """Re-link learning objectives to facts after faculty edits (one AI call)."""
    p = load_profile(patient_id)
    try:
        link_objectives(p, llm)
    except Exception as e:
        raise _ai_error(e)
    save_profile(p)
    return {"patient": p.model_dump(mode="json"), "issues": _issues(p)}


@app.post("/patients/{patient_id}/publish")
def publish_patient(patient_id: str, force: bool = False):
    """Blocked while there are errors, unless faculty choose 'publish anyway' (force=true)."""
    p = load_profile(patient_id)
    issues = _issues(p)
    errors = [i for i in issues if i["severity"] == "error"]
    if errors and not force:
        raise HTTPException(409, {"message": "Fix errors or publish with force=true", "issues": issues})
    p.status = ProfileStatus.published
    save_profile(p)
    return {"patient": _summary(p), "issues": issues}


# --------------------------------------------------------------------------
# Classes: faculty group patients and students; students join with a code
# --------------------------------------------------------------------------

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no 0/o, 1/l/i


def _new_code() -> str:
    taken = {c.get("code") for c in list_records("classes")}
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(7))
        if code not in taken:
            return code


def _load_class(class_id: str) -> dict:
    c = get_record("classes", class_id)
    if c is None:
        raise HTTPException(404, "Class not found")
    return c


def _class_card(c: dict, faculty: bool) -> dict:
    """Class plus what its card shows. Students get no patient details (names/faces only)."""
    pats = []
    for pid in c.get("patient_ids", []):
        d = get_record("patients", pid)
        if d:
            p = PatientProfile.model_validate(d)
            pats.append(_summary(p) if faculty else _student_summary(p))
    asg = [a for a in list_records("assignments") if a.get("class_id") == c["id"]]
    out = {**c, "patients": pats, "assignment_count": len(asg), "student_count": len(c.get("student_ids", []))}
    if not faculty:
        out.pop("student_ids", None)
        out["patients"] = [x for x in pats if any(a["patient_id"] == x["id"] for a in asg)]
    return out


class ClassCreate(BaseModel):
    name: str = Field(min_length=1)
    section: str = ""
    description: str = ""
    student_role: str = ""
    created_by: Optional[str] = None


class ClassUpdate(BaseModel):
    name: Optional[str] = None
    section: Optional[str] = None
    description: Optional[str] = None
    student_role: Optional[str] = None


class JoinRequest(BaseModel):
    code: str
    student_id: str = Field(min_length=1)


@app.post("/classes")
def create_class(req: ClassCreate):
    c = {"id": uuid.uuid4().hex[:10], **req.model_dump(), "code": _new_code(), "created_at": now(),
         "patient_ids": [], "student_ids": []}
    save_record("classes", c["id"], c)
    return _class_card(c, faculty=True)


@app.get("/classes")
def get_classes(created_by: Optional[str] = None, student_id: Optional[str] = None):
    out = list_records("classes")
    if created_by:
        out = [c for c in out if c.get("created_by") == created_by]
    if student_id:
        out = [c for c in out if student_id in c.get("student_ids", [])]
    out.sort(key=lambda c: c.get("created_at", ""))
    return [_class_card(c, faculty=not student_id) for c in out]


@app.get("/classes/{class_id}")
def get_class(class_id: str, student_id: Optional[str] = None):
    c = _load_class(class_id)
    if student_id and student_id not in c.get("student_ids", []):
        raise HTTPException(403, "Join this class with its code first.")
    return _class_card(c, faculty=not student_id)


@app.put("/classes/{class_id}")
def update_class(class_id: str, req: ClassUpdate):
    c = _load_class(class_id)
    c.update({k: v for k, v in req.model_dump().items() if v is not None})
    save_record("classes", class_id, c)
    return _class_card(c, faculty=True)


@app.post("/classes/join")
def join_class(req: JoinRequest):
    code = req.code.strip().lower().replace("-", "").replace(" ", "")
    c = next((x for x in list_records("classes") if x.get("code") == code), None)
    if c is None:
        raise HTTPException(404, "No class has that code. Check it with your instructor.")
    sid = req.student_id.strip().lower()
    if sid not in c["student_ids"]:
        c["student_ids"].append(sid)
        save_record("classes", c["id"], c)
    return _class_card(c, faculty=False)


@app.post("/classes/{class_id}/code")
def reset_code(class_id: str):
    c = _load_class(class_id)
    c["code"] = _new_code()
    save_record("classes", class_id, c)
    return {"code": c["code"]}


class ClassPatient(BaseModel):
    patient_id: str


@app.post("/classes/{class_id}/patients")
def add_class_patient(class_id: str, req: ClassPatient):
    c = _load_class(class_id)
    load_profile(req.patient_id)
    if req.patient_id not in c["patient_ids"]:
        c["patient_ids"].append(req.patient_id)
        save_record("classes", class_id, c)
    return _class_card(c, faculty=True)


@app.delete("/classes/{class_id}/patients/{patient_id}")
def remove_class_patient(class_id: str, patient_id: str):
    c = _load_class(class_id)
    if patient_id in c["patient_ids"]:
        c["patient_ids"].remove(patient_id)
        save_record("classes", class_id, c)
    return _class_card(c, faculty=True)


@app.delete("/classes/{class_id}/students/{student_id}")
def remove_class_student(class_id: str, student_id: str):
    c = _load_class(class_id)
    if student_id in c["student_ids"]:
        c["student_ids"].remove(student_id)
        save_record("classes", class_id, c)
    return _class_card(c, faculty=True)


# --------------------------------------------------------------------------
# Teacher portal: assignments
# --------------------------------------------------------------------------

class AssignmentCreate(BaseModel):
    patient_id: str
    class_id: Optional[str] = None
    title: str = ""
    level: str = "M2"
    student_ids: list[str] = []
    checklist_rubric_ids: list[str] = []
    due_date: Optional[str] = None
    max_attempts: Optional[int] = None
    created_by: Optional[str] = None
    instructions: str = ""


@app.post("/assignments")
def create_assignment(req: AssignmentCreate):
    p = load_profile(req.patient_id)
    if p.status != ProfileStatus.published:
        raise HTTPException(400, "Publish the patient before assigning it.")
    if req.level not in levels.level_names():
        raise HTTPException(400, f"Unknown level {req.level}; use one of {levels.level_names()}")
    if req.class_id:
        c = _load_class(req.class_id)
        if p.id not in c["patient_ids"]:
            c["patient_ids"].append(p.id)
            save_record("classes", c["id"], c)
    a = {"id": uuid.uuid4().hex[:10], **req.model_dump(), "created_at": now(),
         "patient_name": p.persona.name, "patient_portrait": p.persona.portrait_path,
         "level_label": levels.get_level(req.level)["label"],
         "asks_diagnosis": bool(levels.get_level(req.level).get("asks_diagnosis")),
         "class_name": (get_record("classes", req.class_id) or {}).get("name") if req.class_id else None}
    a["title"] = a["title"] or f"{p.persona.name} ({req.level})"
    save_record("assignments", a["id"], a)
    return a


def _student_may_take(a: dict, student_id: Optional[str]) -> bool:
    """Class assignments: class members (all of them, or the listed subset). Older assignments
    without a class: the listed students, or everyone if none are listed."""
    if not student_id:
        return True
    if a.get("class_id"):
        c = get_record("classes", a["class_id"]) or {}
        if student_id not in c.get("student_ids", []):
            return False
    return not a.get("student_ids") or student_id in a["student_ids"]


@app.get("/assignments")
def get_assignments(student_id: Optional[str] = None, created_by: Optional[str] = None,
                    class_id: Optional[str] = None):
    out = list_records("assignments")
    if class_id:
        out = [a for a in out if a.get("class_id") == class_id]
    if student_id:
        out = [a for a in out if _student_may_take(a, student_id)]
    if created_by:
        out = [a for a in out if a.get("created_by") == created_by]
    return sorted(out, key=lambda a: a.get("created_at", ""), reverse=True)


@app.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: str):
    a = get_record("assignments", assignment_id)
    if a is None:
        raise HTTPException(404, "Assignment not found")
    return a


@app.get("/assignments/{assignment_id}/brief")
def assignment_brief(assignment_id: str):
    """What a student sees before the encounter: how they'll be graded and the learning goals (titles
    only: the expected findings would give the case away). Nothing clinical about the patient."""
    a = get_assignment(assignment_id)
    p = load_profile(a["patient_id"])
    lv = levels.get_level(a["level"])
    modes = lv["grading"]["domains"]
    rubric = json.loads((RUBRIC_DIR / f"{p.settings.rubric_id}.json").read_text())
    checklists = []
    for cid in {*p.settings.checklist_rubric_ids, *a.get("checklist_rubric_ids", [])}:
        f = RUBRIC_DIR / f"{cid}.json"
        if f.exists():
            r = json.loads(f.read_text())
            checklists.append({"id": cid, "title": r.get("title", cid),
                               "sections": [s["name"] for s in r.get("sections", [])]})
    return {
        "assignment": {k: a.get(k) for k in ("id", "title", "patient_name", "level", "level_label", "due_date",
                                             "instructions", "max_attempts", "class_name")},
        "patient": _student_summary(p),
        "student_role": p.settings.student_role,
        "setting": p.settings.setting,
        "expectations": lv["grading"]["expectations"],
        "asks_diagnosis": bool(lv.get("asks_diagnosis")),
        "domains": [{"key": d["key"], "name": d["name"], "mode": modes.get(d["key"], "core"),
                     "what_good_looks_like": d.get("descriptors", {}).get("4", "")}
                    for d in rubric["domains"]],
        "learning_goals": [o.objective for o in levels.graded_objectives(p, a["level"])],
        "checklists": checklists,
    }


@app.get("/assignments/{assignment_id}/results")
def assignment_results(assignment_id: str):
    """Faculty view: every attempt, its scores and flags."""
    a = get_assignment(assignment_id)
    rows = []
    for e in list_records("encounters"):
        if e.get("assignment_id") != assignment_id:
            continue
        fb = get_record("feedback", e["id"]) if e.get("status") == "completed" else None
        rows.append({
            "encounter_id": e["id"], "student_id": e.get("student_id"), "status": e.get("status"),
            "started_at": e.get("created_at"), "ended_at": e.get("ended_at"),
            "total": fb and fb["total"], "max_total": fb and fb["max_total"],
            "needs_review": fb and fb["needs_review"],
            "domain_scores": fb and {d["key"]: d["score"] for d in fb["domains"]},
            "epas": fb and [{"id": x["id"], "estimated_label": x["estimated_label"],
                             "meets_target": x["meets_target"]} for x in fb.get("epas", [])],
            "checklists": fb and [{"id": c["id"], "score": c["score"], "max_points": c["max_points"]}
                                  for c in fb.get("checklists", [])],
            "diagnosis": fb and (fb.get("diagnosis") or {}).get("verdict"),
        })
    return {"assignment": a, "attempts": sorted(rows, key=lambda r: r["started_at"] or "")}


# --------------------------------------------------------------------------
# Student portal: encounters
# --------------------------------------------------------------------------

class EncounterCreate(BaseModel):
    patient_id: Optional[str] = None
    assignment_id: Optional[str] = None
    student_id: Optional[str] = None
    level: Optional[str] = None
    preview: bool = Field(False, description="Faculty test run: allows draft patients")


class MessageRequest(BaseModel):
    message: str = Field(min_length=1)
    response_ms: Optional[int] = Field(None, ge=0, description="pause after the patient finished speaking")
    interrupted: bool = Field(False, description="student started talking while the patient was speaking")


class EndRequest(BaseModel):
    diagnosis: Optional[str] = None            # M3/M4: working diagnosis typed at the end
    differential: list[str] = []
    reasoning: str = ""


def _profile_for(rec: dict) -> PatientProfile:
    """Patient as it was when the encounter started, plus the assignment's checklists."""
    p = load_profile(rec["patient_id"])
    for cid in rec.get("checklist_rubric_ids", []):
        if cid not in p.settings.checklist_rubric_ids:
            p.settings.checklist_rubric_ids.append(cid)
    return p


@app.post("/encounters")
def create_encounter(req: EncounterCreate):
    a = None
    if req.assignment_id:
        a = get_assignment(req.assignment_id)
        if req.student_id and not _student_may_take(a, req.student_id):
            raise HTTPException(403, "This assignment isn't assigned to that student.")
        if a.get("max_attempts"):
            done = [e for e in list_records("encounters")
                    if e.get("assignment_id") == a["id"] and e.get("student_id") == req.student_id]
            if len(done) >= a["max_attempts"]:
                raise HTTPException(400, "No attempts left for this assignment.")
    patient_id = (a or {}).get("patient_id") or req.patient_id
    if not patient_id:
        raise HTTPException(422, "Give patient_id or assignment_id")
    p = load_profile(patient_id)
    level = (a or {}).get("level") or req.level or levels.DEFAULT_LEVEL
    try:
        state = engine.start_encounter(p, require_published=not req.preview, level=level,
                                       student_id=req.student_id, assignment_id=req.assignment_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    rec = {
        "id": state.id, "patient_id": p.id, "student_id": req.student_id,
        "assignment_id": req.assignment_id, "level": state.level, "preview": req.preview,
        "checklist_rubric_ids": (a or {}).get("checklist_rubric_ids", []),
        "status": "active", "created_at": now(), "state": state.model_dump(mode="json"),
    }
    save_record("encounters", state.id, rec)
    return {"encounter_id": state.id, "level": state.level,
            "level_label": levels.get_level(state.level)["label"],
            "asks_diagnosis": bool(levels.get_level(state.level).get("asks_diagnosis")),
            "patient": _student_summary(p), "chart": engine.chart_view(p, state)}


@app.get("/encounters")
def get_encounters(student_id: Optional[str] = None, assignment_id: Optional[str] = None):
    out = []
    for e in list_records("encounters"):
        if student_id and e.get("student_id") != student_id:
            continue
        if assignment_id and e.get("assignment_id") != assignment_id:
            continue
        row = {k: e.get(k) for k in ("id", "patient_id", "student_id", "assignment_id", "level",
                                     "status", "created_at", "ended_at", "preview")}
        pat = get_record("patients", e["patient_id"]) or {}
        row["patient_name"] = (pat.get("persona") or {}).get("name", "")
        fb = get_record("feedback", e["id"]) if e.get("status") == "completed" else None
        row["total"], row["max_total"] = (fb["total"], fb["max_total"]) if fb else (None, None)
        out.append(row)
    return sorted(out, key=lambda e: e.get("created_at") or "", reverse=True)


@app.get("/encounters/{encounter_id}")
def get_encounter(encounter_id: str):
    rec = load_encounter(encounter_id)
    p = _profile_for(rec)
    s = _state(rec)
    t0 = s.started_at
    transcript = [{"n": t.n, "speaker": t.speaker.value, "text": t.text, "at": t.at.isoformat(),
                   "offset_s": max(0, int((t.at - t0).total_seconds())),
                   "response_ms": t.response_ms, "interrupted": t.interrupted}
                  for t in s.turns if t.speaker.value != "system"]
    return {**{k: rec.get(k) for k in ("id", "patient_id", "student_id", "assignment_id", "level",
                                       "status", "created_at", "ended_at")},
            "patient": _summary(p) if rec.get("status") != "active" else _student_summary(p),
            "transcript": transcript, "chart": engine.chart_view(p, s),
            "feedback": get_record("feedback", encounter_id)}


@app.get("/encounters/{encounter_id}/chart")
def get_chart(encounter_id: str):
    rec = load_encounter(encounter_id)
    return engine.chart_view(_profile_for(rec), _state(rec))


@app.post("/encounters/{encounter_id}/message")
def send_message(encounter_id: str, request: MessageRequest, llm=Depends(llm_dep)):
    rec = load_encounter(encounter_id)
    if rec["status"] != "active":
        raise HTTPException(400, "Encounter has already ended")
    p = _profile_for(rec)
    s = _state(rec)
    try:
        r = engine.take_turn(p, s, request.message, llm)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise _ai_error(e)
    st = next((t for t in reversed(s.turns) if t.speaker.value == "student"), None)
    if st is not None:
        st.response_ms, st.interrupted = request.response_ms, request.interrupted
    rec["state"] = s.model_dump(mode="json")
    save_record("encounters", encounter_id, rec)
    return {
        "reply": r.reply, "turn": s.turns[-1].n, "trust": r.trust, "deflected": r.deflected, "tags": r.tags,
        "new_facts": [{"id": f, "text": p.fact(f).content, "category": p.fact(f).category.value}
                      for f in r.new_fact_ids
                      if p.fact(f).show_in_chart and p.fact(f).category != FactCategory.diagnosis],
        "new_artifacts": [a.model_dump(mode="json") for a in p.artifacts if a.id in r.new_artifact_ids],
        "chart": engine.chart_view(p, s),
    }


@app.post("/encounters/{encounter_id}/end")
def end_encounter(encounter_id: str, body: Optional[EndRequest] = None, llm=Depends(llm_dep)):
    """Ends the encounter and grades it (one AI call; M3/M4 add one for the diagnosis)."""
    rec = load_encounter(encounter_id)
    existing = get_record("feedback", encounter_id)
    if existing:
        return existing
    p = _profile_for(rec)
    s = _state(rec)
    if not any(t.speaker.value == "student" for t in s.turns):
        raise HTTPException(400, "Nothing to grade: the student hasn't said anything yet.")
    s = engine.end_encounter(s)
    rec.update(status="completed", ended_at=now(), state=s.model_dump(mode="json"))
    save_record("encounters", encounter_id, rec)
    try:
        fb = build_feedback(p, s, llm)
    except Exception as e:
        rec["status"] = "grading_failed"       # can retry POST /end
        save_record("encounters", encounter_id, rec)
        raise _ai_error(e)
    if levels.get_level(rec.get("level")).get("asks_diagnosis"):
        b = body or EndRequest()
        try:
            fb["diagnosis"] = grade_diagnosis(p, b.diagnosis, b.differential, b.reasoning, llm)
        except Exception:     # the rubric report still stands if this extra check fails
            fb["diagnosis"] = {"asked": True, "submitted": b.diagnosis or "", "differential": b.differential,
                               "reasoning": b.reasoning, "expected": [p.primary_diagnosis],
                               "verdict": "not_graded", "matched": "", "differential_hits": [],
                               "explanation": "The diagnosis check didn't run. Your instructor can review it."}
    fb["faculty_review"] = {"notes": "", "reviewed_by": None, "reviewed_at": None}
    save_record("feedback", encounter_id, fb)
    return fb


@app.get("/encounters/{encounter_id}/feedback")
def get_feedback(encounter_id: str):
    fb = get_record("feedback", encounter_id)
    if fb is None:
        raise HTTPException(404, "No feedback yet: end the encounter first.")
    return fb


class FacultyReview(BaseModel):
    notes: str = ""
    reviewed_by: Optional[str] = None
    epa_confirmed_levels: dict[str, int] = {}       # {"EPA1": 2}
    clear_review_flag: bool = False


@app.put("/encounters/{encounter_id}/feedback/faculty")
def faculty_review(encounter_id: str, review: FacultyReview):
    fb = get_feedback(encounter_id)
    fb["faculty_notes"] = review.notes
    fb["faculty_review"] = {"notes": review.notes, "reviewed_by": review.reviewed_by, "reviewed_at": now()}
    for e in fb.get("epas", []):
        if e["id"] in review.epa_confirmed_levels:
            e["faculty_confirmed_level"] = review.epa_confirmed_levels[e["id"]]
    if review.clear_review_flag:
        fb["needs_review"] = False
    save_record("feedback", encounter_id, fb)
    return fb


# --------------------------------------------------------------------------
# Files: portraits and uploads
# --------------------------------------------------------------------------

def _serve(name: str, dirs: list[Path]):
    safe = Path(name).name
    if safe != name:
        raise HTTPException(400, "Invalid filename")
    for d in dirs:
        if (d / safe).is_file():
            return FileResponse(d / safe)
    raise HTTPException(404, "File not found")


@app.get("/portraits/{filename}")
def get_portrait(filename: str):
    return _serve(filename, PORTRAIT_DIRS)


@app.post("/portraits")
async def upload_portrait(file: UploadFile = File(...), patient_id: Optional[str] = Form(None)):
    if Path(file.filename or "").suffix.lower() not in IMAGE_EXT:
        raise HTTPException(400, "Portrait must be an image")
    (UPLOADS_DIR / "portraits").mkdir(parents=True, exist_ok=True)
    path, stored = await _save_upload(file)
    dest = UPLOADS_DIR / "portraits" / stored
    shutil.move(str(path), dest)
    if patient_id:
        p = load_profile(patient_id)
        p.persona.portrait_path = f"portraits/{stored}"
        save_profile(p)
    return {"portrait": f"portraits/{stored}"}


@app.get("/uploads/{filename}")
def get_upload(filename: str):
    return _serve(filename, [UPLOADS_DIR])


# --------------------------------------------------------------------------
# Voice routes (only if the voice module is merged in)
# --------------------------------------------------------------------------
try:
    from app.voice import api as voice_api  # type: ignore
    voice_api.set_profile_loader(load_profile)
    app.include_router(voice_api.router)
    VOICE_ENABLED = True
except ImportError:
    VOICE_ENABLED = False


@app.get("/health")
def health():
    return {"ok": True, "voice": VOICE_ENABLED, "levels": levels.level_names()}
