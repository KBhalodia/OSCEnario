"""
FastAPI routes for the voice layer. Mount in the main app:

    from app.voice import api as voice_api
    voice_api.set_profile_loader(lambda patient_id: db.get_profile(patient_id))  # -> PatientProfile | None
    app.include_router(voice_api.router)

    POST /tts            {text, patient_id, trust, deflected}  -> audio/mpeg (503 = use browser TTS)
    POST /tts/preview    {voice, text?}                         -> audio/mpeg (Studio "Preview")
    GET  /voices         catalog + presets + default model      (Studio dropdown)
    GET  /voices/status  which providers work + ElevenLabs credits left (no secrets)
    POST /voices/assign  {persona}                              -> VoiceProfile (Studio "auto")

The browser never sees the ElevenLabs key; it only calls these routes.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..schemas import PatientProfile, Persona, VoiceProfile
from . import tts
from .catalog import api_key, load_catalog
from .profiles import DEFAULT_MODEL, PRESETS_BY_KEY, assign_voice, ensure_voice, preset_table

router = APIRouter(tags=["voice"])

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "samples"
PREVIEW_TEXT = "Hi. I'm here for my appointment. Honestly, I'm not sure where to start."

_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    return _http


def _samples_loader(patient_id: str) -> Optional[PatientProfile]:
    f = SAMPLES_DIR / f"{patient_id}.json"
    return PatientProfile.model_validate_json(f.read_text(encoding="utf-8")) if f.exists() else None


_load_profile: Callable[[str], Optional[PatientProfile]] = _samples_loader


def set_profile_loader(fn: Callable[[str], Optional[PatientProfile]]) -> None:
    """The main app plugs in its DB lookup here."""
    global _load_profile
    _load_profile = fn


def _audio_response(speech: tts.Speech) -> StreamingResponse:
    return StreamingResponse(speech.stream, media_type="audio/mpeg",
                             headers={"X-TTS-Provider": speech.provider,
                                      "Cache-Control": "no-store"})


def _unavailable(reason: str) -> JSONResponse:
    # The frontend falls back to the browser's speechSynthesis on 503.
    return JSONResponse(status_code=503, content={"fallback": "browser", "reason": reason})


class TTSRequest(BaseModel):
    text: str = Field(..., max_length=4000)
    patient_id: str
    trust: Optional[int] = Field(None, ge=0, le=3)
    deflected: bool = False   # the frontend adds a short pause before playing


@router.post("/tts")
async def tts_endpoint(req: TTSRequest):
    profile = _load_profile(req.patient_id)
    if profile is None:
        raise HTTPException(404, "Unknown patient")
    ensure_voice(profile)
    voice = tts.adjust_for_state(profile.persona.voice, req.trust)
    try:
        return _audio_response(await tts.synthesize(req.text, voice, _client()))
    except tts.TTSUnavailable as e:
        return _unavailable(str(e))


class PreviewRequest(BaseModel):
    voice: VoiceProfile
    text: str = Field(PREVIEW_TEXT, max_length=300)


@router.post("/tts/preview")
async def tts_preview(req: PreviewRequest):
    try:
        return _audio_response(await tts.synthesize(req.text or PREVIEW_TEXT, req.voice, _client()))
    except tts.TTSUnavailable as e:
        return _unavailable(str(e))


@router.get("/voices")
async def voices():
    return {
        "default_model": DEFAULT_MODEL,
        "voices": [v.model_dump() for v in load_catalog()],
        "presets": preset_table(),
    }


@router.get("/voices/status")
async def voices_status():
    u = await tts.elevenlabs_usage(_client())
    return {
        "elevenlabs": {"configured": bool(api_key()), "tier": u.tier, "used": u.used,
                       "limit": u.limit, "remaining": u.remaining if u.limit else None,
                       "error": u.error or None},
        "polly": {"configured": bool(os.environ.get("AWS_ACCESS_KEY_ID")
                                     or os.environ.get("AWS_PROFILE"))},
        "browser_fallback": True,
    }


class AssignRequest(BaseModel):
    persona: Persona
    preset: Optional[str] = None   # Studio: apply a preset's delivery to this persona's voice


@router.post("/voices/assign")
async def voices_assign(req: AssignRequest) -> VoiceProfile:
    v = assign_voice(req.persona)
    if req.preset and req.preset in PRESETS_BY_KEY:
        p = next(x for x in preset_table() if x["key"] == req.preset)
        v = v.model_copy(update={"voice_id": p["voice_id"] or v.voice_id, "speed": p["speed"],
                                 "stability": p["stability"], "style": p["style"],
                                 "similarity_boost": p["similarity_boost"],
                                 "fallback_polly_voice": p["fallback_polly_voice"],
                                 "preset": req.preset})
    return v
