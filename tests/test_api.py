"""
End-to-end API test with a fake LLM: teacher imports/creates patients, publishes,
assigns at a level; student runs the encounter, ends it, gets feedback; faculty
reviews and sees results.   python tests/test_api.py   (needs fastapi + httpx)
"""
from __future__ import annotations

import copy
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["VPE_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ.setdefault("VPE_FAST_MODEL", "fast")
os.environ.setdefault("VPE_SMART_MODEL", "smart")

from fastapi.testclient import TestClient  # noqa: E402

from app.importers import read_json_objects  # noqa: E402
from app.main import app, llm_dep  # noqa: E402

RECORDS = {r["patient_overview"]["name"]: r
           for r in read_json_objects((ROOT / "data" / "patients.jsonl").read_text())}
WYATT = "4d619156-3250-4212-8399-129f3280fab1"


class FakeLLM:
    def call_json(self, *, tool_name, user=None, system="", **_):
        if tool_name == "route_turn":
            ids = re.findall(r'"id": "(a\d{3})",\s*"type": "lab_report"', user or "")
            asks_labs = "labs" in (user or "").rsplit("STUDENT'S LATEST MESSAGE:", 1)[-1].lower()
            return {"fact_ids": [], "artifact_ids": ids[:1] if asks_labs else [],
                    "tags": ["open_question"], "trust_delta": 1, "off_script_reason": ""}
        if tool_name == "patient_reply":
            return {"reply": "I've been really tired lately.", "used_fact_ids": [], "deflected": False}
        if tool_name == "patient_record":
            return copy.deepcopy(RECORDS["Yvette Armstrong"])
        if tool_name == "objective_links":
            return {"links": []}
        if tool_name == "diagnosis_check":
            return {"verdict": "correct", "matched": "Type 2 Diabetes", "differential_hits": [],
                    "explanation": "Thirst, tiredness and his labs point to diabetes."}
        if tool_name == "encounter_feedback":
            dom = lambda k, sc: {"key": k, "score": sc, "rationale": "r", "evidence": [  # noqa: E731
                {"turn": 1, "quote": "what brings you in"}], "strength_demonstrated": "",
                "important_gap_or_missed_opportunity": "", "safety_or_accuracy_concern": ""}
            keys = ["opening_and_purpose", "rapport_respect_empathy", "information_gathering",
                    "listening_and_response_to_cues", "explanation_and_shared_decisions",
                    "clinical_reasoning_and_synthesis", "professionalism_safety_closure"]
            return {"domains": [dom(k, "3") for k in keys], "skill_items": [], "strengths": ["a"],
                    "areas_for_improvement": ["b"], "next_attempt_suggestions": ["1", "2", "3"],
                    "summary": "ok", "entrustment": []}
        raise AssertionError(tool_name)

    def call_text(self, **_):
        return "unused"


app.dependency_overrides[llm_dep] = lambda: FakeLLM()


def run():
    with TestClient(app) as c:
        assert c.get("/health").json()["ok"]
        cfg = c.get("/config/grading").json()
        assert [l["key"] for l in cfg["levels"]] == ["M1", "M2", "M3", "M4"]
        assert [r["id"] for r in c.get("/rubrics").json()] == ["encounter_evaluation_rubric"]

        # ---- teacher: seed patients
        r = c.post("/patients/import").json()
        assert r["imported_count"] == 8 and not r["errors"], r
        pts = c.get("/patients").json()
        assert len(pts) == 8 and all(p["status"] == "published" for p in pts)
        assert c.get(f"/portraits/{WYATT}.png").status_code == 200

        # ---- teacher: generate a new patient with a patient-record document
        brief = {"name": "Yvette Armstrong", "age": 64, "gender": "female",
                 "notes": "Stage II hypertension (BP 155/110 mmHg). BMI is 34.", "summary": "Hypertension"}
        r = c.post("/patients/generate", data={"brief": json.dumps(brief), "kinds": '["patient_record"]'},
                   files=[("files", ("bmp_lab.txt", b"BMP 2026-09: Sodium 138 mEq/L, Potassium 4.5", "text/plain"))])
        assert r.status_code == 200, r.text
        gen = r.json()["patient"]
        gid = gen["id"]
        assert gen["status"] == "draft"
        assert any(a["title"] == "bmp lab" for a in gen["artifacts"])
        codes = {i["code"] for i in r.json()["issues"]}
        assert "bmi_mismatch" in codes

        # images are never read by the AI: the chart item has no text; faculty's summary is kept for grading
        r = c.post(f"/patients/{gid}/documents",
                   data={"kind": "patient_record", "name": "Chest X-ray", "doc_type": "imaging",
                         "summary": "Faculty read: normal chest film"},
                   files={"file": ("cxr.png", b"\x89PNG fake", "image/png")}).json()
        xr = next(a for a in r["patient"]["artifacts"] if a["title"].endswith("Chest X-ray"))
        assert xr["text"] is None and xr["type"] == "imaging" and xr["file_path"].endswith(".png")
        doc = next(d for d in r["patient"]["documents"] if d["name"] == "Chest X-ray")
        assert doc["summary"] == "Faculty read: normal chest film" and doc["doc_type"] == "imaging"

        # publish is blocked by the BMI error until forced
        assert c.post(f"/patients/{gid}/publish").status_code == 409
        assert c.post(f"/patients/{gid}/publish?force=true").json()["patient"]["status"] == "published"

        # faculty preview of a draft is allowed; a student encounter on a draft is not
        p = c.get(f"/patients/{WYATT}").json()
        p["persona"]["description"] += " (edited)"
        r = c.put(f"/patients/{WYATT}", json=p).json()
        assert r["patient"]["status"] == "draft" and r["patient"]["version"] == 2
        assert c.post("/encounters", json={"patient_id": WYATT}).status_code == 400
        assert c.post("/encounters", json={"patient_id": WYATT, "preview": True}).status_code == 200
        c.post(f"/patients/{WYATT}/publish?force=true")

        # ---- teacher: assignment at M1
        a = c.post("/assignments", json={"patient_id": WYATT, "level": "M1", "student_ids": ["s1"],
                                         "created_by": "prof1", "max_attempts": 2}).json()
        assert a["level_label"].startswith("Year 1")
        assert [x["id"] for x in c.get("/assignments?student_id=s1").json()] == [a["id"]]
        assert c.post("/encounters", json={"assignment_id": a["id"], "student_id": "s2"}).status_code == 403

        # ---- student: encounter
        e = c.post("/encounters", json={"assignment_id": a["id"], "student_id": "s1"}).json()
        eid = e["encounter_id"]
        assert e["level"] == "M1" and e["chart"]["artifacts"]          # referral visible at start
        assert c.post(f"/encounters/{eid}/end").status_code == 400     # nothing said yet
        m = c.post(f"/encounters/{eid}/message", json={"message": "Hi Wyatt, what brings you in today?"}).json()
        assert m["reply"] and m["turn"] == 2 and m["trust"] == 3       # M1 starts at 2, +1
        m = c.post(f"/encounters/{eid}/message", json={"message": "Can I see your labs?"}).json()
        assert [x["title"] for x in m["new_artifacts"]] == ["Laboratory results"]
        assert c.post(f"/encounters/{eid}/message", json={"message": ""}).status_code == 422

        fb = c.post(f"/encounters/{eid}/end").json()
        assert fb["level"] == "M1" and fb["max_total"] == 24          # clinical reasoning N/A at M1
        assert {d["key"]: d["score"] for d in fb["domains"]}["clinical_reasoning_and_synthesis"] == "N/A"
        assert c.post(f"/encounters/{eid}/end").json()["encounter_id"] == eid   # idempotent
        assert c.post(f"/encounters/{eid}/message", json={"message": "hi"}).status_code == 400
        full = c.get(f"/encounters/{eid}").json()
        assert full["status"] == "completed" and len(full["transcript"]) == 4 and full["feedback"]

        # ---- faculty: review + results
        r = c.put(f"/encounters/{eid}/feedback/faculty",
                  json={"notes": "Good start", "reviewed_by": "prof1", "epa_confirmed_levels": {"EPA1": 2}}).json()
        assert r["faculty_notes"] == "Good start" and r["epas"][0]["faculty_confirmed_level"] == 2
        res = c.get(f"/assignments/{a['id']}/results").json()
        assert len(res["attempts"]) == 1 and res["attempts"][0]["total"] == fb["total"]
        assert [x["id"] for x in c.get("/encounters?student_id=s1").json()] == [eid]

        # ---- classes: create, join with code, assign inside the class, M3 diagnosis question
        cl = c.post("/classes", json={"name": "Nutrition counseling", "section": "Fall 2026", "created_by": "prof1"}).json()
        assert len(cl["code"]) == 7 and cl["patients"] == []
        assert c.post("/classes/join", json={"code": "nope", "student_id": "s9"}).status_code == 404
        j = c.post("/classes/join", json={"code": cl["code"].upper(), "student_id": "S9"}).json()
        assert "student_ids" not in j
        assert c.get(f"/classes/{cl['id']}", params={"student_id": "zz"}).status_code == 403
        a3 = c.post("/assignments", json={"patient_id": WYATT, "class_id": cl["id"], "level": "M3"}).json()
        assert a3["asks_diagnosis"] and a3["class_name"] == "Nutrition counseling"
        assert [x["id"] for x in c.get("/assignments", params={"student_id": "s9"}).json()] == [a3["id"]]
        assert c.get("/assignments", params={"student_id": "outsider"}).json() == []
        assert c.post("/encounters", json={"assignment_id": a3["id"], "student_id": "outsider"}).status_code == 403
        cls_view = c.get("/classes", params={"student_id": "s9"}).json()[0]
        assert cls_view["patients"][0]["name"] == "Wyatt Nelson" and "primary_diagnosis" not in cls_view["patients"][0]
        br = c.get(f"/assignments/{a3['id']}/brief").json()
        assert br["asks_diagnosis"] and br["learning_goals"] and len(br["domains"]) == 7
        assert "primary_diagnosis" not in json.dumps(br) and "expected_discoveries" not in json.dumps(br)
        e3 = c.post("/encounters", json={"assignment_id": a3["id"], "student_id": "s9"}).json()
        assert "primary_diagnosis" not in e3["patient"]
        c.post(f"/encounters/{e3['encounter_id']}/message", json={"message": "Hi, what brings you in?"})
        c.post(f"/encounters/{e3['encounter_id']}/message",
               json={"message": "Tell me more", "response_ms": 18000, "interrupted": True})
        tr = c.get(f"/encounters/{e3['encounter_id']}").json()["transcript"]
        assert tr[2]["response_ms"] == 18000 and tr[2]["interrupted"] and "offset_s" in tr[0]
        fb3 = c.post(f"/encounters/{e3['encounter_id']}/end",
                     json={"diagnosis": "T2DM", "differential": ["prediabetes"], "reasoning": "thirst"}).json()
        assert fb3["diagnosis"]["verdict"] == "correct" and fb3["diagnosis"]["expected"]
        assert fb3["communication"]["pacing"]["long_pauses"] == [3]
        assert fb3["communication"]["pacing"]["interrupted_turns"] == [3]
        assert "diagnosis" not in fb       # M1 isn't asked
        assert c.get(f"/assignments/{a3['id']}/results").json()["attempts"][0]["diagnosis"] == "correct"

        # ---- delete: assigned patients can't be deleted; unassigned drafts can
        assert c.delete(f"/patients/{WYATT}").status_code == 409
        assert c.delete(f"/patients/{gid}").json()["deleted"] == gid
        assert c.get(f"/patients/{gid}").status_code == 404

        # attempts limit
        c.post("/encounters", json={"assignment_id": a["id"], "student_id": "s1"})
        assert c.post("/encounters", json={"assignment_id": a["id"], "student_id": "s1"}).status_code == 400
    print("PASS test_api end-to-end (teacher + student + faculty review)")


if __name__ == "__main__":
    run()
