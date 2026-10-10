"""
Offline tests for the voice layer: voice assignment for any persona, and the TTS fallback
chain with ElevenLabs/Polly faked (no network, no credits used).

    python -m pytest -q tests        (or: python tests/test_voice.py)
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from app.importers import vhs_record_to_profile  # noqa: E402
from app.schemas import PatientProfile, Persona, VoiceProfile  # noqa: E402
from app.voice import tts  # noqa: E402
from app.voice.catalog import BUILTIN, get_voice  # noqa: E402
from app.voice.profiles import assign_voice, ensure_voice  # noqa: E402

SAMPLES = sorted((ROOT / "samples").glob("*.json"))


def load_all() -> list[PatientProfile]:
    return [PatientProfile.model_validate_json(f.read_text(encoding="utf-8")) for f in SAMPLES]


# --------------------------------------------------------------------------
# Assignment
# --------------------------------------------------------------------------

def test_samples_get_distinct_fitting_voices():
    ps = load_all()
    voices = {p.persona.name: assign_voice(p.persona, BUILTIN) for p in ps}
    assert len({v.voice_id for v in voices.values()}) == len(ps), "each sample patient sounds different"
    for p in ps:
        v = get_voice(voices[p.persona.name].voice_id) or next(
            x for x in BUILTIN if x.voice_id == voices[p.persona.name].voice_id)
        assert v.gender == p.persona.sex.lower(), f"{p.persona.name}: voice gender must match"


def test_assignment_is_deterministic():
    p = load_all()[0].persona
    assert assign_voice(p, BUILTIN) == assign_voice(p.model_copy(), BUILTIN)


def test_brand_new_patient_gets_a_voice_without_code_changes():
    cases = [
        Persona(name="Jane Doe", age=58, sex="Female", personality="anxious, worried about chest pain"),
        Persona(name="Leo Park", age=16, sex="M", personality="talkative and funny"),
        Persona(name="Ana Ruiz", age=40, sex="female", language="Spanish (primary)", personality="quiet"),
        Persona(name="Sam"),   # only a name, as a judge might type
    ]
    for persona in cases:
        v = assign_voice(persona, BUILTIN)
        assert v.voice_id and v.fallback_polly_voice and v.preset and v.origin == "auto"
        assert 0.85 <= v.speed <= 1.12 and 0.25 <= v.stability <= 0.85
        sex = persona.sex and persona.sex[0].lower()
        if sex in ("m", "f"):
            g = next(x for x in BUILTIN if x.voice_id == v.voice_id).gender
            assert g in ({"m": "male", "f": "female"}[sex], "neutral")


def test_personality_moves_delivery():
    calm = assign_voice(Persona(name="A", age=30, sex="female", personality="calm, stoic, quiet"), BUILTIN)
    fast = assign_voice(Persona(name="A", age=30, sex="female", personality="anxious, talkative"), BUILTIN)
    assert fast.speed > calm.speed and fast.stability < calm.stability


def test_no_accent_picked_from_ethnicity():
    # ethnicity alone never selects an accented voice
    p = Persona(name="Ravi", age=40, sex="male", ethnicity="Asian Indian", language="English")
    v = next(x for x in BUILTIN if x.voice_id == assign_voice(p, BUILTIN).voice_id)
    assert v.accent == "american"


def test_faculty_choice_is_never_overwritten():
    p = load_all()[0]
    p.persona.voice = VoiceProfile(voice_id="custom123", origin="faculty")
    ensure_voice(p, force=True)
    assert p.persona.voice.voice_id == "custom123"
    p.persona.voice = None
    ensure_voice(p)
    assert p.persona.voice.origin == "auto"


def test_import_assigns_voice():
    p = vhs_record_to_profile({"patient_overview": {"name": "New Person", "age": 70, "sex": "Female"}})
    assert p.persona.voice is not None and p.persona.voice.voice_id


def test_old_profiles_without_voice_still_load():
    raw = SAMPLES[0].read_text(encoding="utf-8")
    import json
    d = json.loads(raw)
    d["persona"].pop("voice", None)
    assert PatientProfile.model_validate(d).persona.voice is None


# --------------------------------------------------------------------------
# TTS fallback chain (all providers faked)
# --------------------------------------------------------------------------

def _voice() -> VoiceProfile:
    return VoiceProfile(voice_id="v1", model_id="eleven_flash_v2_5", fallback_polly_voice="Matthew")


def _run(coro):
    return asyncio.run(coro)


async def _collect(speech: tts.Speech) -> bytes:
    return b"".join([c async for c in speech.stream])


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _reset(monkeypatch=None):
    tts.CACHE = tts.AudioCache()
    tts._usage = tts.Usage()


def _with_env(key: str | None):
    import os
    if key is None:
        os.environ.pop("ELEVENLABS_API_KEY", None)
    else:
        os.environ["ELEVENLABS_API_KEY"] = key


def test_elevenlabs_used_when_it_works_and_body_is_tts_only():
    _reset(); _with_env("test-key")
    seen = {}

    def handler(req: httpx.Request):
        if req.url.path == "/v1/user/subscription":
            return httpx.Response(200, json={"tier": "creator", "character_count": 10, "character_limit": 131000})
        seen["path"], seen["body"] = req.url.path, req.content
        assert req.headers["xi-api-key"] == "test-key"
        return httpx.Response(200, content=b"MP3DATA")

    async def go():
        async with _client(handler) as c:
            sp = await tts.synthesize("Hello there.", _voice(), c)
            return sp.provider, await _collect(sp)
    provider, audio = _run(go())
    assert provider == "elevenlabs" and audio == b"MP3DATA"
    assert seen["path"] == "/v1/text-to-speech/v1/stream"     # text-to-speech endpoint, nothing else
    assert b'"speed"' in seen["body"] and b"eleven_flash_v2_5" in seen["body"]


def test_falls_back_to_polly_on_elevenlabs_error(monkeypatch=None):
    _reset(); _with_env("test-key")
    orig = tts.polly_audio

    async def fake_polly(text, v):
        return b"POLLY"
    tts.polly_audio = fake_polly
    try:
        def handler(req):
            if req.url.path == "/v1/user/subscription":
                return httpx.Response(200, json={"tier": "creator", "character_count": 0, "character_limit": 100})
            return httpx.Response(401, json={"detail": "invalid key"})

        async def go():
            async with _client(handler) as c:
                sp = await tts.synthesize("Hi", _voice(), c)
                return sp.provider, await _collect(sp)
        assert _run(go()) == ("polly", b"POLLY")
    finally:
        tts.polly_audio = orig


def test_out_of_credits_skips_elevenlabs():
    _reset(); _with_env("test-key")
    orig = tts.polly_audio
    calls = []

    async def fake_polly(text, v):
        return b"POLLY"
    tts.polly_audio = fake_polly
    try:
        def handler(req):
            calls.append(req.url.path)
            return httpx.Response(200, json={"tier": "free", "character_count": 10000, "character_limit": 10000})

        async def go():
            async with _client(handler) as c:
                return (await tts.synthesize("A long reply", _voice(), c)).provider
        assert _run(go()) == "polly"
        assert not any("text-to-speech" in p for p in calls)
    finally:
        tts.polly_audio = orig


def test_everything_down_raises_so_browser_speaks():
    _reset(); _with_env(None)
    orig = tts.polly_audio

    async def broken(text, v):
        raise tts.TTSUnavailable("Polly blocked")
    tts.polly_audio = broken
    try:
        async def go():
            async with _client(lambda r: httpx.Response(500)) as c:
                await tts.synthesize("Hi", _voice(), c)
        try:
            _run(go())
        except tts.TTSUnavailable:
            return
        raise AssertionError("expected TTSUnavailable -> 503 -> browser speechSynthesis")
    finally:
        tts.polly_audio = orig


def test_cache_serves_repeat_and_stays_in_memory():
    _reset(); _with_env("test-key")
    n = {"tts": 0}

    def handler(req):
        if req.url.path == "/v1/user/subscription":
            return httpx.Response(200, json={"tier": "creator", "character_count": 0, "character_limit": 1000})
        n["tts"] += 1
        return httpx.Response(200, content=b"AUDIO")

    async def go():
        async with _client(handler) as c:
            a = await tts.synthesize("Same line.", _voice(), c)
            await _collect(a)
            b = await tts.synthesize("Same line.", _voice(), c)
            return b.provider, await _collect(b)
    assert _run(go()) == ("cache", b"AUDIO") and n["tts"] == 1


def test_guarded_patient_speaks_slower_and_steadier():
    v = _voice()
    g = tts.adjust_for_state(v, 0)
    assert g.speed < v.speed and g.stability > v.stability
    assert tts.adjust_for_state(v, 2) == v


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
