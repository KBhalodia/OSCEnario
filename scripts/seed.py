"""
Convert the organizers' data into seed patient files.

    python -m scripts.seed \
        --dataset data/patients.jsonl \
        --csv data/faculty-provided-sample-patient-details.csv \
        --images "data/patient images" \
        --out samples

Writes samples/<patient-id>.json (one PatientProfile each), copies portraits
to samples/portraits/, and prints a validation report per patient.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.importers import load_vhs_dataset, match_portrait  # noqa: E402
from app.rules import validate  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--csv")
    ap.add_argument("--images")
    ap.add_argument("--out", default="samples")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "portraits").mkdir(parents=True, exist_ok=True)
    profiles = load_vhs_dataset(args.dataset, args.csv, args.images)

    for p in profiles:
        if args.images and p.persona.portrait_path:
            src = match_portrait(p.persona.name, Path(args.images))
            if src:
                shutil.copy(src, out / p.persona.portrait_path)
        (out / f"{p.id}.json").write_text(p.model_dump_json(indent=2), encoding="utf-8")

        tiers = Counter(f.disclosure.value for f in p.facts)
        linked = sum(bool(d.linked_fact_ids) for o in p.objectives for d in o.expected_discoveries)
        total = sum(len(o.expected_discoveries) for o in p.objectives)
        print(f"\n== {p.persona.name}  ({p.id})")
        print(f"   {len(p.facts)} facts {dict(tiers)} | {len(p.artifacts)} artifacts | "
              f"{len(p.objectives)} objectives, {linked}/{total} discoveries auto-linked | "
              f"portrait: {p.persona.portrait_path or 'none'}")
        for issue in validate(p):
            print(f"   [{issue.severity:7}] {issue.code}: {issue.message}")

    print(f"\nWrote {len(profiles)} profiles to {out}/")


if __name__ == "__main__":
    main()
