"""
Link each expected discovery in the learning objectives to the facts that satisfy it.
One smart-model call per patient. Run it after import/generation and whenever faculty
edit facts or objectives. Replaces the weak lexical seed links.
"""
from __future__ import annotations

import json

from .bedrock import LLM, smart_model
from .schemas import PatientProfile

SYSTEM = """You are helping a health-professions faculty member set up a virtual patient for grading.
For each EXPECTED DISCOVERY (something a student should find out during the interview), list the ids
of the FACTS whose disclosure would show the student found it.

Rules:
- Link a fact only if hearing it would genuinely count as discovering that item.
- Prefer 1-4 facts per discovery. An empty list is correct when no fact supports it (for example,
  the discovery is about what the student should *do*, like "develop a PES statement").
- Use only fact ids from the list. Never invent ids.
- Return every discovery id exactly once."""

SCHEMA = {
    "type": "object",
    "properties": {
        "links": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "discovery_id": {"type": "string"},
                    "fact_ids": {"type": "array", "items": {"type": "string"}},
                    "skill_only": {"type": "boolean",
                                   "description": "true if this item is a student action, not information to elicit"},
                },
                "required": ["discovery_id", "fact_ids", "skill_only"],
            },
        }
    },
    "required": ["links"],
}


def link_objectives(profile: PatientProfile, llm: LLM, model: str | None = None) -> PatientProfile:
    facts = [{"id": f.id, "category": f.category.value, "content": f.content} for f in profile.facts]
    discoveries = [{"id": d.id, "objective": o.objective, "text": d.text}
                   for o in profile.objectives for d in o.expected_discoveries]
    if not discoveries:
        return profile

    out = llm.call_json(
        model=model or smart_model(), system=SYSTEM, schema=SCHEMA, tool_name="objective_links",
        user=f"FACTS:\n{json.dumps(facts, indent=0)}\n\nEXPECTED DISCOVERIES:\n{json.dumps(discoveries, indent=0)}",
        max_tokens=4096)

    valid = {f.id for f in profile.facts}
    by_id = {link["discovery_id"]: link for link in out.get("links", [])}
    for o in profile.objectives:
        for d in o.expected_discoveries:
            link = by_id.get(d.id)
            if link is None:
                continue  # keep the old (lexical) link rather than silently dropping it
            d.linked_fact_ids = [fid for fid in link.get("fact_ids", []) if fid in valid]
            d.link_method = "llm_skill" if link.get("skill_only") else "llm"
    return profile
