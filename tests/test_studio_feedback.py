"""
Offline tests for the Studio generator, RAG, levels and feedback engine.
A fake LLM stands in for Claude, so these check OUR logic, not model quality.

    python tests/test_studio_feedback.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import levels  # noqa: E402
from app.encounter import engine  # noqa: E402
from app.feedback.engine import build_feedback, communication_stats, findings  # noqa: E402
from app.importers import read_json_objects  # noqa: E402
from app.schemas import Disclosure, DocumentKind, Origin, PatientProfile, SourceDocument  # noqa: E402
from app.studio.generator import FacultyInput, generate_profile  # noqa: E402
from app.studio.rag import KnowledgeIndex  # noqa: E402

RECORDS = {r["patient_overview"]["name"]: r
           for r in read_json_objects((ROOT / "data" / "patients.jsonl").read_text())}
WYATT_FILE = ROOT / "samples" / "4d619156-3250-4212-8399-129f3280fab1.json"

WYATT_INPUT = FacultyInput(
    name="Wyatt Nelson", age=18, gender="male", ethnicity="White American",
    background="High school student", personality="Shy, resistant, sensitive",
    notes="Wyatt has a BMI of 32 and dyslipidemia (Total Chol 235, LDL 145). He struggles with "
          "constipation but avoids talking about it. He dislikes fruits and vegetables.",
    summary="Obesity, Dyslipidemia, Constipation")


class FakeLLM:
    def __init__(self, record=None, feedback=None):
        self.record, self.feedback, self.prompts = record, feedback, {}

    def call_json(self, *, tool_name, user=None, messages=None, **_):
        self.prompts[tool_name] = user
        if tool_name == "patient_record":
            return __import__("copy").deepcopy(self.record)
        if tool_name == "objective_links":
            return {"links": []}          # keep lexical links; linking is tested elsewhere
        if tool_name == "encounter_feedback":
            return self.feedback
        if tool_name == "route_turn":
            return self.routes.pop(0)
        if tool_name == "patient_reply":
            newly = _.get("system", "").split("NEWLY RELEVANT")[1].split("HARMLESS COLOUR")[0]
            ids = [ln.split("]")[0].split("[")[1] for ln in newly.splitlines() if ln.startswith("- [")]
            return {"reply": "Okay.", "used_fact_ids": ids, "deflected": False}
        raise AssertionError(tool_name)

    def call_text(self, **_):
        return ""


# ---------------------------------------------------------------- generator

def test_generator_marks_faculty_facts_and_keeps_numbers():
    llm = FakeLLM(record=RECORDS["Wyatt Nelson"])
    lab_doc = SourceDocument(id="d1", name="lipid_panel_lab.txt", kind=DocumentKind.patient_record,
                             text="Lipid panel 2026-09-01: Total cholesterol 235 mg/dL, LDL 145 mg/dL, HDL 38 mg/dL")
    ref_doc = SourceDocument(id="d2", name="fiber_guideline.txt", kind=DocumentKind.reference,
                             text="Adolescents should aim for gradual increases in dietary fiber with adequate fluids "
                                  "to manage constipation.\n\nUnrelated section about vitamin D.")
    p, issues = generate_profile(WYATT_INPUT, [lab_doc, ref_doc], llm, model="x")

    codes = {i.code for i in issues}
    assert "faculty_number_missing" not in codes and "faculty_drift" not in codes, codes
    ldl = [f for f in p.facts if "145" in f.content]
    assert not ldl or all(f.origin == Origin.faculty for f in ldl)
    assert any(f.origin == Origin.generated for f in p.facts)           # gap-filling is flagged
    labs = next(a for a in p.artifacts if a.title == "Laboratory results")
    assert labs.origin == Origin.faculty                                  # values match the faculty lab doc
    uploaded = next(a for a in p.artifacts if a.title == "lipid panel lab")
    assert uploaded.type.value == "lab_report" and uploaded.release.trigger.value == "on_request"
    prompt = llm.prompts["patient_record"]
    assert "LDL 145 mg/dL" in prompt                                      # patient doc given in full
    assert "dietary fiber" in prompt                                      # RAG retrieved the relevant chunk
    assert p.settings.student_role == "Dietetics student" and p.persona.name == "Wyatt Nelson"
    assert len(p.documents) == 2
    PatientProfile.model_validate_json(p.model_dump_json())              # round-trips


def test_generator_drift_is_caught():
    """Faculty says MS; a model that turns her into diabetes must be flagged (the organizers' own bug)."""
    fi = FacultyInput(name="Nisha Patel", age=29, gender="female",
                      notes="Challenges providers with questions; emotionally overwhelmed.",
                      summary="Young adult with newly diagnosed MS")
    _, issues = generate_profile(fi, [], FakeLLM(record=RECORDS["Nisha Patel"]), model="x")
    assert any(i.code == "faculty_drift" and "MS" in i.message for i in issues)


def test_missing_faculty_number_is_caught():
    fi = WYATT_INPUT.model_copy(update={"notes": WYATT_INPUT.notes + " Triglycerides 412."})
    _, issues = generate_profile(fi, [], FakeLLM(record=RECORDS["Wyatt Nelson"]), model="x")
    assert any(i.code == "faculty_number_missing" and "412" in i.message for i in issues)


def test_rag_ranks_relevant_chunk_first():
    docs = [SourceDocument(id="a", name="htn.txt", text="Sodium intake under 2300 mg per day lowers blood pressure."),
            SourceDocument(id="b", name="other.txt", text="Hand hygiene protocol for clinic staff.")]
    top = KnowledgeIndex(docs).search("how much sodium for blood pressure", k=1)[0][1]
    assert top.doc_id == "a"


# ---------------------------------------------------------------- levels

def test_levels_change_patient_difficulty_not_the_stored_profile():
    p = PatientProfile.model_validate_json(WYATT_FILE.read_text())
    before = p.model_dump_json()
    m1, m4 = levels.apply_level(p, "M1"), levels.apply_level(p, "M4")
    assert m1.settings.opening_trust > m4.settings.opening_trust
    rel = lambda q: max(f.min_trust for f in q.facts if f.disclosure == Disclosure.reluctant)  # noqa: E731
    assert rel(m1) < rel(m4)
    assert m1.settings.difficulty_notes and m4.settings.difficulty_notes
    assert p.model_dump_json() == before
    assert engine.start_encounter(p, False, level="M1").trust == m1.settings.opening_trust


# ---------------------------------------------------------------- feedback

def _run_encounter(level: str):
    p = PatientProfile.model_validate_json(WYATT_FILE.read_text())
    diet = next(f for f in p.facts if "fast food and sugary drinks" in f.content.lower())
    bowel = next(f for f in p.facts if f.disclosure == Disclosure.reluctant and "bowel" in f.content.lower())
    llm = FakeLLM()
    llm.routes = [
        {"fact_ids": [], "artifact_ids": [], "tags": ["introduction", "open_question"], "trust_delta": 0, "off_script_reason": ""},
        {"fact_ids": [diet.id], "artifact_ids": [], "tags": ["open_question"], "trust_delta": 0, "off_script_reason": ""},
        {"fact_ids": [bowel.id], "artifact_ids": [], "tags": ["closed_question", "jargon"], "trust_delta": -1, "off_script_reason": ""},
        {"fact_ids": [], "artifact_ids": [], "tags": ["closing"], "trust_delta": 0, "off_script_reason": ""},
    ]
    s = engine.start_encounter(p, False, level=level)
    for msg in ["Hi Wyatt, I'm a dietetics student. What brings you in today?",
                "Can you walk me through what you usually eat?",
                "Do you have constipation or abnormal bowel motility?",
                "Thanks, let's meet again next week."]:
        engine.take_turn(p, s, msg, llm, model="x")
    return p, s


def _fake_feedback(score6: str):
    def dom(key, score, quotes):
        return {"key": key, "score": score, "rationale": "r", "evidence": quotes,
                "strength_demonstrated": "s", "important_gap_or_missed_opportunity": "g",
                "safety_or_accuracy_concern": ""}
    return {
        "domains": [
            dom("opening_and_purpose", "4", [{"turn": 1, "quote": "I'm a dietetics student"}]),
            dom("rapport_respect_empathy", "2", [{"turn": 5, "quote": "You must eat too much junk"}]),  # invented
            dom("information_gathering", "3", [{"turn": 3, "quote": "walk me through what you usually eat"}]),
            dom("listening_and_response_to_cues", "2", [{"turn": 5, "quote": "abnormal bowel motility"}]),
            dom("explanation_and_shared_decisions", "N/A", []),
            dom("clinical_reasoning_and_synthesis", score6, [{"turn": 5, "quote": "Do you have constipation"}]),
            dom("professionalism_safety_closure", "3", [{"turn": 7, "quote": "let's meet again next week"}]),
        ],
        "skill_items": [], "strengths": ["Clear intro"], "areas_for_improvement": ["Avoid jargon"],
        "next_attempt_suggestions": ["a", "b", "c", "d"], "summary": "ok"}


def test_feedback_m3_flags_review_and_drops_fake_quotes():
    p, s = _run_encounter("M3")
    fb = build_feedback(p, s, FakeLLM(feedback=_fake_feedback("1")), model="x")
    d = {x["key"]: x for x in fb["domains"]}
    assert fb["level"] == "M3" and d["clinical_reasoning_and_synthesis"]["score"] == "1"
    assert fb["needs_review"] and "Clinical reasoning" in fb["review_reasons"][0]
    assert fb["unverified_quotes_dropped"] == 1 and not d["rapport_respect_empathy"]["evidence"]
    assert d["rapport_respect_empathy"]["evidence_verified"] is False
    assert fb["total"] == 4 + 2 + 3 + 2 + 1 + 3 and fb["max_total"] == 24
    assert len(fb["next_attempt_suggestions"]) == 3


def test_feedback_m1_marks_reasoning_na_and_no_review():
    p, s = _run_encounter("M1")
    fb = build_feedback(p, s, FakeLLM(feedback=_fake_feedback("1")), model="x")
    d = {x["key"]: x for x in fb["domains"]}
    assert d["clinical_reasoning_and_synthesis"]["score"] == "N/A"      # M1: not expected, enforced in code
    assert not fb["needs_review"]
    assert fb["max_total"] == 20                                          # 5 scored domains x 4


def test_deterministic_findings_and_stats():
    p, s = _run_encounter("M2")
    stats = communication_stats(s)
    assert stats["introduced_self"] and stats["closed_encounter"]
    assert stats["jargon_turns"] == [5] and stats["open_questions"] == 2
    assert stats["deflections_not_followed_up"]                           # bowel question was deflected
    f = findings(p, s)
    assert sum(o["total"] for o in f) > 0
    assert all(i["status"] in ("found", "missed", "skill") for o in f for i in o["items"])


def test_epa_entrustment_rules():
    p, s = _run_encounter("M3")
    fake = _fake_feedback("3")
    fake["entrustment"] = [
        {"epa": "EPA1", "level": 4, "rationale": "solid history",                     # capped to 3
         "evidence": [{"turn": 3, "quote": "walk me through what you usually eat"}]},
        {"epa": "EPA2", "level": 2, "rationale": "named problems",                    # quote is invented
         "evidence": [{"turn": 5, "quote": "I think you have diabetes"}]},
    ]
    llm = FakeLLM(feedback=fake)
    fb = build_feedback(p, s, llm, model="x")
    e = {x["id"]: x for x in fb["epas"]}
    assert set(e) == {"EPA1", "EPA2", "EPA3", "EPA9", "EPA10"}                         # M3 focus
    assert e["EPA1"]["estimated_level"] == 3 and e["EPA1"]["meets_target"] is True     # target 3 at M3
    assert e["EPA2"]["estimated_level"] is None and e["EPA2"]["meets_target"] is None  # no verified evidence
    assert e["EPA3"]["estimated_label"] == "Insufficient evidence"                     # model gave nothing
    assert any(d["key"] == "information_gathering" for d in e["EPA1"]["rubric_domains"])
    prompt = llm.prompts["encounter_feedback"]
    assert "EPA1: Gather a history" in prompt and "target at this level: 3" in prompt
    assert "Indirect supervision" in prompt

    p1, s1 = _run_encounter("M1")
    fb1 = build_feedback(p1, s1, FakeLLM(feedback=_fake_feedback("3")), model="x")
    assert [x["id"] for x in fb1["epas"]] == ["EPA1"] and fb1["epas"][0]["target_level"] == 2


def test_epa3_not_assessed_without_test_results():
    p, s = _run_encounter("M3")
    p.artifacts = [a for a in p.artifacts if a.type.value not in ("lab_report", "ecg", "imaging")]
    for a in p.artifacts:               # also strip lab-ish words from remaining records
        a.text = ""
        a.items = [i for i in a.items if "a1c" not in i.label.lower()]
    fb = build_feedback(p, s, FakeLLM(feedback=_fake_feedback("3")), model="x")
    assert "EPA3" not in {e["id"] for e in fb["epas"]}
    assert fb["epas_not_assessed"][0]["id"] == "EPA3"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
