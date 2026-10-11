"""
Display-ready grading config for the frontend (levels, rubric, EPAs),
built from the same data files the backend grades with. Served at GET /config/grading
and exported to frontend_contract/ by scripts/export_frontend_config.py.
"""
from __future__ import annotations

import json
from pathlib import Path

from app import levels

ROOT = Path(__file__).resolve().parents[1]

MODE_LABELS = {
    "core": "Graded with the rubric as written",
    "lenient": "Graded against this year's expectations",
    "na": "Not expected at this year (always N/A)",
}


def build() -> dict:
    rubric = json.loads((ROOT / "data" / "rubrics" / "encounter_evaluation_rubric.json").read_text())
    fw = levels.load_framework()
    epa_title = {e["id"]: e["title"] for e in fw["epas"]}
    scale = {s["level"]: s["label"] for s in fw["scale"]}

    out_levels = []
    for key in levels.level_names():
        lv = levels.get_level(key)
        modes = lv["grading"]["domains"]
        out_levels.append({
            "key": key,
            "label": lv["label"],
            "expectations": lv["grading"]["expectations"],
            "patient_difficulty": lv["patient"]["notes"],
            "asks_diagnosis": bool(lv.get("asks_diagnosis")),
            "domains": [{"key": d["key"], "name": d["name"], "mode": modes.get(d["key"], "core"),
                         "mode_label": MODE_LABELS[modes.get(d["key"], "core")]} for d in rubric["domains"]],
            "max_total": 4 * sum(modes.get(d["key"], "core") != "na" for d in rubric["domains"]),
            "epa_targets": [{"id": eid, "title": epa_title[eid], "target_level": t, "target_label": scale[t]}
                            for eid, t in lv["grading"].get("epa_targets", {}).items()],
        })

    return {
        "_about": "Generated from backend/data by scripts/export_frontend_config.py. Do not edit by hand; "
                  "change the backend data files and re-export.",
        "levels": out_levels,
        "domain_modes": MODE_LABELS,
        "rubric": {
            "id": "encounter_evaluation_rubric", "title": rubric["title"],
            "instructions": rubric["instructions"], "rating_scale": rubric["rating_scale"],
            "domains": [{"id": d["id"], "key": d["key"], "name": d["name"],
                         "triggers_review_if_score_1": d["triggers_review_if_score_1"],
                         "descriptors": d["descriptors"]} for d in rubric["domains"]],
            "interpretation": rubric["scoring"]["interpretation"],
        },
        "entrustment": {"framework": fw["title"], "source": fw["source"], "scale": fw["scale"],
                        "epas": [{"id": e["id"], "title": e["title"], "observable": e["observable"],
                                  "simulation_note": e.get("simulation_note", "")} for e in fw["epas"]]},
    }
