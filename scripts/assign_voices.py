"""
Voice setup for the seed patients.

    python -m scripts.assign_voices --check            # is the ElevenLabs key valid? credits left?
    python -m scripts.assign_voices --refresh          # cache the account's voice list (GET /v2/voices)
    python -m scripts.assign_voices --samples samples  # write persona.voice into samples/*.json
    python -m scripts.assign_voices --refresh --samples samples --say "Hello there."
                                                       # ...and synthesize one line per patient
                                                       #    (played from memory, never saved)

Needs ELEVENLABS_API_KEY in the environment for --check / --refresh / --say.
Faculty-chosen voices (origin == "faculty") are never overwritten.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.schemas import PatientProfile  # noqa: E402
from app.voice import catalog, tts  # noqa: E402
from app.voice.profiles import PRESETS, ensure_voice  # noqa: E402


def check() -> bool:
    if not catalog.api_key():
        print("ELEVENLABS_API_KEY is not set.")
        return False
    u = asyncio.run(tts.elevenlabs_usage(max_age=0))
    if u.error:
        print(f"ElevenLabs: {u.error}")
        return "HTTP 401" not in u.error
    print(f"ElevenLabs OK  tier={u.tier}  used={u.used:,} / {u.limit:,}  remaining={u.remaining:,}")
    return True


def refresh() -> None:
    voices = catalog.fetch_voices()
    catalog.save_catalog(voices)
    catalog.reset_cache()
    print(f"Cached {len(voices)} voices -> {catalog.CATALOG_PATH.name}")
    names = {v.name.lower() for v in voices}
    for p in PRESETS:
        if p.voice_name.lower() not in names:
            print(f"  ! preset {p.key}: voice '{p.voice_name}' not in this account; "
                  "assign_voice will pick the closest match instead")


def write_samples(folder: Path) -> list[PatientProfile]:
    out = []
    for f in sorted(folder.glob("*.json")):
        p = PatientProfile.model_validate_json(f.read_text(encoding="utf-8"))
        ensure_voice(p, force=True)
        f.write_text(p.model_dump_json(indent=2), encoding="utf-8")
        v = p.persona.voice
        name = (catalog.get_voice(v.voice_id).name if catalog.get_voice(v.voice_id) else v.voice_id)
        print(f"  {p.persona.name:18} {v.preset:22} {name:10} speed={v.speed} "
              f"stability={v.stability} style={v.style} polly={v.fallback_polly_voice}")
        out.append(p)
    ids = [p.persona.voice.voice_id for p in out]
    print(f"{len(out)} patients, {len(set(ids))} distinct voices")
    return out


async def say(profiles: list[PatientProfile], text: str) -> None:
    async with httpx.AsyncClient(timeout=30) as c:
        for p in profiles:
            try:
                sp = await tts.synthesize(text, p.persona.voice, c)
                n = sum([len(b) async for b in sp.stream])
                print(f"  {p.persona.name:18} {sp.provider:10} {n:,} bytes")
            except tts.TTSUnavailable as e:
                print(f"  {p.persona.name:18} FAILED {e}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--samples")
    ap.add_argument("--say")
    a = ap.parse_args()
    if a.check or a.refresh or a.say:
        if not check():
            sys.exit(1)
    if a.refresh:
        refresh()
    profiles = write_samples(Path(a.samples)) if a.samples else []
    if a.say and profiles:
        asyncio.run(say(profiles, a.say))


if __name__ == "__main__":
    main()
