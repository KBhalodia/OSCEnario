# OSCEnario

Practice the patient-encounter stations of your OSCE.

Faculty describe a patient in a few lines. OSCEnario builds the full case, checks it for contradictions, and lets faculty review every fact before students see it. Students then talk to that patient out loud, the way they would in a real station: no script, no captions, and nothing about the case shown up front. When they finish, they get feedback scored on the school's rubric, with quotes from their own interview.

Built at RU HealthHack 2026 for Challenge 1, the Virtual Patient Encounter System.

## What a session looks like

**Faculty**
1. Create a class. It gets a seven-letter join code.
2. Create a patient: name, a few clinical notes, the diagnosis the student should reach, and any lab reports, X-rays or guidelines. Generation takes 30 to 90 seconds.
3. Review the case. Facts the AI added are marked so you know what to check. Publish, then assign it to the class at a year level (M1 to M4).
4. Read results as they come in, confirm EPA levels and leave a comment for the student.

**Students**
1. Join the class with the code.
2. Open the assignment. Before joining, they can see how they'll be graded: the rubric, what's expected at their year, and the learning goals.
3. Hold the space bar to talk. The patient answers in their own voice. The chart fills in only with what they find out by asking.
4. End the visit. M3 and M4 students are asked for their working diagnosis first. Then the feedback report.

## How the patient stays honest

The hardest part of this problem is a patient who never invents anything and only shares what a real patient would. Every patient is a list of facts, and each fact has a rule for when it comes out:

| Rule | When the patient shares it |
|---|---|
| Volunteers it | Early, without being asked |
| When asked | When the student asks about that topic |
| Reluctant | Only once the student has built some trust |
| Hidden | Only with high trust |
| Chart only | Never spoken; appears in the chart when the student asks for it |

Each turn works like this:
1. A fast model reads the student's question and picks which facts it touches. It also tags the question (open, leading, empathetic, jargon, and so on).
2. Plain code decides which of those facts the patient may share right now, based on the rule and the current trust level. The model doesn't make this call.
3. The patient model sees only the facts it's allowed to share and plays the person. If the student asks about something locked, the patient deflects in character.
4. Every disclosure is logged, and feedback is built from that log.

What students never get:
- **The diagnosis.** It's the answer key. Diagnosis facts never reach the chart, and the patient describes symptoms instead of naming conditions ("they said my sugar was high"). Faculty can turn this off per patient.
- **An AI reading of an image.** The AI doesn't interpret uploaded X-rays, ECGs or other images. Students see the image itself; the only interpretation is the one faculty write, and only the grader sees it.
- **The expected findings.** The lobby shows learning goal titles, not what the student is supposed to uncover.

## How grading works

- **The rubric** is the organizers' seven-domain encounter rubric, scored 1 to 4. Every score cites turns from the transcript, and quotes that don't appear in the transcript are dropped before the report is saved.
- **Year levels** come from `data/levels.json`. M1 students meet a cooperative patient and aren't graded on clinical reasoning; M4 students meet a guarded one and are graded on everything. One patient serves every year, because the level comes from the assignment.
- **EPAs.** Each report estimates entrustment for the AAMC Core EPAs in focus at that year. One simulated visit is capped at indirect supervision, and an estimate with no quoted evidence is left blank. Faculty confirm the level.
- **Pacing.** The browser measures how long the student paused after the patient finished and whether they talked over the patient. It's reported and used as evidence for the listening domain, not scored on its own.
- **Diagnosis (M3 and M4).** The student's answer is compared with the case's answer key, allowing synonyms and abbreviations.
- **Needs review.** A score of 1 in the clinical reasoning or safety domain flags the attempt for faculty.

## Running it

You need Python 3.9 or newer, Node 20 or newer, Chrome or Edge (for speech-to-text), and AWS credentials with Bedrock access.

**1. Backend** (from the repo root)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in your keys
source .env
uvicorn app.main:app --reload --port 8000
```

**2. Frontend** (in a second terminal)
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. As faculty, open the Patient library and click **Load sample patients** to get the eight cases from the organizers' dataset.

**Environment** (`.env`, never committed)

| Variable | What it's for |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION` | Bedrock |
| `VPE_FAST_MODEL` | Every conversation turn. We use Claude Haiku 4.5. |
| `VPE_SMART_MODEL` | Case generation and grading. We use Claude Sonnet 4.6. |
| `ELEVENLABS_API_KEY` | Optional. The patient's voice. Without it the backend tries Amazon Polly, then the browser's built-in voice. |

## Project layout

```
app/
  main.py              API routes: classes, patients, assignments, encounters, feedback
  encounter/           the turn loop and the router and patient prompts
  studio/              case generation, document reading, search over reference files
  feedback/            rubric grading, EPAs, pacing, diagnosis check
  rules.py             consistency checks run before publishing
  levels.py            year-level difficulty and grading
  voice/               text-to-speech and automatic voice choice per patient
data/
  levels.json          M1 to M4 settings; edit to match your school
  rubrics/             the encounter evaluation rubric
  frameworks/          AAMC Core EPAs
  patients.jsonl       the organizers' sample dataset
frontend/              Next.js app: faculty and student portals, the encounter room
samples/               the eight sample patients, converted, with portraits
tests/                 offline tests; no AWS calls
```

## Tests

```bash
python -m pytest -q tests
python tests/test_api.py
```

The tests use a fake model, so they run offline and cost nothing. `test_api.py` walks the whole flow: create and publish a patient, make a class, join it with the code, run an M3 encounter, answer the diagnosis question, and leave a faculty review. `test_privacy.py` checks that diagnoses and AI image reads never reach a student's chart.

## Privacy

- No audio or video is recorded or stored. The camera is a local mirror only.
- The only thing saved from a visit is the text of the conversation.
- Speech-to-text runs in the browser. In Chrome, that means Google's speech service transcribes the audio.
- The patient's voice is generated from the reply text. ElevenLabs is used for text-to-speech only, never its conversational agents, so the grounding engine stays in charge of what the patient says.
- API keys live only in the backend's `.env`.

## Credits

- Sample patients come from the organizers' Virtual Health Simulation dataset ([joeljames270/virtual-patient-profiles-sample](https://huggingface.co/datasets/joeljames270/virtual-patient-profiles-sample)).
- The encounter evaluation rubric was provided with the challenge.
- EPA definitions follow the AAMC Core Entrustable Professional Activities for Entering Residency.
