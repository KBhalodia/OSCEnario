"""
The list of voices we can choose from, with the labels assign_voice() filters on.

Source of truth is ElevenLabs' GET /v2/voices, cached in voice_catalog.json by
`python -m scripts.assign_voices --refresh`. Until that has run (no API key yet, or offline),
BUILTIN below is used: ElevenLabs' premade default voices. The cache file is committed so
every teammate and the importer get the same, deterministic choices without network access.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

import httpx
from pydantic import BaseModel

API = "https://api.elevenlabs.io"
CATALOG_PATH = Path(__file__).with_name("voice_catalog.json")


class Voice(BaseModel):
    voice_id: str
    name: str
    gender: str = ""          # "male" | "female" | "neutral"
    age: str = ""             # "young" | "middle_aged" | "old"
    accent: str = ""
    description: str = ""
    use_case: str = ""
    languages: list[str] = []  # ISO codes this voice is verified for, if known
    category: str = "premade"
    preview_url: Optional[str] = None

    @property
    def short_name(self) -> str:
        """'Will - Relaxed Optimist' -> 'will' (the live API appends a tagline to the name)."""
        return self.name.split(" - ")[0].strip().lower()


def _v(voice_id, name, gender, age, accent, description):
    return Voice(voice_id=voice_id, name=name, gender=gender, age=age, accent=accent,
                 description=description, languages=["en"])


# ElevenLabs premade voices (labels as published by ElevenLabs). Replaced by the live list
# as soon as the catalog is refreshed with an API key.
BUILTIN: list[Voice] = [
    _v("CwhRBWXzGAHq8TQ4Fs17", "Roger", "male", "middle_aged", "american", "confident, laid-back"),
    _v("EXAVITQu4vr4xnSDxMaL", "Sarah", "female", "young", "american", "soft, reassuring"),
    _v("FGY2WhTYpPnrIDTdsKH5", "Laura", "female", "young", "american", "upbeat, quirky"),
    _v("IKne3meq5aSn9XLyUdCD", "Charlie", "male", "middle_aged", "australian", "natural, casual"),
    _v("JBFqnCBsd6RMkjVDRZzb", "George", "male", "middle_aged", "british", "warm storyteller"),
    _v("N2lVS1w4EtoT3dr4eOWO", "Callum", "male", "middle_aged", "transatlantic", "husky, intense"),
    _v("SAz9YHcvj6GT2YYXdXww", "River", "neutral", "middle_aged", "american", "relaxed, neutral"),
    _v("TX3LPaxmHKxFdv7VOQHJ", "Liam", "male", "young", "american", "articulate, energetic"),
    _v("Xb7hH8MSUJpSbSDYk0k2", "Alice", "female", "middle_aged", "british", "clear, confident"),
    _v("XrExE9yKIg1WjnnlVkGX", "Matilda", "female", "middle_aged", "american", "warm, friendly"),
    _v("bIHbv24MWmeRgasZH58o", "Will", "male", "young", "american", "friendly, relaxed"),
    _v("cgSgspJ2msm6clMCkdW9", "Jessica", "female", "young", "american", "expressive, playful"),
    _v("cjVigY5qzO86Huf0OWal", "Eric", "male", "middle_aged", "american", "smooth, trustworthy"),
    _v("iP95p4xoKVk53GoZ742B", "Chris", "male", "middle_aged", "american", "charming, down-to-earth"),
    _v("nPczCjzI2devNBz1zQrb", "Brian", "male", "middle_aged", "american", "deep, resonant"),
    _v("onwK4e9ZLuTAKqWW03F9", "Daniel", "male", "middle_aged", "british", "steady, measured"),
    _v("pFZP5JQG7iQjIQuC4Bku", "Lily", "female", "middle_aged", "british", "velvety, warm"),
    _v("pqHfZKP75CvOlQylNhV4", "Bill", "male", "old", "american", "wise, mature, crisp"),
]


def _norm_age(s: str) -> str:
    s = (s or "").lower().replace(" ", "_").replace("-", "_")
    if s in ("young", "middle_aged", "old"):
        return s
    if "old" in s or "senior" in s or "elder" in s:
        return "old"
    if "middle" in s:
        return "middle_aged"
    return "young" if s else ""


def voice_from_api(d: dict) -> Voice:
    labels = d.get("labels") or {}
    langs = sorted({(x.get("language") or "").lower()
                    for x in (d.get("verified_languages") or []) if x.get("language")})
    return Voice(
        voice_id=d["voice_id"], name=d.get("name", ""),
        gender=(labels.get("gender") or "").lower(), age=_norm_age(labels.get("age", "")),
        accent=(labels.get("accent") or "").lower(),
        description=d.get("description") or labels.get("description") or "",
        use_case=labels.get("use_case") or labels.get("use case") or "",
        languages=langs or ["en"], category=d.get("category") or "",
        preview_url=d.get("preview_url"))


def api_key() -> str:
    return os.environ.get("ELEVENLABS_API_KEY", "").strip()


def fetch_voices(key: Optional[str] = None) -> list[Voice]:
    """All voices this account can use (premade + any the team added), via GET /v2/voices."""
    key = key or api_key()
    voices, token = [], None
    with httpx.Client(timeout=20) as c:
        while True:
            params = {"page_size": 100}
            if token:
                params["next_page_token"] = token
            r = c.get(f"{API}/v2/voices", headers={"xi-api-key": key}, params=params)
            r.raise_for_status()
            body = r.json()
            voices += [voice_from_api(v) for v in body.get("voices", [])]
            token = body.get("next_page_token")
            if not body.get("has_more") or not token:
                break
    return voices


def save_catalog(voices: list[Voice]) -> None:
    CATALOG_PATH.write_text(json.dumps([v.model_dump() for v in voices], indent=1), encoding="utf-8")


_cache: Optional[list[Voice]] = None


def load_catalog() -> list[Voice]:
    global _cache
    if _cache is None:
        if CATALOG_PATH.exists():
            _cache = [Voice(**v) for v in json.loads(CATALOG_PATH.read_text(encoding="utf-8"))]
        else:
            _cache = list(BUILTIN)
    return _cache


def reset_cache() -> None:
    global _cache
    _cache = None


def get_voice(voice_id: str) -> Optional[Voice]:
    return next((v for v in load_catalog() if v.voice_id == voice_id), None)
