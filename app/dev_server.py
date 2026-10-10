"""
DEV-ONLY server so the voice/avatar layer can be tried end to end before the real API exists.
In-memory, seed patients from samples/, real encounter engine on Bedrock. Replace with the
main FastAPI app (it only needs to include app.voice.api.router the same way).

    set -a; source .env; set +a
    .venv/bin/uvicorn app.dev_server:app --reload --port 8000
    # then: cd frontend && npm run dev   ->  http://localhost:5173

Audio is never stored: only the text transcript lives in EncounterState.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .encounter.engine import chart_view, end_encounter, start_encounter, take_turn
from .schemas import EncounterState, PatientProfile, VoiceProfile
from .voice import api as voice_api
from .voice.profiles import ensure_voice

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"


def _load_dotenv(path: Path) -> None:
    """Tiny .env reader (handles `export KEY=value`) so `uvicorn` works without `source .env`."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.removeprefix("export ").split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")

PATIENTS: dict[str, PatientProfile] = {}
for f in sorted(SAMPLES.glob("*.json")):
    p = ensure_voice(PatientProfile.model_validate_json(f.read_text(encoding="utf-8")))
    PATIENTS[p.id] = p
ENCOUNTERS: dict[str, EncounterState] = {}

app = FastAPI(title="Virtual Patient - dev server")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-TTS-Provider"])
voice_api.set_profile_loader(PATIENTS.get)
app.include_router(voice_api.router)
app.mount("/portraits", StaticFiles(directory=SAMPLES / "portraits"), name="portraits")

_llm = None


def llm():
    global _llm
    if _llm is None:
        from .bedrock import get_llm
        _llm = get_llm()
    return _llm


def _summary(p: PatientProfile) -> dict:
    return {"id": p.id, "name": p.persona.name, "age": p.persona.age, "sex": p.persona.sex,
            "description": p.persona.description[:160], "portrait_path": p.persona.portrait_path,
            "voice": p.persona.voice.model_dump() if p.persona.voice else None}


@app.get("/patients")
def list_patients():
    return [_summary(p) for p in PATIENTS.values()]


@app.get("/patients/{pid}")
def get_patient(pid: str):
    p = PATIENTS.get(pid) or _404()
    return p.model_dump(mode="json")


class VoiceUpdate(BaseModel):
    voice: Optional[VoiceProfile] = None   # None = back to automatic


@app.put("/patients/{pid}/voice")
def set_voice(pid: str, body: VoiceUpdate):
    p = PATIENTS.get(pid) or _404()
    if body.voice is None:
        p.persona.voice = None
        ensure_voice(p)
    else:
        p.persona.voice = body.voice.model_copy(update={"origin": "faculty"})
    return p.persona.voice


class StartBody(BaseModel):
    patient_id: str


@app.post("/encounters")
def start(body: StartBody):
    p = PATIENTS.get(body.patient_id) or _404()
    s = start_encounter(p, require_published=False)
    ENCOUNTERS[s.id] = s
    return {"encounter_id": s.id, "chart": chart_view(p, s)}


class MessageBody(BaseModel):
    text: str


@app.post("/encounters/{eid}/message")
def message(eid: str, body: MessageBody):
    s = ENCOUNTERS.get(eid) or _404()
    p = PATIENTS[s.patient_id]
    r = take_turn(p, s, body.text, llm())
    return {"reply": r.reply, "trust": r.trust, "deflected": r.deflected, "tags": r.tags,
            "new_fact_ids": r.new_fact_ids, "new_artifact_ids": r.new_artifact_ids,
            "chart": chart_view(p, s)}


@app.post("/encounters/{eid}/end")
def end(eid: str):
    s = ENCOUNTERS.get(eid) or _404()
    end_encounter(s)
    return {"transcript": [t.model_dump(mode="json") for t in s.turns]}


def _404():
    raise HTTPException(404, "Not found")
