"""
Turn a faculty checklist rubric (DOCX/PDF/TXT) into a structured checklist the
feedback engine can grade, e.g. the Pediatric Hearing Treatment rubric:

    Introduce yourself to the client (10 points)
      Behave in a professional manner
      Use professional and empathetic language throughout the session
    Engage in a Needs Assessment with the client (30 points)
      ...

    import_checklist(path, llm=None) -> dict   (saved to data/rubrics/<id>.json)

First tries a plain parser for the common "Section (N points)" layout. If that finds
nothing, Claude converts the document instead.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from ..importers import slugify
from .documents import extract_text

RUBRIC_DIR = Path(__file__).resolve().parents[2] / "data" / "rubrics"
SECTION = re.compile(r"^(?P<name>.+?)\s*\(\s*(?P<pts>\d+)\s*(?:points?|pts?)\s*\)\s*$", re.I)


def parse_checklist_text(text: str, title: str = "") -> Optional[dict]:
    lines = [ln.strip(" \t•-*") for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    header, sections, prefix = [], [], ""
    for ln in lines:
        m = SECTION.match(ln)
        if m:
            sections.append({"name": m["name"].strip(), "points": int(m["pts"]), "items": []})
            prefix = ""
            continue
        if not sections:
            header.append(ln)
            continue
        if ln.endswith(":"):                    # "Review the following info with the client:"
            prefix = ln[:-1].strip()
            continue
        sections[-1]["items"].append(f"{prefix}: {ln}" if prefix else ln)
    if not sections:
        return None
    for s, sec in enumerate(sections, start=1):
        if not sec["items"]:                    # a section with no sub-items is itself the item
            sec["items"] = [sec["name"]]
        sec["id"] = f"s{s}"
        sec["items"] = [{"id": f"s{s}.i{i}", "text": t} for i, t in enumerate(sec["items"], start=1)]
    title = title or " - ".join(header[:4])
    return {"id": slugify(title)[:60] or "checklist", "type": "checklist", "title": title,
            "context": header, "sections": sections,
            "max_points": sum(s["points"] for s in sections),
            "scoring": "Each section's points are split evenly across its items. "
                       "Achieved = full share, partial = half, not achieved = 0."}


LLM_SCHEMA = {"type": "object", "properties": {
    "title": {"type": "string"},
    "sections": {"type": "array", "items": {"type": "object", "properties": {
        "name": {"type": "string"}, "points": {"type": "integer"},
        "items": {"type": "array", "items": {"type": "string"}}},
        "required": ["name", "points", "items"]}}},
    "required": ["title", "sections"]}


def import_checklist(path: str | Path, llm=None, model: Optional[str] = None,
                     save: bool = True) -> dict:
    path = Path(path)
    text = extract_text(path)
    rubric = parse_checklist_text(text)
    if rubric is None:
        if llm is None:
            raise ValueError("Could not find '(N points)' sections; pass an llm to convert it.")
        out = llm.call_json(
            model=model, tool_name="checklist_rubric", schema=LLM_SCHEMA, max_tokens=3000,
            system="Convert this grading rubric into sections with point values and observable checklist "
                   "items. Keep the faculty wording. If no points are given, give each section 10.",
            user=text[:20000])
        lines = []
        for s in out["sections"]:
            lines.append(f"{s['name']} ({s['points']} points)")
            lines.extend(s["items"])
        rubric = parse_checklist_text("\n".join(lines), title=out.get("title", path.stem))
    rubric["source_file"] = path.name
    if save:
        RUBRIC_DIR.mkdir(parents=True, exist_ok=True)
        (RUBRIC_DIR / f"{rubric['id']}.json").write_text(json.dumps(rubric, indent=2), encoding="utf-8")
    return rubric
