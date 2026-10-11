# OSCEnario frontend

One Next.js app that combines the three frontend branches:

| From branch | What it became here |
|---|---|
| `frontend-upload` | the app itself: dashboard, sidebar, Professor/Student toggle, NetID sign-in |
| `frontend-patient-studio` | `/studio`: now builds patients with the backend AI instead of hand-typed release words |
| `feature/voice-avatar` | `lib/voice/`: avatar, push-to-talk, patient voice player, Studio voice controls |

Every page talks to the real backend through `lib/api.ts`. The old keyword chat engine, demo patient and
localStorage "publishing" are gone: the backend engine decides what the patient says.

## Run

```bash
# terminal 1 (repo root)
source .venv/bin/activate && source .env
uvicorn app.main:app --reload --port 8000

# terminal 2
cd frontend
npm install          # first time only
npm run dev          # http://localhost:3000  (use Chrome or Edge for voice)
```

Backend not on :8000? Create `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8001`.

## Pages

| URL | Who | What |
|---|---|---|
| `/` | both | dashboard; toggle Professor/Student in the top bar |
| `/studio` | faculty | patient library, "Load the 8 sample patients", **+ Create patient** (judge demo) |
| `/studio/patient?id=…` | faculty | review AI-added facts, consistency check, voice, publish, **assign at M1–M4** |
| `/professor/results` | faculty | assignments → attempts → feedback + instructor review (notes, EPA confirm) |
| `/student` | student | NetID, my assignments (name + level only, nothing clinical) |
| `/encounter?assignment=…` | student | the voice room |
| `/encounter?patient=…&preview=1` | faculty | try a patient (drafts too) at any level |
| `/feedback` | student | past encounters and full reports |

## The encounter room

- Left: patient avatar (portrait, or initials if none) that glows with the voice. Right: the student's camera as a
  live mirror (never recorded, never sent anywhere).
- Hold the mic button or the **space bar** to talk. The browser turns speech into text (Chrome/Edge Web Speech
  API), the text goes to `POST /encounters/{id}/message`, the reply is spoken via `POST /tts`
  (ElevenLabs → Polly → browser voice).
- No captions, no script. Pressing talk while the patient speaks interrupts them.
- **Chart** button opens a slide-out with only what the student has uncovered. The at-start referral is hidden
  (`SHOW_AT_START_ITEMS` in `app/encounter/page.tsx`).
- "Mic not working? Type instead" is the backup for a bad mic during a demo.
- **End encounter** grades it (`POST /end`) and shows the rubric report with the transcript.

Privacy: no audio or video is stored by us; only the transcript is saved. Chrome's speech recognition does send
the audio to Google's speech service to transcribe it.
