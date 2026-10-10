import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.db import init_db, save_record, get_record, list_records


ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "samples"
UPLOADS_DIR = ROOT / "uploads"
PORTRAITS_DIR = ROOT / "portraits"

UPLOADS_DIR.mkdir(exist_ok=True)


def now():
    return datetime.now(timezone.utc).isoformat()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Twinverse API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EncounterCreate(BaseModel):
    patient_id: str
    student_id: Optional[str] = None


class MessageRequest(BaseModel):
    message: str = Field(min_length=1)


def require_patient(patient_id: str):
    patient = get_record("patients", patient_id)

    if patient is None:
        raise HTTPException(
            status_code=404,
            detail="Patient not found",
        )

    return patient


def require_encounter(encounter_id: str):
    encounter = get_record("encounters", encounter_id)

    if encounter is None:
        raise HTTPException(
            status_code=404,
            detail="Encounter not found",
        )

    return encounter


@app.get("/")
def home():
    return {
        "message": "Twinverse backend is running!",
        "docs": "/docs",
    }


# PATIENTS

@app.get("/patients")
def get_patients():
    return list_records("patients")


@app.get("/patients/{patient_id}")
def get_patient(patient_id: str):
    return require_patient(patient_id)


@app.put("/patients/{patient_id}")
def update_patient(
    patient_id: str,
    patient_data: dict,
):
    patient_data["id"] = patient_id
    save_record("patients", patient_id, patient_data)
    return patient_data


@app.post("/patients/import")
def import_patients():
    if not SAMPLES_DIR.exists():
        raise HTTPException(
            status_code=404,
            detail="Samples directory not found",
        )

    imported = []
    errors = []

    for path in sorted(SAMPLES_DIR.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as f:
                patient = json.load(f)

            if not isinstance(patient, dict):
                raise ValueError("Expected a JSON object")

            patient_id = str(
                patient.get("id")
                or patient.get("patient_id")
                or path.stem
            )

            patient["id"] = patient_id
            save_record("patients", patient_id, patient)
            imported.append(patient_id)

        except (ValueError, OSError) as exc:
            errors.append({
                "file": path.name,
                "error": str(exc),
            })

    return {
        "imported_count": len(imported),
        "patient_ids": imported,
        "errors": errors,
    }


@app.post("/patients/{patient_id}/validate")
def validate_patient(patient_id: str):
    require_patient(patient_id)

    return {
        "patient_id": patient_id,
        "validation_status": "not_integrated",
        "valid": None,
        "message": "Validation rules are not connected yet.",
    }


@app.post("/patients/{patient_id}/publish")
def publish_patient(patient_id: str):
    require_patient(patient_id)

    raise HTTPException(
        status_code=501,
        detail="Publishing requires validation integration.",
    )


@app.post("/patients/{patient_id}/artifacts")
async def upload_patient_artifact(
    patient_id: str,
    file: UploadFile = File(...),
):
    require_patient(patient_id)

    original_name = Path(file.filename or "file").name
    file_id = str(uuid.uuid4())
    destination = UPLOADS_DIR / f"{file_id}_{original_name}"

    contents = await file.read()

    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File exceeds 10 MB",
        )

    destination.write_bytes(contents)

    return {
        "patient_id": patient_id,
        "filename": original_name,
        "stored_filename": destination.name,
        "size": len(contents),
    }


# ENCOUNTERS

@app.post("/encounters")
def create_encounter(request: EncounterCreate):
    require_patient(request.patient_id)

    encounter_id = str(uuid.uuid4())

    encounter = {
        "id": encounter_id,
        "patient_id": request.patient_id,
        "student_id": request.student_id,
        "status": "active",
        "created_at": now(),
        "messages": [],
        "chart_view": None,
        "feedback": None,
        "engine_status": "not_integrated",
    }

    save_record("encounters", encounter_id, encounter)
    return encounter


@app.get("/encounters/{encounter_id}")
def get_encounter(encounter_id: str):
    return require_encounter(encounter_id)


@app.post("/encounters/{encounter_id}/message")
def send_message(
    encounter_id: str,
    request: MessageRequest,
):
    encounter = require_encounter(encounter_id)

    if encounter["status"] != "active":
        raise HTTPException(
            status_code=400,
            detail="Encounter has already ended",
        )

    raise HTTPException(
        status_code=501,
        detail="AI messaging is not integrated yet.",
    )


@app.post("/encounters/{encounter_id}/end")
def end_encounter(encounter_id: str):
    encounter = require_encounter(encounter_id)

    encounter["status"] = "completed"
    encounter["ended_at"] = now()
    encounter["feedback"] = {
        "status": "not_integrated",
        "message": "Rubric evaluation is not connected yet.",
    }

    save_record("encounters", encounter_id, encounter)
    return encounter


# PORTRAITS

@app.get("/portraits/{filename}")
def get_portrait(filename: str):
    safe_filename = Path(filename).name

    if safe_filename != filename:
        raise HTTPException(
            status_code=400,
            detail="Invalid filename",
        )

    path = PORTRAITS_DIR / safe_filename

    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Portrait not found",
        )

    return FileResponse(path)