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
