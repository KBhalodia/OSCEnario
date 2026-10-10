"""
Voice presets + automatic voice assignment for ANY persona.

assign_voice(persona) reads only profile data (sex, age, personality, communication style,
language), so a patient a faculty member types in live gets a fitting voice with no code
changes. It is deterministic: the same persona always gets the same voice.

The 8 presets below were picked by hand for the 8 seed patients; new patients get the
closest preset's delivery settings and the best-matching voice from the catalog.
No accent is ever chosen to "sound like" an ethnicity: we default to neutral American voices
and only use a non-English voice when the patient's primary language isn't English and the
voice is verified for that language.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Optional

from ..schemas import PatientProfile, Persona, VoiceProfile
from .catalog import Voice, load_catalog

DEFAULT_MODEL = "eleven_flash_v2_5"   # ElevenLabs' low-latency model, made for conversation

AGE_BANDS = ("teen", "young_adult", "middle_aged", "older_adult")

# Personality / communication-style keywords -> temperament tags.
TEMPERAMENTS: dict[str, tuple[str, ...]] = {
    "anxious": ("anxious", "nervous", "worried", "worries", "overwhelmed", "overthink", "panick",
                "fearful", "scared", "emotionally overwhelmed"),
    "talkative": ("talkative", "talks a lot", "chatty", "energetic", "lot of energy", "rambl",
                  "many questions", "asks many", "dominate"),
    "curious": ("curious", "earnest", "eager", "inquisitive", "wants to understand"),
    "reserved": ("shy", "quiet", "introvert", "reserved", "withdrawn", "avoids eye contact",
                 "brief", "concise", "few words", "self-conscious", "deflect"),
    "stoic": ("stoic", "cautious", "calm", "measured", "matter-of-fact", "literal",
              "avoids emotional"),
    "guarded": ("skeptical", "sceptical", "guarded", "mistrust", "distrust", "resistant",
                "suspicious", "defensive", "resists authority", "of authority"),
    "gruff": ("grumpy", "sarcastic", "cynical", "irritable", "dismissive", "snappy", "gruff",
              "blunt"),
    "humorous": ("humor", "humour", "funny", "jok", "witty"),
    "tired": ("tired", "fatigue", "exhausted", "depressed", "low energy", "lethargic"),
}

# How each temperament nudges delivery when the chosen preset doesn't already encode it.
NUDGES: dict[str, dict[str, float]] = {
    "anxious":   {"speed": +0.05, "stability": -0.10},
    "talkative": {"speed": +0.04, "stability": -0.05},
    "curious":   {"style": +0.05},
    "reserved":  {"speed": -0.04, "stability": +0.08},
    "stoic":     {"speed": -0.04, "stability": +0.10},
    "guarded":   {"stability": +0.05},
    "gruff":     {"style": +0.10},
    "humorous":  {"style": +0.05},
    "tired":     {"speed": -0.05, "stability": +0.08},
}

LIMITS = {"speed": (0.85, 1.12), "stability": (0.25, 0.85), "style": (0.0, 0.40)}


@dataclass(frozen=True)
class Preset:
    key: str
    label: str
    sex: str                      # "male" | "female"
    band: str                     # one of AGE_BANDS
    temperaments: frozenset[str]
    voice_name: str               # hand-picked ElevenLabs voice (resolved by name in the catalog)
    stability: float
    style: float
    speed: float
    similarity_boost: float = 0.75
    polly: str = "Matthew"
    example: str = ""             # which seed patient it was tuned on


PRESETS: list[Preset] = [
    Preset("teen_male_reserved", "Teen male, shy and guarded", "male", "teen",
           frozenset({"reserved", "guarded"}), "Will", 0.65, 0.00, 0.95, polly="Joey",
           example="Wyatt Nelson, 18"),
    Preset("young_male_guarded", "Young man, wary of the system", "male", "young_adult",
           frozenset({"guarded"}), "Liam", 0.58, 0.10, 1.00, polly="Stephen",
           example="Dominic Rivera, 22"),
    Preset("young_male_quiet", "Young man, quiet and introverted", "male", "young_adult",
           frozenset({"reserved", "tired"}), "Chris", 0.66, 0.00, 0.95, polly="Joey",
           example="Vladko Bareche, 31"),
    Preset("middle_male_direct", "Middle-aged man, direct and skeptical", "male", "middle_aged",
           frozenset({"guarded"}), "Roger", 0.55, 0.15, 1.00, polly="Matthew",
           example="Omar Sinclair, 45"),
    Preset("middle_male_stoic", "Middle-aged man, stoic and cautious", "male", "middle_aged",
           frozenset({"stoic", "reserved"}), "Brian", 0.75, 0.00, 0.92, polly="Gregory",
           example="Marcus Ramirez, 59"),
    Preset("older_male_gruff", "Older man, grumpy but humorous", "male", "older_adult",
           frozenset({"gruff", "humorous", "talkative"}), "Bill", 0.45, 0.30, 0.95,
           polly="Gregory", example="Walter Greene, 72"),
    Preset("young_female_anxious", "Young woman, anxious, many questions", "female",
           "young_adult", frozenset({"anxious", "talkative", "curious"}), "Jessica", 0.35, 0.20,
           1.05, polly="Danielle", example="Nisha Patel, 29"),
    Preset("older_female_earnest", "Older woman, earnest and overwhelmed", "female",
           "older_adult", frozenset({"curious", "anxious"}), "Matilda", 0.50, 0.10, 0.97,
           polly="Joanna", example="Yvette Armstrong, 64"),
]
PRESETS_BY_KEY = {p.key: p for p in PRESETS}

# Polly fallback when no preset voice fits (sex x band). Neural US-English voices.
POLLY_BY_GROUP = {
    ("male", "teen"): "Joey", ("male", "young_adult"): "Stephen",
    ("male", "middle_aged"): "Matthew", ("male", "older_adult"): "Gregory",
    ("female", "teen"): "Salli", ("female", "young_adult"): "Danielle",
    ("female", "middle_aged"): "Joanna", ("female", "older_adult"): "Ruth",
}


# --------------------------------------------------------------------------
# Reading the persona
# --------------------------------------------------------------------------

def norm_sex(s: Optional[str]) -> str:
    s = (s or "").strip().lower()
    if s in ("m", "male", "man", "boy") or s.startswith("male"):
        return "male"
    if s in ("f", "female", "woman", "girl") or s.startswith("female"):
        return "female"
    return ""


def age_band(age: Optional[int]) -> str:
    if age is None:
        return "middle_aged"
    if age <= 19:
        return "teen"
    if age <= 35:
        return "young_adult"
    if age <= 59:
        return "middle_aged"
    return "older_adult"


def temperaments(p: Persona) -> set[str]:
    text = " ".join([p.personality, p.communication_style]).lower()
    return {t for t, words in TEMPERAMENTS.items() if any(w in text for w in words)}


_LANGS = {"english": "en", "spanish": "es", "hindi": "hi", "gujarati": "gu", "french": "fr",
          "portuguese": "pt", "arabic": "ar", "chinese": "zh", "mandarin": "zh", "russian": "ru",
          "polish": "pl", "italian": "it", "german": "de", "korean": "ko", "japanese": "ja",
          "tagalog": "tl", "vietnamese": "vi", "haitian creole": "ht", "urdu": "ur", "bengali": "bn"}


def primary_language(p: Persona) -> str:
    """ISO code of the language named first (or marked 'primary'); 'en' if unclear."""
    text = (p.language or "").lower()
    if not text:
        return "en"
    m = re.search(r"([a-z ]+?)\s*\(primary", text)
    if m and m.group(1).strip() in _LANGS:
        return _LANGS[m.group(1).strip()]
    hits = sorted((text.find(name), code) for name, code in _LANGS.items() if name in text)
    return hits[0][1] if hits else "en"


# --------------------------------------------------------------------------
# Choosing
# --------------------------------------------------------------------------

def _band_distance(a: str, b: str) -> int:
    return abs(AGE_BANDS.index(a) - AGE_BANDS.index(b))


def closest_preset(p: Persona) -> Preset:
    sex, band, temps = norm_sex(p.sex), age_band(p.age), temperaments(p)

    def score(pr: Preset) -> float:
        s = 0.0
        if sex:
            s += 3 if pr.sex == sex else -6
        s -= 1.5 * _band_distance(pr.band, band)
        s += 1.0 * len(pr.temperaments & temps)
        return s
    return max(PRESETS, key=score)   # max() keeps the first on ties -> deterministic


_VOICE_AGE_FIT = {  # persona band -> ElevenLabs age label -> fit 0..2
    "teen": {"young": 2, "middle_aged": 0, "old": -2},
    "young_adult": {"young": 2, "middle_aged": 1, "old": -1},
    "middle_aged": {"young": 0, "middle_aged": 2, "old": 1},
    "older_adult": {"young": -2, "middle_aged": 1, "old": 2},
}
_NEUTRAL_ACCENTS = {"", "american", "us", "standard american", "general american", "neutral"}


def _stable(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def pick_voice(p: Persona, preset: Preset, catalog: Optional[list[Voice]] = None) -> Optional[Voice]:
    catalog = catalog if catalog is not None else load_catalog()
    sex, band, lang = norm_sex(p.sex), age_band(p.age), primary_language(p)

    def score(v: Voice) -> Optional[float]:
        if sex and v.gender and v.gender not in (sex, "neutral"):
            return None
        s = 0.0
        s += 4 if v.gender == sex else (1 if v.gender == "neutral" else 0)
        s += 1.5 * _VOICE_AGE_FIT[band].get(v.age, 0)
        if lang != "en" and lang in v.languages and v.accent not in _NEUTRAL_ACCENTS:
            s += 1.5           # a voice verified for the patient's own language
        elif v.accent in _NEUTRAL_ACCENTS:
            s += 1.0
        if v.short_name == preset.voice_name.lower():
            s += 2.5           # hand-picked voice for this preset
        return s

    scored = [(s, v) for v in catalog if (s := score(v)) is not None]
    if not scored:
        return None
    key = f"{p.name}|{p.age}|{sex}"
    scored.sort(key=lambda sv: (-sv[0], _stable(key, sv[1].voice_id)))
    return scored[0][1]


def _clamp(name: str, x: float) -> float:
    lo, hi = LIMITS[name]
    return round(min(hi, max(lo, x)), 2)


def delivery(p: Persona, preset: Preset) -> dict[str, float]:
    out = {"speed": preset.speed, "stability": preset.stability, "style": preset.style}
    for t in sorted(temperaments(p) - preset.temperaments):
        for k, d in NUDGES[t].items():
            out[k] += d
    return {k: _clamp(k, v) for k, v in out.items()}


def assign_voice(persona: Persona, catalog: Optional[list[Voice]] = None) -> VoiceProfile:
    """A fitting, deterministic voice for any persona (sample or brand-new)."""
    preset = closest_preset(persona)
    voice = pick_voice(persona, preset, catalog)
    d = delivery(persona, preset)
    sex, band = norm_sex(persona.sex), age_band(persona.age)
    polly = preset.polly if (preset.sex == sex and preset.band == band) else \
        POLLY_BY_GROUP.get((sex or preset.sex, band), preset.polly)
    if voice is None:   # empty catalog: Polly only
        return VoiceProfile(provider="polly", voice_id=polly, fallback_polly_voice=polly,
                            preset=preset.key, origin="auto", **d)
    return VoiceProfile(provider="elevenlabs", voice_id=voice.voice_id, model_id=DEFAULT_MODEL,
                        similarity_boost=preset.similarity_boost, fallback_polly_voice=polly,
                        preset=preset.key, origin="auto", **d)


def ensure_voice(profile: PatientProfile, force: bool = False) -> PatientProfile:
    """Call on every create / import / load. Fills persona.voice when empty; with force=True
    re-maps auto voices too. Never overwrites a voice faculty chose (origin == "faculty")."""
    v = profile.persona.voice
    if v is None or (force and v.origin != "faculty"):
        profile.persona.voice = assign_voice(profile.persona)
    return profile


def preset_table() -> list[dict]:
    """For the Studio dropdown: presets with their resolved voice ids."""
    cat = load_catalog()
    out = []
    for pr in PRESETS:
        v = next((x for x in cat if x.short_name == pr.voice_name.lower()), None)
        out.append({"key": pr.key, "label": pr.label, "example": pr.example,
                    "voice_id": v.voice_id if v else "", "voice_name": pr.voice_name,
                    "stability": pr.stability, "style": pr.style, "speed": pr.speed,
                    "similarity_boost": pr.similarity_boost, "fallback_polly_voice": pr.polly})
    return out
