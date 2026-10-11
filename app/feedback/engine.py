"""
Feedback engine: one finished encounter -> a report for the student AND the faculty.

    build_feedback(profile, state, llm) -> dict   (JSON-ready)

Two parts, on purpose:
 A. DETERMINISTIC (plain code, no AI): which expected findings were elicited or
    missed, at which turn, from the disclosure log; plus communication stats from
    the router's tags (open vs closed questions, empathy, jargon, deflections the
    student didn't follow up). These numbers can't be hallucinated.
 B. RUBRIC (smart model): scores each domain of the faculty rubric (the organizers'
    7-domain JSON by default) against the student's YEAR LEVEL, citing turns and
    quotes. Reference documents are searched (RAG) so explanations can be checked
    for accuracy.

Then code enforces the rules the rubric states:
 - domains the level marks "na" are N/A, whatever the model said
 - every quote must really appear in that turn of the transcript, or it is dropped
 - a score of 1 in a review-trigger domain (6, 7) sets needs_review
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional

from .. import attachments, levels
from ..bedrock import LLM, smart_model
from ..schemas import DocumentKind, EncounterState, PatientProfile, Speaker
from ..studio.rag import KnowledgeIndex

RUBRIC_DIR = Path(__file__).resolve().parents[2] / "data" / "rubrics"
QUESTION_TAGS = {"open_question", "closed_question", "leading_question"}


@lru_cache(maxsize=8)
def load_rubric(rubric_id: str = "encounter_evaluation_rubric") -> dict:
    return json.loads((RUBRIC_DIR / f"{rubric_id}.json").read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# A. Deterministic part
# --------------------------------------------------------------------------

def _disclosed_at(state: EncounterState) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in state.turns:
        for fid in t.disclosed_fact_ids:
            out.setdefault(fid, t.n)
    return out


def findings(profile: PatientProfile, state: EncounterState) -> list[dict]:
    """Per graded objective: each expected discovery found / missed / skill (graded by the rubric pass)."""
    when = _disclosed_at(state)
    out = []
    for o in levels.graded_objectives(profile, state.level):
        items = []
        for d in o.expected_discoveries:
            if d.link_method == "llm_skill" or not d.linked_fact_ids:
                items.append({"id": d.id, "text": d.text, "status": "skill", "turn": None, "fact_ids": []})
                continue
            hit = [fid for fid in d.linked_fact_ids if fid in when]
            items.append({"id": d.id, "text": d.text,
                          "status": "found" if hit else "missed",
                          "turn": min(when[f] for f in hit) if hit else None,
                          "fact_ids": hit or d.linked_fact_ids})
        info = [i for i in items if i["status"] != "skill"]
        out.append({"id": o.id, "objective": o.objective, "items": items,
                    "found": sum(i["status"] == "found" for i in info), "total": len(info)})
    return out


LONG_PAUSE_S = 15        # silence after the patient finished, before the student spoke
QUICK_S = 1.0            # answered almost instantly: often not listening to the end


def _pacing(student: list) -> dict:
    """Timing measured in the browser: pause after the patient finished speaking, and interruptions.
    Reported and used as evidence for listening/rapport, never scored on its own."""
    gaps = [t.response_ms / 1000 for t in student if t.response_ms is not None]
    gaps_sorted = sorted(gaps)
    median = gaps_sorted[len(gaps_sorted) // 2] if gaps_sorted else None
    return {"pacing": {
        "measured_turns": len(gaps),
        "median_pause_s": round(median, 1) if median is not None else None,
        "longest_pause_s": round(max(gaps), 1) if gaps else None,
        "long_pauses": [t.n for t in student if t.response_ms is not None and t.response_ms / 1000 >= LONG_PAUSE_S],
        "interrupted_turns": [t.n for t in student if t.interrupted],
        "note": ("Pauses of a few seconds after the patient shares something are normal and can be good listening. "
                 f"Pauses of {LONG_PAUSE_S}s or more, or talking over the patient, are flagged for reflection."),
    }}


def communication_stats(state: EncounterState) -> dict:
    student = [t for t in state.turns if t.speaker == Speaker.student]
    tags = [set(t.tags) for t in student]
    count = lambda tag: sum(tag in s for s in tags)  # noqa: E731

    unaddressed = []
    turns = [t for t in state.turns if t.speaker != Speaker.system]
    for i, t in enumerate(turns):
        if t.speaker == Speaker.patient and "deflected" in t.tags:
            nxt = next((u for u in turns[i + 1:] if u.speaker == Speaker.student), None)
            if nxt is None or not ({"follow_up", "empathy", "reflection", "clarification"} & set(nxt.tags)):
                unaddressed.append(t.n)

    questions = sum(bool(QUESTION_TAGS & s) for s in tags)
    return {**_pacing(student), 
        "student_turns": len(student),
        "questions": questions,
        "open_questions": count("open_question"),
        "closed_questions": count("closed_question"),
        "leading_questions": count("leading_question"),
        "open_question_ratio": round(count("open_question") / questions, 2) if questions else None,
        "empathy_or_reflection": count("empathy") + count("reflection") + count("affirmation"),
        "jargon_turns": [t.n for t in student if "jargon" in t.tags],
        "judgmental_turns": [t.n for t in student if "judgmental" in t.tags],
        "introduced_self": any("introduction" in s for s in tags[:3]),
        "closed_encounter": any({"closing", "summary"} & s for s in tags[-3:]) if tags else False,
        "checked_understanding": count("check_understanding") > 0,
        "deflections_not_followed_up": unaddressed,
        "off_script_turns": [t.n for t in student if "off_script" in t.tags],
        "final_trust": state.trust,
        "chart_items_opened": len(state.released_artifact_ids),
    }


# --------------------------------------------------------------------------
# B. Rubric part (LLM)
# --------------------------------------------------------------------------

def feedback_schema(rubric: dict, epa_ids: list[str] | None = None) -> dict:
    S = {"type": "string"}
    scores = [str(s) for s in rubric.get("allowed_scores", [4, 3, 2, 1, "N/A"])]
    evidence = {"type": "array", "items": {"type": "object", "properties": {
        "turn": {"type": "integer"}, "quote": S}, "required": ["turn", "quote"]}}
    domain = {"type": "object", "properties": {
        "key": {"type": "string", "enum": [d["key"] for d in rubric["domains"]]},
        "score": {"type": "string", "enum": scores},
        "rationale": S,
        "evidence": evidence,
        **{f: S for f in rubric.get("evidence_fields", [])},
    }, "required": ["key", "score", "rationale", "evidence", *rubric.get("evidence_fields", [])]}
    return {"type": "object", "properties": {
        "domains": {"type": "array", "items": domain},
        "skill_items": {"type": "array", "items": {"type": "object", "properties": {
            "id": S, "achieved": {"type": "boolean"}, "turn": {"type": "integer"}, "comment": S},
            "required": ["id", "achieved", "comment"]}},
        "strengths": {"type": "array", "items": S},
        "areas_for_improvement": {"type": "array", "items": S},
        "next_attempt_suggestions": {"type": "array", "items": S},
        "summary": S,
        "entrustment": {"type": "array", "items": {"type": "object", "properties": {
            "epa": {"type": "string", "enum": epa_ids or ["none"]},
            "level": {"type": "integer", "enum": [0, 1, 2, 3, 4, 5],
                      "description": "Supervision level this encounter's evidence supports; 0 = not enough evidence"},
            "rationale": S, "evidence": evidence}, "required": ["epa", "level", "rationale", "evidence"]}},
    }, "required": ["domains", "skill_items", "strengths", "areas_for_improvement",
                    "next_attempt_suggestions", "summary", "entrustment"]}


SYSTEM = """You are an experienced clinical educator grading a student's simulated patient interview.
Grade strictly from the transcript, using the faculty rubric and the student's year level.

Rules:
- Score every rubric domain. Use only the allowed scores. The rubric's own instruction applies: rate only what
  the scenario made possible to observe; use N/A when a criterion is not appropriate.
- The LEVEL tells you what to expect. Domains marked "na" for this level must be "N/A". Domains marked "lenient"
  are judged against the level's expectations (a beginner meeting beginner expectations can score 3-4).
  Domains marked "core" use the rubric descriptors as written.
- Every score except N/A needs evidence: turn numbers and short EXACT quotes copied from the STUDENT's lines.
  Never paraphrase inside a quote. If there is no evidence, say so in the rationale.
- Use the DETERMINISTIC RESULTS as facts (what was found/missed, deflections not followed up). Do not contradict them.
- If REFERENCE EXCERPTS are given, check the student's explanations against them and note inaccuracies in the
  safety/accuracy field, citing the excerpt label.
- For each SKILL ITEM, decide whether the student did it, citing the turn.
- Strengths, areas for improvement and next-attempt suggestions must be specific to this transcript and
  actionable (what to say or do differently). Give exactly 3 next-attempt suggestions.
- Be fair, specific and encouraging, like written feedback a student will actually read.
- ENTRUSTMENT: for each EPA in focus, estimate the supervision level (on the given scale) that THIS encounter's
  evidence supports, as a faculty observer would. A simulated interview shows only part of each EPA (see each
  EPA's simulation note), so be conservative: never above 3 from one simulated encounter, and use 0 when the
  encounter gives too little evidence. Cite turns and exact student quotes. Do not let the target level bias
  the estimate."""


def _transcript(state: EncounterState) -> str:
    return "\n".join(f"[{t.n}] {t.speaker.value.upper()}: {t.text}"
                     for t in state.turns if t.speaker != Speaker.system)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", re.sub(r"\s+", " ", s.lower())).strip()


def verify_evidence(domains: list[dict], state: EncounterState) -> int:
    """Keep only quotes that really occur in the cited turn (or an adjacent one). Returns # dropped."""
    by_turn = {t.n: _norm(t.text) for t in state.turns if t.speaker != Speaker.system}
    dropped = 0
    for d in domains:
        kept = []
        for e in d.get("evidence", []):
            q = _norm(str(e.get("quote", "")))
            n = e.get("turn")
            if q and any(q in by_turn.get(m, "") for m in (n, (n or 0) - 1, (n or 0) + 1)):
                kept.append(e)
            else:
                dropped += 1
        d["evidence"] = kept
    return dropped


def build_feedback(profile: PatientProfile, state: EncounterState, llm: LLM,
                   model: Optional[str] = None) -> dict:
    rubric = load_rubric(profile.settings.rubric_id)
    level = levels.get_level(state.level)
    modes = levels.domain_modes(state.level)
    found = findings(profile, state)
    stats = communication_stats(state)
    skills = [i for o in found for i in o["items"] if i["status"] == "skill"]

    # RAG over reference documents, using what the student actually said as the query
    ref_ctx = ""
    refs = [d for d in profile.documents if d.kind == DocumentKind.reference]
    if refs:
        said = " ".join(t.text for t in state.turns if t.speaker == Speaker.student)
        ref_ctx = KnowledgeIndex(refs).context(said, k=4, max_chars=4000)

    framework = levels.load_framework()
    targets = levels.epa_targets(state.level)
    epa_by_id = {e["id"]: e for e in framework["epas"]}
    rubric_map = {k: v for k, v in framework.get("rubric_map", {}).items() if not k.startswith("_")}
    have = attachments.available_kinds(profile)
    focus, epa_skipped = [], []
    for eid in targets:
        e = epa_by_id.get(eid)
        if not e or e.get("observable") == "no":
            continue
        if e.get("requires_any") and not (set(e["requires_any"]) & have):
            epa_skipped.append({"id": e["id"], "title": e["title"],
                                "reason": "Not assessed: this patient's chart has no test results or images to interpret."})
            continue
        focus.append(e)
    epa_txt = "\n".join(
        f"- {e['id']}: {e['title']} | target at this level: {targets[e['id']]} | "
        f"simulation note: {e.get('simulation_note', '')} | rubric domains that inform it: "
        f"{', '.join(k for k, v in rubric_map.items() if e['id'] in v) or 'none'}"
        for e in focus) or "(none)"
    scale_txt = "\n".join(f"  {x['level']} {x['label']}: {x['meaning']}" for x in framework["scale"])

    rubric_txt = "\n".join(
        f"- {d['key']} ({d['name']}) [mode for this level: {modes.get(d['key'], 'core')}]\n" +
        "\n".join(f"    {s}: {txt}" for s, txt in d["descriptors"].items())
        for d in rubric["domains"])
    user = f"""STUDENT ROLE: {profile.settings.student_role}
ENCOUNTER GOAL: {profile.settings.encounter_goal}
LEVEL: {level['key']} - {level['label']}
LEVEL EXPECTATIONS: {level['grading']['expectations']}

RUBRIC: {rubric['title']}
Instructions: {rubric.get('instructions', '')}
Scale: {json.dumps(rubric.get('rating_scale', []))}
Domains:
{rubric_txt}

LEARNING OBJECTIVES AND DETERMINISTIC RESULTS:
{json.dumps(found, indent=1)}

SKILL ITEMS TO JUDGE (actions, not information):
{json.dumps([{"id": s["id"], "text": s["text"]} for s in skills], indent=1)}

COMMUNICATION STATS (from per-turn tagging):
{json.dumps(stats, indent=1)}

ENTRUSTMENT FRAMEWORK: {framework['title']}
Supervision scale:
{scale_txt}
EPAs in focus for this level:
{epa_txt}

REFERENCE EXCERPTS:
{ref_ctx or '(none)'}

TRANSCRIPT (turn numbers in brackets):
{_transcript(state)}"""

    out = llm.call_json(model=model or smart_model(), system=SYSTEM,
                        schema=feedback_schema(rubric, [e["id"] for e in focus]),
                        tool_name="encounter_feedback", user=user, max_tokens=6000)

    # ---- enforce the rules in code -------------------------------------
    by_key = {d.get("key"): d for d in out.get("domains", [])}
    domains = []
    for rd in rubric["domains"]:
        d = dict(by_key.get(rd["key"]) or {"score": "N/A", "rationale": "Not scored.", "evidence": []})
        d.update(key=rd["key"], id=rd["id"], name=rd["name"], mode=modes.get(rd["key"], "core"))
        if d["mode"] == "na":
            d.update(score="N/A", rationale=f"Not expected at {level['key']} ({level['label']}).", evidence=[])
        domains.append(d)
    dropped = verify_evidence(domains, state)
    for d in domains:
        d["evidence_verified"] = d["score"] == "N/A" or bool(d["evidence"])

    # ---- EPA entrustment estimates ------------------------------------
    scale = {x["level"]: x["label"] for x in framework["scale"]}
    est_by_id = {e.get("epa"): e for e in out.get("entrustment", [])}
    dom_by_key = {d["key"]: d for d in domains}
    epas = []
    for e in focus:
        est = dict(est_by_id.get(e["id"]) or {"level": 0, "rationale": "Not assessed.", "evidence": []})
        verify_evidence([est], state)
        level_est = int(est.get("level") or 0)
        if level_est and not est["evidence"]:
            level_est = 0                                  # no verified evidence -> no estimate
            est["rationale"] = (est.get("rationale", "") + " (Estimate withheld: no verifiable evidence.)").strip()
        level_est = min(level_est, 3)                      # one simulated encounter never shows more than 3
        target = targets[e["id"]]
        linked = [k for k, v in rubric_map.items() if e["id"] in v]
        epas.append({
            "id": e["id"], "title": e["title"], "simulation_note": e.get("simulation_note", ""),
            "target_level": target, "target_label": scale.get(target, ""),
            "estimated_level": level_est or None,
            "estimated_label": scale.get(level_est, "Insufficient evidence") if level_est else "Insufficient evidence",
            "meets_target": (level_est >= target) if level_est else None,
            "rationale": est.get("rationale", ""), "evidence": est.get("evidence", []),
            "rubric_domains": [{"key": k, "name": dom_by_key[k]["name"], "score": dom_by_key[k]["score"]}
                               for k in linked if k in dom_by_key],
            "faculty_confirmed_level": None,
        })

    numeric = [int(d["score"]) for d in domains if d["score"] != "N/A"]
    triggers = set(rubric.get("scoring", {}).get("review_trigger_domain_ids", []))
    review_reasons = [f"{d['name']} scored 1" for d in domains if d["id"] in triggers and d["score"] == "1"]

    skill_by_id = {s.get("id"): s for s in out.get("skill_items", [])}
    for o in found:
        for i in o["items"]:
            if i["status"] == "skill":
                s = skill_by_id.get(i["id"], {})
                i["status"] = "found" if s.get("achieved") else "missed"
                i["turn"] = s.get("turn")
                i["comment"] = s.get("comment", "")
        o["found"] = sum(i["status"] == "found" for i in o["items"])
        o["total"] = len(o["items"])

    return {
        "encounter_id": state.id,
        "patient_id": profile.id,
        "patient_name": profile.persona.name,
        "student_id": state.student_id,
        "assignment_id": state.assignment_id,
        "level": level["key"],
        "level_label": level["label"],
        "rubric": rubric["title"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": sum(numeric),
        "max_total": 4 * len(numeric),
        "domains": domains,
        "objectives": found,
        "entrustment_framework": framework["title"],
        "epas": epas,
        "epas_not_assessed": epa_skipped,
        "communication": stats,
        "strengths": out.get("strengths", []),
        "areas_for_improvement": out.get("areas_for_improvement", []),
        "next_attempt_suggestions": out.get("next_attempt_suggestions", [])[:3],
        "summary": out.get("summary", ""),
        "needs_review": bool(review_reasons),
        "review_reasons": review_reasons,
        "unverified_quotes_dropped": dropped,
        "interpretation": rubric.get("scoring", {}).get("interpretation", ""),
        "faculty_notes": "",
    }
