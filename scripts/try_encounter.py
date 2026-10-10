"""
Chat with a seed patient in the terminal, through the real engine + Bedrock.

    export AWS_REGION=us-east-1 VPE_FAST_MODEL=... VPE_SMART_MODEL=...
    python -m scripts.try_encounter samples/4d619156-3250-4212-8399-129f3280fab1.json
    python -m scripts.try_encounter samples/<id>.json --link     # also run the LLM objective linking first

Commands while chatting:  /chart  /state  /quit
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bedrock import BedrockLLM  # noqa: E402
from app.encounter.engine import chart_view, start_encounter, take_turn  # noqa: E402
from app.linking import link_objectives  # noqa: E402
from app.schemas import PatientProfile  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("profile")
    ap.add_argument("--link", action="store_true")
    args = ap.parse_args()

    profile = PatientProfile.model_validate_json(Path(args.profile).read_text())
    llm = BedrockLLM()
    if args.link:
        link_objectives(profile, llm)
        Path(args.profile).write_text(profile.model_dump_json(indent=2))
        print("Objective links updated with the LLM.")

    state = start_encounter(profile, require_published=False)
    p = profile.persona
    print(f"\nYou are a {profile.settings.student_role}. Patient: {p.name}, {p.age}. Trust starts at {state.trust}.")
    print("Type /chart, /state or /quit.\n")
    while True:
        try:
            msg = input("YOU> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if msg in ("/quit", "/q"):
            break
        if msg == "/chart":
            print(json.dumps(chart_view(profile, state), indent=1)[:4000])
            continue
        if msg == "/state":
            print(f"trust={state.trust} disclosed={state.disclosed_fact_ids} released={state.released_artifact_ids}")
            continue
        if not msg:
            continue
        r = take_turn(profile, state, msg, llm)
        print(f"\n{p.name.split()[0].upper()}> {r.reply}")
        meta = [f"trust {r.trust}", f"tags {r.tags}"]
        if r.new_fact_ids:
            meta.append("new: " + "; ".join(profile.fact(f).content[:50] for f in r.new_fact_ids))
        if r.new_artifact_ids:
            meta.append("chart: " + ", ".join(a.title for a in profile.artifacts if a.id in r.new_artifact_ids))
        if r.deflected:
            meta.append("DEFLECTED")
        print("   (" + " | ".join(meta) + ")\n")

    out = Path(f"encounter-{state.id[:8]}.json")
    out.write_text(state.model_dump_json(indent=2))
    print(f"Saved log to {out}")


if __name__ == "__main__":
    main()
