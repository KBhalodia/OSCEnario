# Frontend — voice + avatar components

Reusable pieces in `src/voice/` (import from `src/voice`):

| Piece | What it does |
|---|---|
| `useVoicePlayer()` | `speak({text, patientId, persona, trust, deflected})` plays `/tts` audio; falls back to `speechSynthesis`; `stop()` for barge-in; `levelRef` (0..1) drives the avatar; call `unlock()` in a click handler once |
| `usePushToTalk(onFinal)` | Hold-to-talk with the Web Speech API (Chrome/Edge). `supported` is false elsewhere: hide the button. Final text goes to `onFinal`, i.e. the same send path as typing |
| `<PatientAvatar>` | Portrait, or initials/silhouette placeholder for patients without a photo (never another patient's face). States `idle / listening / thinking / speaking`; audio-driven glow; optional trust mood chip |
| `<VoiceControls>` | Studio "Voice" section: voice dropdown, style preset, speed slider, Preview, Reset to automatic. Changes set `origin: "faculty"` |

Turn flow: send text -> show reply text immediately -> `speak()` -> avatar `speaking` until the audio ends.
Pressing push-to-talk calls `player.stop()` first (barge-in).

`npm run dev` serves the demo on :5173 and proxies `/tts`, `/voices`, `/patients`, `/encounters`,
`/portraits` to the backend on :8000 (`app/dev_server.py`).
