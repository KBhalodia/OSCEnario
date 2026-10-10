"""
Does a rubric item need an attachment the patient doesn't have?

    available_kinds(profile)                 -> {"labs", "audiogram", ...}
    required_kinds(text)                     -> kinds a rubric line depends on
    checklist_applicability(profile, rubric) -> {item_id: [missing kinds]}  (empty list = applicable)

Driven by data/artifact_requirements.json. Used by:
  - the feedback engine: items needing a missing attachment are "not_applicable"
    and their points leave the maximum, so students aren't graded on the impossible
  - the Studio validator: tells faculty which rubric parts will be skipped and
    what to upload to include them
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


def required_kinds(text: str) -> set[str]:
    t = text.lower()
    return {k for k, spec in kinds().items() if any(_has_word(t, w) for w in spec["rubric_words"])}


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


def checklist_applicability(profile: PatientProfile, rubric: dict) -> dict[str, list[str]]:
    """Section wording applies to all of its items ("Review the client's audiogram" -> every item)."""
    have = available_kinds(profile)
    out: dict[str, list[str]] = {}
    for sec in rubric.get("sections", []):
        sec_needs = required_kinds(sec["name"])
        for it in sec["items"]:
            needs = sec_needs | required_kinds(it["text"])
            out[it["id"]] = sorted(needs - have)
    return out


def label(kind: str) -> str:
    return kinds().get(kind, {}).get("label", kind)
