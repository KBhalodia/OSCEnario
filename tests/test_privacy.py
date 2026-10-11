"""
Students must work the diagnosis out (OSCE prep): diagnosis facts never reach the chart, chart items
lose their diagnosis rows, and the patient is told not to say clinical labels.
    python -m pytest -q tests/test_privacy.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.encounter import engine, prompts  # noqa: E402
from app.schemas import FactCategory, PatientProfile, ProfileStatus  # noqa: E402

WYATT = ROOT / "samples" / "4d619156-3250-4212-8399-129f3280fab1.json"


def _wyatt() -> PatientProfile:
    p = PatientProfile.model_validate_json(WYATT.read_text())
    p.status = ProfileStatus.published
    return p


def test_chart_hides_diagnoses():
    p = _wyatt()
    s = engine.start_encounter(p)
    s.disclosed_fact_ids = [f.id for f in p.facts]                 # pretend everything was said
    s.released_artifact_ids = [a.id for a in p.artifacts]
    view = engine.chart_view(p, s)
    assert FactCategory.diagnosis.value not in view["facts_by_category"]
    for a in view["artifacts"]:
        assert not any("diagnos" in i["label"].lower() for i in a["items"]), a["title"]


def test_image_chart_items_show_no_ai_read():
    """Old uploads may carry an AI description of an image; the student's chart drops it."""
    from app.schemas import Artifact, ArtifactType
    p = _wyatt()
    p.artifacts.append(Artifact(id="a099", type=ArtifactType.imaging, title="Chest X-ray",
                                text="AI read: large mediastinal mass", file_path="ab12_cxr.png"))
    s = engine.start_encounter(p)
    s.released_artifact_ids = ["a099"]
    xr = engine.chart_view(p, s)["artifacts"][0]
    assert xr["text"] is None and xr["file_path"] == "ab12_cxr.png"


def test_patient_told_not_to_name_diagnosis():
    p = _wyatt()
    txt = prompts.patient_system(p, 1, [], [], [])
    assert "Never say the clinical name" in txt
    p.settings.patient_names_diagnosis = True
    assert "Never say the clinical name" not in prompts.patient_system(p, 1, [], [], [])


if __name__ == "__main__":
    test_chart_hides_diagnoses()
    test_image_chart_items_show_no_ai_read()
    test_patient_told_not_to_name_diagnosis()
    print("PASS test_privacy")
