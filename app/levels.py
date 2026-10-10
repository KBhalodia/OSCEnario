"""
Year levels (M1..M4). All behaviour comes from data/levels.json - edit that, not code.

    apply_level(profile, "M1")  -> a COPY of the profile tuned for that level
                                   (opening trust, how much trust facts need,
                                   patient behaviour notes). The stored profile
                                   never changes, so one patient serves every year.
    graded_objectives(profile, level) -> objectives that count at this level
    domain_modes(level)         -> {rubric_domain_key: "core" | "lenient" | "na"}
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .schemas import Disclosure, LearningObjective, PatientProfile

LEVELS_FILE = Path(__file__).resolve().parents[1] / "data" / "levels.json"
DEFAULT_LEVEL = "M2"


@lru_cache(maxsize=1)
def load_levels() -> dict:
    return json.loads(LEVELS_FILE.read_text(encoding="utf-8"))


def level_names() -> list[str]:
    return list(load_levels()["order"])


def get_level(level: str | None) -> dict:
    levels = load_levels()["levels"]
    if level not in levels:
        level = DEFAULT_LEVEL
    return {"key": level, **levels[level]}


def level_rank(level: str | None) -> int:
    order = level_names()
    return order.index(level) if level in order else order.index(DEFAULT_LEVEL)


def apply_level(profile: PatientProfile, level: str | None) -> PatientProfile:
    cfg = get_level(level)["patient"]
    p = profile.model_copy(deep=True)
    p.settings.opening_trust = _clamp(p.settings.opening_trust + int(cfg.get("opening_trust_delta", 0)))
    shift = int(cfg.get("min_trust_shift", 0))
    for f in p.facts:
        if f.disclosure in (Disclosure.discoverable, Disclosure.reluctant):
            # reluctant facts always need *some* trust, even for beginners
            floor = 1 if f.disclosure == Disclosure.reluctant else 0
            f.min_trust = max(floor, _clamp(f.min_trust + shift))
    p.settings.difficulty_notes = cfg.get("notes", "")
    return p


def graded_objectives(profile: PatientProfile, level: str | None) -> list[LearningObjective]:
    rank = level_rank(level)
    return [o for o in profile.objectives if o.min_level is None or level_rank(o.min_level) <= rank]


def domain_modes(level: str | None) -> dict[str, str]:
    return dict(get_level(level)["grading"]["domains"])


FRAMEWORK_DIR = LEVELS_FILE.parent / "frameworks"


@lru_cache(maxsize=4)
def load_framework(framework_id: str | None = None) -> dict:
    fid = framework_id or load_levels().get("framework", "aamc_core_epas")
    return json.loads((FRAMEWORK_DIR / f"{fid}.json").read_text(encoding="utf-8"))


def epa_targets(level: str | None) -> dict[str, int]:
    """{EPA id: expected supervision level} for the EPAs in focus at this year."""
    return dict(get_level(level)["grading"].get("epa_targets", {}))


def _clamp(v: int) -> int:
    return max(0, min(3, v))
