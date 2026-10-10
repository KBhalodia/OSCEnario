"""
Export what the frontend needs to show levels and rubrics:
    python -m scripts.export_frontend_config   -> frontend_contract/levels_and_rubrics.json
Same object the API serves at GET /config/grading.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.grading_config import build  # noqa: E402


def main() -> None:
    out = ROOT / "frontend_contract"
    out.mkdir(exist_ok=True)
    (out / "levels_and_rubrics.json").write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {out / 'levels_and_rubrics.json'}")


if __name__ == "__main__":
    main()
