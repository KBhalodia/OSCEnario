"""
Patient Studio extraction.

Takes one block of free-text clinical case notes (what faculty paste into the
"Patient Case Information" box in patient-studio) and asks Claude to pull out
only the facts that are actually stated, mapped to the exact field names the
Patient Studio HTML app uses.

This reuses the existing secure Bedrock integration in app/bedrock.py, so no
AWS credentials ever reach the browser. The browser calls a small local server
(scripts/studio_server.py) which calls extract_case() here.

Output shape (matches the HTML app's patient object, review-only fields added):

    {
      "title": str,
      "name": str,
      "age": str,                 # kept as string; HTML app stores age as text
      "sex": "Female"|"Male"|"Other"|"",
      "greeting": str,
      "objectives": [str, ...],
      "facts": [
        {"tab": "summary"|"history"|"meds"|"labs",
         "label": str, "value": str, "triggers": [str,...], "key": bool}
      ],
      "artifacts": [
        {"name": str, "type": <ARTIFACT_TYPES>, "finding": str,
         "abnormal": bool, "triggers": [str,...]}
      ],
      "sources": [{"title": str, "note": str}],
      "missing": [str, ...],      # important things NOT found in the text (for faculty)
      "assumptions": [str, ...]   # anything inferred rather than stated verbatim
    }

Everything the model returns is treated as a *suggestion* for faculty to review.
Nothing here saves, publishes, or bypasses the app's consistency checks.
"""
from __future__ import annotations

from typing import Any

from .bedrock import LLM, smart_model

# The chart sections and artifact types the HTML app understands. Keep these in
# sync with TABS and ARTIFACT_TYPES in patient-studio.
CHART_TABS = ["summary", "history", "meds", "labs"]
ARTIFACT_TYPES = ["Lab report", "ECG", "X-ray", "CT scan", "Prior note", "Other"]

# Temperament dropdown values, kept in sync with TEMPERAMENT_OPTIONS and
# COMM_STYLE_OPTIONS in patient-studio. "" means "the text does not say".
TEMPERAMENT_OPTIONS = [
    "", "Calm and cooperative", "Anxious or worried", "Fearful or hesitant",
    "Frustrated or angry", "Withdrawn or quiet", "Tearful or distressed",
    "Guarded or distrustful", "Confused or overwhelmed",
    "Variable depending on the conversation",
]
COMM_STYLE_OPTIONS = [
    "", "Open and forthcoming", "Brief answers; needs prompting", "Talkative and detailed",
    "Hesitant and uncertain", "Defensive or resistant", "Reassurance-seeking",
    "Difficulty expressing concerns",
]

EXTRACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short case title for the faculty library, e.g. 'Chest pain in a smoker'. May be inferred from the complaint."},
        "name": {"type": "string", "description": "Patient name exactly as written. Empty string if not stated."},
        "age": {"type": "string", "description": "Age as stated (digits only if possible). Empty string if not stated. Never guess."},
        "sex": {"type": "string", "enum": ["Female", "Male", "Other", ""], "description": "Only if explicitly stated; otherwise empty string."},
        "greeting": {"type": "string", "description": "A short, natural opening line the patient might say. Generic and non-clinical. Empty string if unsure."},
        "objectives": {
            "type": "array", "items": {"type": "string"},
            "description": "Learning objectives ONLY if the text states them. Do not invent teaching goals. Empty array if none.",
        },
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tab": {"type": "string", "enum": CHART_TABS},
                    "label": {"type": "string"},
                    "value": {"type": "string", "description": "The fact exactly as supported by the text. Keep units, dates, negations and uncertainty."},
                    "triggers": {"type": "array", "items": {"type": "string"}, "description": "Lowercase words a student might ask to unlock this fact."},
                    "key": {"type": "boolean", "description": "true only for clearly central findings."},
                },
                "required": ["tab", "label", "value", "triggers", "key"],
            },
            "description": "One entry per discrete stated fact. summary=chief complaint/vitals overview, history=HPI/PMH/social, meds=medications & allergies, labs=lab values.",
        },
        "artifacts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "type": {"type": "string", "enum": ARTIFACT_TYPES},
                    "finding": {"type": "string", "description": "Finding exactly as stated. Keep values, units, laterality."},
                    "abnormal": {"type": "boolean"},
                    "triggers": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "type", "finding", "abnormal", "triggers"],
            },
            "description": "Investigations/results that are concrete artifacts: labs, ECG, imaging, prior notes. Only if present in the text.",
        },
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "note": {"type": "string"}},
                "required": ["title", "note"],
            },
            "description": "Guidelines/references ONLY if the text cites them. Usually empty.",
        },
        "temperament": {
            "type": "object",
            "description": "How the patient BEHAVES and COMMUNICATES, but ONLY when the case text explicitly describes it "
                           "(e.g. 'appears anxious', 'answers in one word', 'becomes tearful', 'defensive when asked about drinking'). "
                           "NEVER infer behaviour from the diagnosis, age, sex, or any stereotype. If the text does not describe "
                           "behaviour, omit this object entirely or leave each field an empty string.",
            "properties": {
                "temperament": {"type": "string", "enum": TEMPERAMENT_OPTIONS,
                                "description": "Closest matching overall mood, only if explicitly described. Else empty string."},
                "communicationStyle": {"type": "string", "enum": COMM_STYLE_OPTIONS,
                                        "description": "Closest matching way of talking, only if explicitly described. Else empty string."},
                "emotionalCues": {"type": "string", "description": "Observable behaviours stated in the text (e.g. avoids eye contact, speaks softly). Verbatim-grounded. Else empty."},
                "triggers": {"type": "string", "description": "Topics/styles the text says upset or guard the patient. Else empty."},
                "empathyResponse": {"type": "string", "description": "How the text says the patient responds to empathy/reassurance. Else empty."},
                "progression": {"type": "string", "description": "How the text says the patient's behaviour changes during the encounter. Else empty."},
                "facultyNotes": {"type": "string", "description": "Any other explicitly stated behavioural detail. Else empty."},
            },
            "required": ["temperament", "communicationStyle", "emotionalCues",
                         "triggers", "empathyResponse", "progression", "facultyNotes"],
        },
        "missing": {
            "type": "array", "items": {"type": "string"},
            "description": "Important clinical items a complete case usually has but this text does NOT state (e.g. 'No allergies mentioned', 'No vital signs given'). For faculty review.",
        },
        "assumptions": {
            "type": "array", "items": {"type": "string"},
            "description": "Anything you inferred rather than copied verbatim (e.g. 'Inferred sex from pronouns'). Empty if everything was explicit.",
        },
    },
    "required": ["title", "name", "age", "sex", "greeting", "objectives",
                 "facts", "artifacts", "sources", "missing", "assumptions"],
}

EXTRACT_SYSTEM = """You extract structured data from a clinical teaching case for a medical-education tool. \
You are NOT writing a case; you only pull out what the text already says.

ABSOLUTE RULES (this is a clinical education tool, accuracy matters more than completeness):
1. Never invent, assume, or 'fill in' clinical facts: no diagnoses, test results, medications, \
doses, allergies, vital signs, or demographics that are not written in the text.
2. If something is not stated, leave that field empty / omit it and add it to "missing". \
Do not guess an age, sex, or name.
3. Preserve clinically meaningful detail exactly: numbers, units, dates, laterality (left/right), \
and negations ("no chest pain", "denies fever") and uncertainty ("possible", "query").
4. A negation is a fact worth keeping (e.g. "No known drug allergies"), not an empty field.
5. Put each discrete fact in the most appropriate chart section (tab). Keep facts atomic.
6. For "triggers", give lowercase words a student might naturally ask about to reveal that fact.
7. If you inferred anything (e.g. sex from pronouns, a title from the complaint), list it under "assumptions".
8. TEMPERAMENT: only fill the "temperament" object from behaviour the text EXPLICITLY describes (how the patient \
looks, acts, feels, or talks). Never infer personality or emotional state from the diagnosis, age, sex, or any \
stereotype (e.g. do NOT assume a cancer patient is sad or an elderly patient is confused). If the text says nothing \
about behaviour, leave every temperament field an empty string. Match the dropdown value that is closest to what the \
text says; if nothing fits, leave it empty and put the description in emotionalCues instead.
9. Return ONLY the structured tool call. Everything you return is a suggestion a human will review and edit; \
nothing is final."""


def extract_case(case_text: str, llm: LLM, model: str | None = None) -> dict[str, Any]:
    """Call Claude to extract Patient Studio fields from pasted case text.

    Raises ValueError on empty input. Lets Bedrock/LLM errors propagate so the
    HTTP layer can turn them into a clear message for the browser.
    """
    text = (case_text or "").strip()
    if not text:
        raise ValueError("No case text provided. Paste a clinical case first.")

    result = llm.call_json(
        model=model or smart_model(),
        system=EXTRACT_SYSTEM,
        schema=EXTRACT_SCHEMA,
        tool_name="patient_studio_fields",
        user="CLINICAL CASE TEXT:\n\n" + text,
        max_tokens=4000,
        temperature=0.0,
    )
    return _sanitize(result)


def _sanitize(r: dict[str, Any]) -> dict[str, Any]:
    """Defensive clean-up so a slightly-off model response can't break the UI.
    We never add clinical content here; we only drop malformed entries and clamp
    enums to allowed values."""
    def s(v: Any) -> str:
        return v if isinstance(v, str) else ("" if v is None else str(v))

    def words(v: Any) -> list[str]:
        if not isinstance(v, list):
            return []
        return [w.strip().lower() for w in v if isinstance(w, str) and w.strip()]

    out: dict[str, Any] = {
        "title": s(r.get("title")),
        "name": s(r.get("name")),
        "age": s(r.get("age")),
        "sex": r.get("sex") if r.get("sex") in ("Female", "Male", "Other", "") else "",
        "greeting": s(r.get("greeting")),
        "objectives": [s(o) for o in r.get("objectives", []) if isinstance(o, str) and o.strip()],
        "facts": [],
        "artifacts": [],
        "sources": [],
        "missing": [s(m) for m in r.get("missing", []) if isinstance(m, str) and m.strip()],
        "assumptions": [s(a) for a in r.get("assumptions", []) if isinstance(a, str) and a.strip()],
    }

    for f in r.get("facts", []):
        if not isinstance(f, dict):
            continue
        label, value = s(f.get("label")).strip(), s(f.get("value")).strip()
        if not label and not value:
            continue
        out["facts"].append({
            "tab": f.get("tab") if f.get("tab") in CHART_TABS else "history",
            "label": label,
            "value": value,
            "triggers": words(f.get("triggers")),
            "key": bool(f.get("key")),
        })

    for a in r.get("artifacts", []):
        if not isinstance(a, dict):
            continue
        name, finding = s(a.get("name")).strip(), s(a.get("finding")).strip()
        if not name and not finding:
            continue
        out["artifacts"].append({
            "name": name,
            "type": a.get("type") if a.get("type") in ARTIFACT_TYPES else "Other",
            "finding": finding,
            "abnormal": bool(a.get("abnormal")),
            "triggers": words(a.get("triggers")),
        })

    for src in r.get("sources", []):
        if not isinstance(src, dict):
            continue
        title = s(src.get("title")).strip()
        if not title:
            continue
        out["sources"].append({"title": title, "note": s(src.get("note")).strip()})

    # Temperament: optional. Clamp dropdowns to allowed values; keep free text as
    # given. Only include the object if at least one field has content.
    tmp = r.get("temperament")
    if isinstance(tmp, dict):
        temperament = {
            "temperament": tmp.get("temperament") if tmp.get("temperament") in TEMPERAMENT_OPTIONS else "",
            "communicationStyle": tmp.get("communicationStyle") if tmp.get("communicationStyle") in COMM_STYLE_OPTIONS else "",
            "emotionalCues": s(tmp.get("emotionalCues")).strip(),
            "triggers": s(tmp.get("triggers")).strip(),
            "empathyResponse": s(tmp.get("empathyResponse")).strip(),
            "progression": s(tmp.get("progression")).strip(),
            "facultyNotes": s(tmp.get("facultyNotes")).strip(),
        }
        if any(temperament.values()):
            out["temperament"] = temperament

    return out
