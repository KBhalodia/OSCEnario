"""
Create a patient the way faculty will in the Studio, from the terminal.

  # from a row of the faculty CSV (0-7):
  python -m scripts.try_generate --csv-row 2

  # from your own description:
  python -m scripts.try_generate --name "Maria Lopez" --age 58 --gender female \
      --personality "anxious, talkative" \
      --notes "Type 2 diabetes for 10 years, A1c 9.4, on metformin 1000 mg twice daily" \
      --summary "Uncontrolled type 2 diabetes" \
      --doc lab_report.pdf:patient_record --doc ada_guideline.pdf:reference

Writes generated/<patient-id>.json and prints the review list. Then chat with it:
  python -m scripts.try_encounter generated/<patient-id>.json --level M1
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bedrock import BedrockLLM, smart_model  # noqa: E402
from app.importers import load_faculty_csv  # noqa: E402
from app.schemas import Origin  # noqa: E402
from app.studio.documents import load_document  # noqa: E402
from app.studio.generator import FacultyInput, generate_profile  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv-row", type=int, help="use row N of the faculty CSV as input")
    ap.add_argument("--name"); ap.add_argument("--age", type=int); ap.add_argument("--gender", default="")
    ap.add_argument("--ethnicity", default=""); ap.add_argument("--background", default="")
    ap.add_argument("--personality", default=""); ap.add_argument("--notes", default="")
    ap.add_argument("--summary", default="")
    ap.add_argument("--role", default="Dietetics student")
    ap.add_argument("--goal", default="")
    ap.add_argument("--doc", action="append", default=[],
                    help="path[:patient_record|reference] (default reference)")
    ap.add_argument("--out", default="generated")
    a = ap.parse_args()

    if a.csv_row is not None:
        rows = list(load_faculty_csv(ROOT / "data" / "faculty-provided-sample-patient-details.csv").values())
        r = rows[a.csv_row]["row"]
        fi = FacultyInput(name=r["patient_name"], age=int(r["age"]) if r.get("age") else None,
                          gender=r.get("gender", ""), ethnicity=r.get("race_ethinicity", ""),
                          background=r.get("background", ""), personality=r.get("personality", ""),
                          notes=r.get("notes", ""), summary=r.get("summary", ""),
                          student_role=a.role, encounter_goal=a.goal)
    else:
        if not a.name:
            ap.error("give --name (or --csv-row)")
        fi = FacultyInput(name=a.name, age=a.age, gender=a.gender, ethnicity=a.ethnicity,
                          background=a.background, personality=a.personality, notes=a.notes,
                          summary=a.summary, student_role=a.role, encounter_goal=a.goal)

    llm = BedrockLLM()
    docs = []
    for i, spec in enumerate(a.doc, start=1):
        path, _, kind = spec.partition(":")
        docs.append(load_document(path, kind or "reference", f"d{i}", llm=llm, vision_model=smart_model()))
        print(f"read {path} ({docs[-1].kind.value}, {len(docs[-1].text)} chars)")

    print(f"\nGenerating {fi.name} ... (one large call, usually 30-90 s)")
    t = time.time()
    profile, issues = generate_profile(fi, docs, llm)
    print(f"done in {time.time() - t:.0f}s")


    out = Path(a.out); out.mkdir(exist_ok=True)
    path = out / f"{profile.id}.json"
    path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")

    fac = sum(f.origin == Origin.faculty for f in profile.facts)
    print(f"\n{profile.persona.name}, {profile.persona.age} | {profile.primary_diagnosis}")
    print(f"{len(profile.facts)} facts ({fac} from faculty, {len(profile.facts) - fac} generated for review) | "
          f"{len(profile.artifacts)} chart items | {len(profile.objectives)} objectives")
    for o in profile.objectives:
        print(f"  [{o.min_level or 'all'}] {o.objective}")
    print("\nReview list:" if issues else "\nNo issues found.")
    for i in issues:
        print(f"  [{i.severity:7}] {i.code}: {i.message}")
    print(f"\nSaved {path}\nChat:  python -m scripts.try_encounter {path} --level M1")


if __name__ == "__main__":
    main()
