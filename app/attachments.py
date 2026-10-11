"""
Which kinds of test results does a patient's chart hold (labs, X-ray, ECG...)?

    available_kinds(profile) -> {"labs", "imaging", ...}

Driven by data/artifact_requirements.json. The feedback engine uses it to skip EPA 3
(interpret tests) when the chart has no test results at all.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from .schemas import PatientProfile

REQ_FILE = Path(__file__).resolve().parents[1] / "data" / "artifact_requirements.json"


@lru_cache(maxsize=1)
def kinds() -> dict:
    return json.loads(REQ_FILE.read_text(encoding="utf-8"))["kinds"]


def _has_word(text: str, word: str) -> bool:
    w = word.lower()
    if w.startswith(" ") or w.endswith(" "):          # padded words like " ct " need spacing
        return w in f" {text} "
    return re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) is not None


def available_kinds(profile: PatientProfile) -> set[str]:
    have: set[str] = set()
    for a in profile.artifacts:
        has_content = bool(a.items or (a.text or "").strip() or a.file_path)
        if not has_content:
            continue
        blob = " ".join([a.title, a.text or "", a.file_path or "",
                         " ".join(f"{i.label} {i.value}" for i in a.items)]).lower()
        for k, spec in kinds().items():
            if a.type.value in spec["artifact_types"] or any(_has_word(blob, w) for w in spec["artifact_words"]):
                have.add(k)
    for d in profile.documents:
        if d.kind.value == "patient_record":
            blob = f"{d.name} {d.text[:3000]}".lower()
            have |= {k for k, spec in kinds().items() if any(_has_word(blob, w) for w in spec["artifact_words"])}
    return have
