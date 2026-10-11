"""
The encounter turn loop.

    student message
      -> ROUTER (fast model, structured): which facts / chart items / behaviours / trust change
      -> GATE (plain code): which of those facts the patient is allowed to share at this trust level
      -> PATIENT (fast model, structured): in-character reply + which facts it actually used
      -> STATE: log turn, mark disclosed facts + released artifacts

The patient model never sees a fact it is not allowed to share, so it cannot leak or invent it.
Pure functions over EncounterState: the API layer loads/saves state around them.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..bedrock import LLM, assistant_msg, fast_model, user_msg
from ..schemas import (
    Artifact, Disclosure, EncounterState, Fact, FactCategory, PatientProfile,
    ProfileStatus, ReleaseTrigger, Speaker, Turn,
)
from .. import levels
from . import prompts


@dataclass
class TurnResult:
    reply: str
    new_fact_ids: list[str] = field(default_factory=list)       # newly disclosed this turn
    new_artifact_ids: list[str] = field(default_factory=list)   # newly released to the chart
    trust: int = 1
    tags: list[str] = field(default_factory=list)
    deflected: bool = False


# --------------------------------------------------------------------------
# Start
# --------------------------------------------------------------------------

def start_encounter(profile: PatientProfile, require_published: bool = True,
                    level: str | None = None, student_id: str | None = None,
                    assignment_id: str | None = None) -> EncounterState:
    """`level` is the student's year (M1..M4, see data/levels.json). It tunes how hard the
    patient is and how the encounter is graded; the stored profile is never modified."""
    if require_published and profile.status != ProfileStatus.published:
        raise ValueError("Patient profile is not published.")
    level = levels.get_level(level)["key"]
    leveled = levels.apply_level(profile, level)
    state = EncounterState(id=str(uuid.uuid4()), patient_id=profile.id, level=level,
                           student_id=student_id, assignment_id=assignment_id,
                           patient_version=profile.version, trust=leveled.settings.opening_trust)
    for a in profile.artifacts:
        if a.release.trigger == ReleaseTrigger.at_start:
            state.released_artifact_ids.append(a.id)
    state.turns.append(Turn(n=0, speaker=Speaker.system, text="Encounter started",
                            released_artifact_ids=list(state.released_artifact_ids)))
    return state


# --------------------------------------------------------------------------
# Gate: the only place disclosure rules live
# --------------------------------------------------------------------------

def can_share(f: Fact, trust: int) -> bool:
    if f.disclosure == Disclosure.chart:
        return False                      # chart-only: never spoken
    if f.disclosure == Disclosure.hidden:
        return trust >= max(3, f.min_trust)
    return trust >= f.min_trust


def gate(profile: PatientProfile, state: EncounterState, requested: list[str]) -> tuple[list[Fact], list[Fact], list[str]]:
    """Returns (known, may_share_now, withheld_topics)."""
    disclosed = set(state.disclosed_fact_ids)
    valid = {f.id for f in profile.facts}
    known = [f for f in profile.facts
             if f.id in disclosed or (f.disclosure == Disclosure.initial and can_share(f, state.trust))]
    known_ids = {f.id for f in known}
    may, withheld = [], []
    for fid in dict.fromkeys(requested):          # dedupe, keep order
        if fid not in valid or fid in known_ids:
            continue
        f = profile.fact(fid)
        if f.disclosure == Disclosure.chart:
            continue
        (may if can_share(f, state.trust) else withheld).append(f)
    return known, may, [f.topic for f in withheld]


# --------------------------------------------------------------------------
# Artifact release
# --------------------------------------------------------------------------

def _release(profile: PatientProfile, state: EncounterState, artifact_ids: list[str],
             new_fact_ids: list[str]) -> list[str]:
    released = set(state.released_artifact_ids)
    out: list[str] = []
    valid = {a.id: a for a in profile.artifacts}
    for aid in artifact_ids:
        a = valid.get(aid)
        if a and aid not in released and a.release.trigger in (ReleaseTrigger.on_request, ReleaseTrigger.manual):
            out.append(aid)
    disclosed = set(state.disclosed_fact_ids) | set(new_fact_ids)
    for a in profile.artifacts:
        if (a.release.trigger == ReleaseTrigger.after_fact and a.id not in released
                and a.release.after_fact_id in disclosed and a.id not in out):
            out.append(a.id)
    return out


def _chart_facts_in(profile: PatientProfile, artifacts: list[Artifact]) -> list[str]:
    """Chart-only facts become 'disclosed' when the record containing them is opened."""
    text = " ".join((a.text or "") + " " + " ".join(f"{i.label} {i.value}" for i in a.items)
                    for a in artifacts).lower()
    return [f.id for f in profile.facts
            if f.disclosure == Disclosure.chart and f.content.lower()[:60] in text]


# --------------------------------------------------------------------------
# One turn
# --------------------------------------------------------------------------

def _history(state: EncounterState) -> list[tuple[str, str]]:
    return [(t.speaker.value, t.text) for t in state.turns if t.speaker != Speaker.system]


def _messages(state: EncounterState, new_student_text: str) -> list[dict]:
    msgs = []
    for who, text in _history(state):
        msgs.append(user_msg(text) if who == "student" else assistant_msg(text))
    msgs.append(user_msg(new_student_text))
    return msgs


def take_turn(profile: PatientProfile, state: EncounterState, message: str, llm: LLM,
              model: str | None = None) -> TurnResult:
    model = model or fast_model()
    message = message.strip()
    if not message:
        raise ValueError("Empty message")
    profile = levels.apply_level(profile, state.level)   # same tuning every turn

    # 1. ROUTER
    route = llm.call_json(
        model=model, system=prompts.router_system(profile), schema=prompts.ROUTER_SCHEMA,
        tool_name="route_turn", user=prompts.router_user(profile, _history(state), message),
        max_tokens=600)
    tags = [t for t in route.get("tags", []) if t in prompts.STUDENT_TAGS]
    off_script = "off_script" in tags
    requested = [] if off_script else list(route.get("fact_ids", []))
    delta = 0 if off_script else max(-1, min(1, int(route.get("trust_delta", 0) or 0)))

    # trust moves before the gate, so a kind question can unlock its own answer
    state.trust = max(0, min(3, state.trust + delta))

    # 2. GATE
    known, may_share, withheld = gate(profile, state, requested)
    allowed_ids = {f.id for f in known} | {f.id for f in may_share}

    # 3. PATIENT
    out = llm.call_json(
        model=model, system=prompts.patient_system(profile, state.trust, known, may_share, withheld),
        schema=prompts.PATIENT_SCHEMA, tool_name="patient_reply",
        messages=_messages(state, message), max_tokens=500, temperature=0.7)
    reply = _clean(out.get("reply", "")) or "Sorry, could you say that again?"
    used = [fid for fid in out.get("used_fact_ids", []) if fid in allowed_ids]  # can't claim what it wasn't given
    deflected = bool(out.get("deflected")) or bool(withheld)

    # 4. STATE
    already = set(state.disclosed_fact_ids)
    new_facts = [fid for fid in dict.fromkeys(used) if fid not in already]
    new_arts = [] if off_script else _release(profile, state, route.get("artifact_ids", []), new_facts)
    opened = [a for a in profile.artifacts if a.id in new_arts]
    new_facts += [fid for fid in _chart_facts_in(profile, opened) if fid not in already and fid not in new_facts]

    state.disclosed_fact_ids += new_facts
    state.released_artifact_ids += new_arts
    n = len([t for t in state.turns if t.speaker != Speaker.system])
    state.turns.append(Turn(n=n + 1, speaker=Speaker.student, text=message, tags=tags,
                            released_artifact_ids=new_arts))
    state.turns.append(Turn(n=n + 2, speaker=Speaker.patient, text=reply, disclosed_fact_ids=new_facts,
                            tags=(["deflected"] if deflected else []) + (["off_script_handled"] if off_script else [])))

    return TurnResult(reply=reply, new_fact_ids=new_facts, new_artifact_ids=new_arts,
                      trust=state.trust, tags=tags, deflected=deflected)


def end_encounter(state: EncounterState) -> EncounterState:
    state.ended_at = datetime.now(timezone.utc)
    return state


def _clean(text: str) -> str:
    text = re.sub(r"\*[^*]{1,80}\*", "", text)       # strip *sighs* stage directions
    text = re.sub(r"\[f\d{3}\]", "", text)            # never leak fact ids
    return re.sub(r"\s{2,}", " ", text).strip()


# --------------------------------------------------------------------------
# What the right-hand chart panel shows
# --------------------------------------------------------------------------

def chart_view(profile: PatientProfile, state: EncounterState) -> dict:
    """Everything the student has unlocked so far, grouped for the frontend tabs."""
    disclosed = [profile.fact(fid) for fid in state.disclosed_fact_ids]
    groups: dict[str, list[dict]] = {}
    for f in disclosed:
        # Diagnoses are what the student must work out (OSCE prep): never put them in the chart.
        if f.show_in_chart and f.category != FactCategory.diagnosis:
            groups.setdefault(f.category.value, []).append({"id": f.id, "text": f.content, "topic": f.topic})
    arts = []
    for a in profile.artifacts:
        if a.id in state.released_artifact_ids:
            d = a.model_dump(mode="json")
            # never hand the student a diagnosis row (e.g. the referral's "Primary diagnosis")
            d["items"] = [i for i in d["items"] if "diagnos" not in i["label"].lower()]
            # an image is shown as the image alone: any read of it would give the interpretation away
            if (a.file_path or "").lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                d["text"] = None
            arts.append(d)
    locked = [{"id": a.id, "title": a.title, "type": a.type.value}
              for a in profile.artifacts if a.id not in state.released_artifact_ids]
    p = profile.persona
    return {
        "patient": {"name": p.name, "age": p.age, "sex": p.sex, "portrait": p.portrait_path},
        "trust": state.trust,
        "facts_by_category": groups,
        "artifacts": arts,
        "locked_artifacts": locked,        # show as greyed-out tabs: "ask to see labs"
        "progress": {"disclosed": len(disclosed),
                     "total": len([f for f in profile.facts if f.disclosure != Disclosure.chart])},
    }
