"""
End-of-encounter diagnosis question (M3/M4): the student types their working diagnosis and an
optional differential; one AI call compares it with the faculty's answer key (primary diagnosis,
secondary diagnoses), allowing synonyms and abbreviations. The answer key is never shown to the
student before they answer.
"""
from __future__ import annotations

from typing import Optional

from ..bedrock import LLM, fast_model
from ..schemas import PatientProfile

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["correct", "partially_correct", "incorrect"]},
        "matched": {"type": "string", "description": "which answer-key diagnosis the student's answer matches, or empty"},
        "differential_hits": {"type": "array", "items": {"type": "string"},
                              "description": "answer-key diagnoses that appear in the student's differential"},
        "explanation": {"type": "string", "description": "2-3 sentences to the student, plain language"},
    },
    "required": ["verdict", "matched", "differential_hits", "explanation"],
}

SYSTEM = """You grade a health-professions student's working diagnosis after a simulated patient interview.
Compare it with the faculty answer key. Accept synonyms, abbreviations and equivalent clinical terms
("T2DM" = "type 2 diabetes mellitus"; "high blood pressure" = "hypertension").
- correct: the main answer-key diagnosis is named (qualifiers like "poorly controlled" are a bonus, not required).
- partially_correct: right organ system or a closely related condition, or the main diagnosis only in the differential,
  or too vague ("blood sugar problem").
- incorrect: otherwise.
Be brief, kind and specific in the explanation, and say what clue in the history pointed to the answer."""


def answer_key(profile: PatientProfile) -> list[str]:
    return [d for d in [profile.primary_diagnosis, *profile.secondary_diagnoses] if d]


def grade_diagnosis(profile: PatientProfile, diagnosis: Optional[str], differential: list[str],
                    reasoning: str, llm: LLM, model: Optional[str] = None) -> dict:
    key = answer_key(profile)
    out = {"asked": True, "submitted": (diagnosis or "").strip(), "differential": [d for d in differential if d.strip()],
           "reasoning": reasoning.strip(), "expected": key}
    if not out["submitted"]:
        return {**out, "verdict": "not_answered", "matched": "", "differential_hits": [],
                "explanation": "No diagnosis was entered."}
    if not key:
        return {**out, "verdict": "not_graded", "matched": "", "differential_hits": [],
                "explanation": "This patient has no diagnosis on file, so the answer wasn't graded."}
    user = (f"ANSWER KEY (main first): {key}\n"
            f"STUDENT WORKING DIAGNOSIS: {out['submitted']}\n"
            f"STUDENT DIFFERENTIAL: {out['differential'] or '(none)'}\n"
            f"STUDENT REASONING: {out['reasoning'] or '(none)'}")
    r = llm.call_json(model=model or fast_model(), system=SYSTEM, user=user,
                      tool_name="diagnosis_check", schema=SCHEMA)
    return {**out, "verdict": r.get("verdict", "incorrect"), "matched": r.get("matched", ""),
            "differential_hits": r.get("differential_hits", []), "explanation": r.get("explanation", "")}
