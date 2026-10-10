# Virtual Patient Encounter — backend (seed data + schema)

## What's here

```
app/schemas.py    PatientProfile, Fact, Artifact, LearningObjective, EncounterState (Pydantic v2)
app/importers.py  VHS dataset (patients.jsonl) + faculty CSV  ->  PatientProfile
app/rules.py      deterministic consistency checks (POST /patients/{id}/validate, layer 1)
scripts/seed.py   converts the organizers' data into samples/*.json + prints a validation report
samples/          the 8 seed patients, ready to load into the DB, + portraits/
data/             raw organizer files (patients.jsonl, faculty CSV)
```

Run: `pip install "pydantic>=2"` then
`python -m scripts.seed --dataset data/patients.jsonl --csv data/faculty-provided-sample-patient-details.csv --images "data/patient images" --out samples`

## How a profile is built

- **Every fact gets an id (`f001`…), a disclosure tier, a `min_trust` (0–3) and an `origin`.**
  Tiers come straight from the dataset: `initial` → volunteered; `discoverable` → when asked;
  `reluctant` → trust ≥ 2; `hidden` → trust 3. Hidden items that read like third-party records
  ("Parent reports…", "Medical records show…") become `chart` facts plus a *Prior records* artifact:
  the patient never says them; the chart shows them on request.
- **Structured sections become facts too** (meds + adherence + concerns, diet, sleep, goals, fears…),
  so the patient can answer "do you take any supplements?" truthfully and the answer is logged.
  An empty allergy list becomes an explicit "No known allergies" fact.
- **Artifacts**: Referral summary (`at_start`); Vitals, Anthropometrics, Labs, Clinical findings,
  Prior records (`on_request`, with keywords the router uses).
- **Objectives** keep the dataset's `expected_discoveries`, each linked to fact ids. Seed links are
  lexical (`link_method: "lexical"`) and weak — replace with an LLM linking pass or faculty edits.
- `faculty_brief` keeps the CSV row verbatim so drift can be detected.
- `router_index()` / `artifact_index()` are what the router prompt receives.

## What the validator finds in the organizers' own data

| Check | Example |
|---|---|
| `faculty_drift` | Nisha: CSV says newly diagnosed **MS**; profile turned her into T2DM |
| `bmi_mismatch` | 6/8 patients. Omar 228 lb @ 5'10" = 32.7, profile says 29.2 |
| `bmi_category` | Vladko BMI 22 labelled "underweight" |
| `med_without_indication` | Dominic on lisinopril "for blood pressure", no hypertension diagnosis |
| `duplicate_fact` (conflicting tiers) | Vladko "Lack of local support network" in all four tiers |
| `misplaced_row` | BMI listed under labs |

Good pitch material: the reference generator drifts; ours flags it before publishing.

## Encounter engine (turn loop)

```
app/bedrock.py            BedrockLLM.call_json (tool-forced structured output) / call_text
app/linking.py            link_objectives(profile, llm): LLM replaces the weak lexical links
app/encounter/prompts.py  router + patient system prompts and output schemas
app/encounter/engine.py   start_encounter / take_turn / end_encounter / chart_view
scripts/try_encounter.py  chat with a seed patient in the terminal through real Bedrock
tests/test_engine.py      offline tests with a fake LLM (python tests/test_engine.py)
```

Env: `AWS_REGION`, `VPE_FAST_MODEL` (Haiku-class, every turn), `VPE_SMART_MODEL` (Sonnet-class).
Use the inference-profile IDs from the Bedrock console.

One turn = 2 fast calls (router ~3-5k tokens in, patient ~1k + history).

1. **Router** sees fact ids + content + chart items + last 6 turns; returns `fact_ids`,
   `artifact_ids`, communication `tags`, `trust_delta` (-1/0/+1), `off_script`.
2. **Trust** moves first (so a kind question can unlock its own answer), clamped 0-3.
3. **Gate** (plain code, `engine.can_share`): initial/discoverable need `min_trust`; reluctant ~2;
   hidden needs 3; chart facts are never spoken. Requested-but-locked facts are passed to the
   patient as *topics only* so it deflects in character - logged as `deflected` for feedback.
4. **Patient** sees persona + known facts + newly allowed facts only; returns reply +
   `used_fact_ids`. Ids it wasn't given are discarded, so it can't claim a fact it wasn't shown.
5. **State**: disclosed facts, released artifacts (opening *Prior records* also discloses its chart
   facts), per-turn log with tags. `chart_view()` is what the right-hand panel renders.

Off-script turns (jailbreak attempts) release nothing and don't change trust.

API wiring: `POST /encounters` -> `start_encounter`; `POST /encounters/{id}/message` ->
`take_turn` then return `TurnResult` + `chart_view`; save `EncounterState` JSON after each turn.

## Studio generator, RAG, year levels, feedback

```
app/studio/documents.py   read uploads: PDF, DOCX, TXT/CSV/JSON; images (ECG, X-ray, scanned labs) via Claude vision
app/studio/rag.py         chunk + BM25 search over reference documents (swap-in point for embeddings)
app/studio/generator.py   FacultyInput + documents -> PatientProfile (generate_profile)
app/levels.py             apply_level / graded_objectives / domain_modes, driven by data/levels.json
app/feedback/engine.py    build_feedback(profile, state, llm) -> report for student + faculty
data/levels.json          M1-M4: patient difficulty + which rubric domains count (edit freely)
data/rubrics/             the organizers' 7-domain rubric (feedback reads it; no rubric in code)
scripts/try_generate.py   create a patient from the terminal (CSV row or your own description + docs)
tests/test_studio_feedback.py
```

**Documents.** Faculty tag each upload as `patient_record` (labs, prior notes about THIS patient) or
`reference` (guidelines, syllabus). Patient records go to the generator in full as ground truth and
become chart items. Reference docs are searched (RAG) for passages that shape the learning objectives,
and again at grading time to check the accuracy of what the student explained. The patient never
sees reference material.

**Generator.** One Sonnet call writes a record in the organizers' VHS format (Wyatt as the example),
which then goes through the SAME importer as the seed patients. Facts that match faculty input are
`origin: faculty`; everything else is `generated` and highlighted for review. Rules then check that
every faculty condition (`faculty_drift`) and number (`faculty_number_missing`) survived.

**Year levels.** The level is chosen per assignment/encounter, not stored on the patient, so one patient
serves every year. M1: patient starts friendlier and opens up sooner; clinical reasoning is N/A.
M4: guarded, vague, competing concerns; every domain graded at a high bar. The rubric itself says to use
N/A when a criterion isn't appropriate, which is what the per-level `na` mode does.

**Feedback.** Found/missed findings and communication stats are computed in code from the disclosure
log and router tags. The LLM scores each rubric domain with turn-cited quotes against the level's
expectations. Code then forces N/A domains, drops any quote that isn't really in the transcript, and
sets `needs_review` when domain 6 or 7 scores 1 (the rubric's review trigger). Output includes
`faculty_notes` for the instructor.

Try it:
```
python -m scripts.try_generate --csv-row 2                       # Nisha: watch faculty_drift fire if MS is dropped
python -m scripts.try_encounter generated/<id>.json --level M1   # /quit prints the rubric feedback
```

## EPAs (entrustment)

`data/frameworks/aamc_core_epas.json` lists the AAMC's 13 Core EPAs, a 5-level supervision scale
(observe only, direct, indirect, unsupervised, supervises others), which EPAs a simulated interview can
partly show, and which rubric domains provide evidence toward each EPA.

`data/levels.json` sets, per year, which EPAs are in focus and the target supervision level
(defaults rise to level 3, indirect supervision, by M4: the AAMC day-one-of-residency expectation).
Schools should edit these targets.

Feedback adds `epas`: for each EPA in focus, the supervision level this encounter's evidence supports,
the target, whether it meets the target, verified quotes, and the linked rubric domain scores.
Code rules: no verified quote means no estimate; one simulated encounter is capped at level 3.
`faculty_confirmed_level` is left for the instructor.

## Checklist rubrics (e.g. the Pediatric Hearing Treatment rubric)

`app/studio/rubric_import.py` converts a faculty checklist (DOCX/PDF/TXT) into
`data/rubrics/<id>.json`: sections with points and the items under each. The common
"Section (N points)" layout is parsed directly; anything else is converted by Claude.
`pediatric_hearing_treatment_checklist.json` (100 points, 4 sections) is included.

Attach one or more to a patient via `settings.checklist_rubric_ids`. Feedback then adds `checklists`:
each item achieved / partial / not achieved with a verified quote. Points are computed in code
(section points split evenly across items; partial = half). An item claimed without a verifiable
quote counts as not achieved. This runs alongside the 7-domain rubric and the EPA estimates.

```
python -m scripts.try_generate --name "Lily Chen" --age 9 --gender female --role "Speech-language pathology student" \
  --notes "Bilateral moderate sensorineural hearing loss diagnosed at age 3; wears hearing aids; struggles in noisy classrooms" \
  --summary "Pediatric hearing loss, aural rehabilitation" --checklist pediatric_hearing_treatment_checklist
```

## When an attachment is missing

`data/artifact_requirements.json` lists words that mean a rubric item needs a specific attachment
(audiogram, X-ray, CT, MRI, ultrasound, ECG, labs, prior records) and how to recognise one in the
patient's chart or uploads (`app/attachments.py`). If a checklist item needs something the patient
doesn't have, it is `not_applicable`: its points are removed from the maximum (e.g. 0/70 instead of
0/100 when the 30-point audiogram section can't be done), and the report lists what was skipped and why.
The Studio validator warns faculty first (`checklist_needs_attachment`) so they can upload the file.
EPA 3 (interpret tests) is not assessed when the chart has no test results at all.

## API (app/main.py)

`uvicorn app.main:app --reload --port 8000`, docs at http://localhost:8000/docs. SQLite file `twinverse.db`
(gitignored); uploads in `uploads/`. Built on the backend-api branch's structure (db.py + CORS), now wired in.

| Area | Endpoints |
|---|---|
| Config | `GET /config/grading` (levels, rubric, EPAs, checklists), `GET /config/levels`, `GET /rubrics`, `POST /rubrics/import` |
| Studio | `POST /patients/import` (8 seeds, published) · `POST /patients/generate` (multipart: `brief` JSON + `files[]` + `kinds` + `checklist_rubric_ids`) · `GET/PUT /patients/{id}` · `POST /patients/{id}/documents` · `/validate` · `/link` · `/publish?force=` |
| Assignments | `POST /assignments` (patient, level, students, checklists, attempts) · `GET /assignments?student_id=` · `GET /assignments/{id}/results` |
| Encounters | `POST /encounters` (`assignment_id` or `patient_id`; `preview=true` lets faculty test drafts) · `POST /encounters/{id}/message` · `GET /encounters/{id}` · `/chart` · `POST /end` (grades) · `GET /feedback` · `PUT /feedback/faculty` |
| Files | `GET /portraits/{file}` · `POST /portraits` · `GET /uploads/{file}` |
| Voice | mounted automatically when `app/voice` (feature/voice-avatar) is present; `GET /health` shows `voice: true` |

Rules enforced by the API: students can only start published patients; editing a published patient
returns it to draft; publish is blocked while errors exist (`force=true` = "publish anyway");
the year level comes from the assignment; AI failures return 502 with a readable message.
`python tests/test_api.py` runs the whole teacher -> student -> faculty flow with a fake LLM.

## Voice (from feature/voice-avatar, TTS only)

`app/voice/` was brought over without the rest of that branch: `POST /tts`, `POST /tts/preview`, `GET /voices`,
`GET /voices/status`, `POST /voices/assign`. Every patient gets a voice automatically (`ensure_voice` on import and
generate); faculty can change it in the Studio. ElevenLabs is used for text-to-speech only, never their agents:
the words always come from the encounter engine. Put `ELEVENLABS_API_KEY` in `.env` (backend only). Without it,
Polly is tried, then the browser speaks. `python tests/test_voice.py` runs offline.

## Frontend

`frontend/` is the combined Next.js app (teacher portal, student portal, voice encounter room). See
`frontend/README.md`. Run the backend on :8000, then `cd frontend && npm install && npm run dev`.
