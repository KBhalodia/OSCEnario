"use client";

// ---------------------------------------------------------------------------
// The encounter room: a voice-only conversation, like a real visit.
//
//   left  = the patient (portrait avatar that glows while it speaks)
//   right = the student's own camera (a live mirror: never recorded or sent)
//
// The student holds the talk button (or the space bar), speaks, lets go. The
// browser turns the speech into text, the backend engine decides what the
// patient may say (grounded, disclosure-gated), and the reply is spoken with
// the patient's voice (ElevenLabs via the backend, else the browser voice).
// No captions, no script. The chart is a slide-out that only holds what the
// student has uncovered. Only the transcript is saved, for feedback.
//
// URLs:  /encounter?assignment=<id>                    (student)
//        /encounter?patient=<id>&preview=1[&level=M3]  (faculty preview)
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import FeedbackReport from "../components/FeedbackReport";
import NetIdGate from "../components/NetIdGate";
import { btn } from "../components/AppShell";
import {
  API_BASE,
  api,
  fileUrl,
  type Artifact,
  type Assignment,
  type ChartView,
  type EncounterStart,
  type Feedback,
  type TranscriptTurn,
} from "@/lib/api";
import { FACULTY_ID, useActiveNetId } from "@/lib/identity";
import { PatientAvatar, usePushToTalk, useVoicePlayer, type AvatarState } from "@/lib/voice";

// The referral summary is released "at start" by the engine. Students asked to
// find everything out by talking, so it stays out of the chart view.
const SHOW_AT_START_ITEMS = false;

const CATEGORY_LABEL: Record<string, string> = {
  demographics: "About them",
  diagnosis: "Diagnoses",
  history: "History",
  symptom: "Symptoms",
  finding: "Findings",
  allergy: "Allergies",
  medication: "Medications",
  nutrition: "Diet & nutrition",
  lifestyle: "Lifestyle",
  psychosocial: "Psychosocial",
  social: "Social",
  other: "Other",
};

type Phase = "lobby" | "starting" | "live" | "grading" | "done";

export default function EncounterPage() {
  return (
    <Suspense fallback={<Dark>Loading…</Dark>}>
      <Room />
    </Suspense>
  );
}

function Dark({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-[#0b1f36] text-slate-100">{children}</div>;
}

function Room() {
  const params = useSearchParams();
  const assignmentId = params.get("assignment");
  const patientId = params.get("patient");
  const preview = params.get("preview") === "1";
  const netId = useActiveNetId();

  const [phase, setPhase] = useState<Phase>("lobby");
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [previewLevel, setPreviewLevel] = useState(params.get("level") ?? "M2");
  const [enc, setEnc] = useState<EncounterStart | null>(null);
  const [chart, setChart] = useState<ChartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);
  const [trust, setTrust] = useState<number | undefined>(undefined);
  const [chartOpen, setChartOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [typeMode, setTypeMode] = useState(false);
  const [typed, setTyped] = useState("");
  const [camOn, setCamOn] = useState(true);
  const [camError, setCamError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);

  const player = useVoicePlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const encRef = useRef<EncounterStart | null>(null);
  useEffect(() => {
    encRef.current = enc;
  }, [enc]);

  // ---- lobby data ---------------------------------------------------------
  useEffect(() => {
    if (!assignmentId) return;
    api
      .assignment(assignmentId)
      .then(setAssignment)
      .catch((e) => setError(e.message));
  }, [assignmentId]);

  // ---- timer --------------------------------------------------------------
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ---- leaving mid-encounter ---------------------------------------------
  useEffect(() => {
    if (phase !== "live") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // ---- camera (live mirror only) -----------------------------------------
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (phase !== "live" || !camOn) {
      stopCamera();
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setCamError(null);
      })
      .catch(() => setCamError("Camera unavailable. You can still talk to the patient."));
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [phase, camOn, stopCamera]);

  // ---- one turn -----------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      const e = encRef.current;
      const msg = text.trim();
      if (!e || !msg) return;
      setSending(true);
      setError(null);
      setLastFailed(null);
      try {
        const r = await api.send(e.encounter_id, msg);
        setTurns((n) => n + 1);
        setTrust(r.trust);
        setChart(r.chart);
        const fresh =
          r.new_facts.length + r.new_artifacts.filter((a) => SHOW_AT_START_ITEMS || a.release.trigger !== "at_start").length;
        if (fresh) setUnseen((n) => n + fresh);
        setSending(false);
        await player.speak({
          text: r.reply,
          patientId: e.patient.id,
          persona: { name: e.patient.name, age: e.patient.age, sex: e.patient.sex },
          trust: r.trust,
          deflected: r.deflected,
        });
      } catch (err) {
        setSending(false);
        setLastFailed(msg);
        setError((err as Error).message);
      }
    },
    [player],
  );

  const ptt = usePushToTalk(send);

  const pressTalk = useCallback(() => {
    if (sending || ptt.listening) return;
    player.unlock();
    player.stop(); // barge-in: the student interrupts the patient
    ptt.start();
  }, [player, ptt, sending]);

  const releaseTalk = useCallback(() => ptt.stop(), [ptt]);

  // Space bar = push to talk (ignored while typing in a field).
  useEffect(() => {
    if (phase !== "live" || !ptt.supported) return;
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isField(e.target)) return;
      e.preventDefault();
      pressTalk();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isField(e.target)) return;
      e.preventDefault();
      releaseTalk();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, ptt.supported, pressTalk, releaseTalk]);

  // ---- start / end ----------------------------------------------------------
  const start = async () => {
    player.unlock(); // inside the click: lets the browser play the patient's audio
    setError(null);
    setPhase("starting");
    // Ask for camera + microphone once now, so the first push-to-talk works.
    // The audio track is stopped right away: we never capture audio ourselves.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        /* handled by the talk button's own error */
      }
    }
    try {
      const r = assignmentId
        ? await api.startEncounter({ assignment_id: assignmentId, student_id: netId })
        : await api.startEncounter({ patient_id: patientId ?? "", preview, level: previewLevel, student_id: FACULTY_ID });
      encRef.current = r;
      setEnc(r);
      setChart(r.chart);
      setTrust(r.chart.trust);
      setElapsed(0);
      setPhase("live");
      if (!ptt.supported) setTypeMode(true);
    } catch (e) {
      setError((e as Error).message);
      setPhase("lobby");
    }
  };

  const end = async () => {
    if (!enc) return;
    if (turns === 0) {
      setError("Say something to the patient first.");
      return;
    }
    if (!window.confirm("End the encounter and get your feedback?")) return;
    player.stop();
    ptt.stop();
    stopCamera();
    setPhase("grading");
    setError(null);
    try {
      const fb = await api.end(enc.encounter_id);
      setFeedback(fb);
      api
        .encounter(enc.encounter_id)
        .then((d) => setTranscript(d.transcript))
        .catch(() => {});
      setPhase("done");
    } catch (e) {
      setError(`${(e as Error).message} You can try grading again.`);
      setPhase("grading");
    }
  };

  // ---- render ---------------------------------------------------------------
  if (assignmentId && !netId)
    return (
      <Dark>
        <div className="mx-auto mt-16 w-full max-w-lg px-4 text-slate-900">
          <NetIdGate />
        </div>
      </Dark>
    );

  if (!assignmentId && !patientId)
    return (
      <Dark>
        <div className="m-auto text-center">
          <p>No patient selected.</p>
          <Link className="mt-4 inline-block text-teal-300 underline" href="/student">
            Go to my assignments
          </Link>
        </div>
      </Dark>
    );

  if (phase === "done" && feedback)
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Your feedback · {feedback.patient_name}</h1>
              <p className="text-sm text-slate-500">
                {fmt(elapsed)} encounter · {feedback.level_label}
              </p>
            </div>
            <div className="flex gap-2">
              {preview ? (
                <button className={btn.ghost} type="button" onClick={() => window.close()}>
                  Close preview
                </button>
              ) : (
                <>
                  <Link className={btn.ghost} href="/feedback">
                    All my feedback
                  </Link>
                  <Link className={btn.primary} href="/student">
                    Back to assignments
                  </Link>
                </>
              )}
            </div>
          </div>
          <FeedbackReport fb={feedback} transcript={transcript} />
        </div>
      </div>
    );

  if (phase === "lobby" || phase === "starting")
    return (
      <Dark>
        <div className="m-auto w-full max-w-xl px-4 py-12">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
            {preview && <p className="mb-3 inline-block rounded-full bg-amber-300/20 px-3 py-1 text-xs text-amber-200">Faculty preview · not graded for a student</p>}
            <p className="text-sm uppercase tracking-wider text-teal-300">Your next patient</p>
            <h1 className="mt-1 text-3xl font-bold">{assignment?.patient_name ?? (preview ? "Preview encounter" : "…")}</h1>
            <p className="mt-1 text-slate-300">{assignment ? assignment.level_label : preview ? "Choose the year level to preview" : ""}</p>
            {assignment?.instructions && <p className="mt-4 text-slate-200">{assignment.instructions}</p>}
            {preview && (
              <div className="mt-4 flex gap-2">
                {["M1", "M2", "M3", "M4"].map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setPreviewLevel(l)}
                    className={"rounded-full px-4 py-1.5 text-sm " + (l === previewLevel ? "bg-teal-500 text-white" : "bg-white/10 text-slate-200 hover:bg-white/20")}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              <li>🎙️ Hold the talk button or the space bar while you speak, then let go.</li>
              <li>👂 The patient answers out loud. There are no captions.</li>
              <li>📋 The chart only shows what you find out by asking.</li>
              <li>🔒 Your camera is a mirror for you. Nothing is recorded; only the words are saved for feedback.</li>
            </ul>
            {!ptt.supported && (
              <p className="mt-4 rounded-lg bg-amber-300/15 px-3 py-2 text-sm text-amber-200">
                This browser can&apos;t turn speech into text. Use Chrome or Edge for the voice encounter, or continue and type.
              </p>
            )}
            {error && <p className="mt-4 rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-200">{error}</p>}
            <button
              type="button"
              onClick={start}
              disabled={phase === "starting" || (!!assignmentId && !assignment)}
              className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-full bg-teal-500 text-base font-semibold text-white hover:bg-teal-400 disabled:opacity-50"
            >
              {phase === "starting" ? "Entering the room…" : "Enter the exam room"}
            </button>
          </div>
        </div>
      </Dark>
    );

  // live or grading
  const avatarState: AvatarState = ptt.listening
    ? "listening"
    : sending || player.status === "loading"
      ? "thinking"
      : player.status === "speaking"
        ? "speaking"
        : "idle";

  const status = ptt.listening
    ? "Listening… let go when you're done"
    : sending
      ? "Patient is thinking…"
      : player.status === "loading"
        ? "…"
        : player.status === "speaking"
          ? "Patient is speaking · press to interrupt"
          : turns === 0
            ? "Introduce yourself to begin"
            : "Your turn";

  return (
    <Dark>
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <span className="font-semibold">{enc?.patient.name}</span>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-slate-300">{enc?.level_label}</span>
        {preview && <span className="rounded-full bg-amber-300/20 px-2.5 py-0.5 text-xs text-amber-200">Preview</span>}
        <span className="font-mono text-sm tabular-nums text-slate-300">{fmt(elapsed)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setChartOpen(true);
              setUnseen(0);
            }}
            className="relative inline-flex h-10 items-center rounded-full border border-white/20 px-4 text-sm hover:bg-white/10"
          >
            📋 Chart
            {unseen > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-400 px-1 text-xs font-bold text-slate-900">
                {unseen}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={end}
            disabled={phase === "grading"}
            className="inline-flex h-10 items-center rounded-full bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
          >
            {phase === "grading" ? "Grading…" : "End encounter"}
          </button>
        </div>
      </header>

      {phase === "grading" && (
        <div className="flex items-center justify-center gap-3 bg-teal-900/60 px-4 py-2 text-sm text-teal-100">
          {error ? (
            <>
              <span className="text-rose-200">{error}</span>
              <button type="button" className="underline" onClick={end}>
                Retry grading
              </button>
            </>
          ) : (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-200 border-t-transparent" />
              Grading your encounter against the rubric… this takes about half a minute.
            </>
          )}
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-2">
        {/* patient */}
        <section className="relative flex min-h-[340px] flex-col items-center justify-center rounded-3xl bg-gradient-to-b from-[#12304f] to-[#0e2742] p-6 ring-1 ring-white/10">
          <PatientAvatar
            name={enc?.patient.name ?? ""}
            portraitUrl={fileUrl(enc?.patient.portrait)}
            state={avatarState}
            levelRef={player.levelRef}
            size={260}
          />
          {player.provider === "browser" && turns > 0 && (
            <span className="absolute bottom-3 right-4 text-[11px] text-slate-400">browser voice</span>
          )}
        </section>

        {/* student camera */}
        <section className="relative min-h-[340px] overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
          {camOn && !camError ? (
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="flex h-full min-h-[340px] items-center justify-center text-sm text-slate-400">{camError ?? "Camera off"}</div>
          )}
          <span className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs">You</span>
          {ptt.listening && (
            <span className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Mic on
            </span>
          )}
          <button
            type="button"
            onClick={() => setCamOn((c) => !c)}
            className="absolute bottom-4 left-4 rounded-full bg-black/50 px-3 py-1 text-xs hover:bg-black/70"
          >
            {camOn ? "Turn camera off" : "Turn camera on"}
          </button>
        </section>
      </main>

      {/* controls */}
      <footer className="flex flex-col items-center gap-3 px-4 pb-6">
        {error && phase === "live" && (
          <p className="flex items-center gap-3 rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-200">
            {error}
            {lastFailed && (
              <button type="button" className="underline" onClick={() => send(lastFailed)}>
                Try again
              </button>
            )}
          </p>
        )}
        {ptt.error && <p className="text-sm text-amber-200">{ptt.error}</p>}

        {ptt.supported && (
          <button
            type="button"
            aria-label="Hold to talk"
            disabled={phase !== "live" || sending}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pressTalk();
            }}
            onPointerUp={releaseTalk}
            onPointerCancel={releaseTalk}
            onContextMenu={(e) => e.preventDefault()}
            className={
              "flex h-20 w-20 select-none items-center justify-center rounded-full text-3xl shadow-lg transition-all disabled:opacity-40 " +
              (ptt.listening ? "scale-110 bg-emerald-500 ring-8 ring-emerald-500/30" : "bg-teal-500 hover:bg-teal-400")
            }
            style={{ touchAction: "none" }}
          >
            🎙️
          </button>
        )}
        <p className="h-5 text-sm text-slate-300">{status}</p>
        {ptt.supported && <p className="text-xs text-slate-500">Hold the button or the space bar to talk</p>}

        {typeMode ? (
          <form
            className="flex w-full max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim() || sending) return;
              player.unlock();
              player.stop();
              send(typed);
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type what you would say…"
              className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
            <button type="submit" disabled={sending} className="rounded-full bg-white/15 px-4 text-sm hover:bg-white/25 disabled:opacity-40">
              Say it
            </button>
          </form>
        ) : (
          <button type="button" className="text-xs text-slate-500 underline hover:text-slate-300" onClick={() => setTypeMode(true)}>
            Mic not working? Type instead
          </button>
        )}
      </footer>

      <ChartDrawer open={chartOpen} onClose={() => setChartOpen(false)} chart={chart} />
      {/* keeps the API host visible in dev tools for teammates debugging the setup */}
      <span hidden data-api={API_BASE} />
      {trust !== undefined && <span hidden data-trust={trust} />}
    </Dark>
  );
}

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The chart: a slide-out panel, closed by default. It only ever contains what
// the student has uncovered (the backend's chart_view).
// ---------------------------------------------------------------------------
function ChartDrawer({ open, onClose, chart }: { open: boolean; onClose: () => void; chart: ChartView | null }) {
  const groups = Object.entries(chart?.facts_by_category ?? {});
  const arts = (chart?.artifacts ?? []).filter((a) => SHOW_AT_START_ITEMS || a.release.trigger !== "at_start");
  const empty = groups.length === 0 && arts.length === 0;

  return (
    <div className={"fixed inset-0 z-40 " + (open ? "" : "pointer-events-none")} aria-hidden={!open}>
      <div className={"absolute inset-0 bg-black/40 transition-opacity " + (open ? "opacity-100" : "opacity-0")} onClick={onClose} />
      <aside
        className={
          "absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white text-slate-900 shadow-2xl transition-transform duration-300 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Chart</h2>
            <p className="text-xs text-slate-500">Only what you&apos;ve uncovered so far</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm hover:bg-slate-100">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {empty ? (
            <div className="mt-16 text-center text-sm text-slate-400">
              <p className="text-3xl">🔒</p>
              <p className="mt-2">Nothing yet. Ask the patient questions, or ask to see their labs or records.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(([cat, facts]) => (
                <div key={cat}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{CATEGORY_LABEL[cat] ?? cat}</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {facts.map((f) => (
                      <li key={f.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {arts.map((a) => (
                <ArtifactView key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ArtifactView({ a }: { a: Artifact }) {
  const file = a.file_path ? fileUrl(`uploads/${a.file_path.split("/").pop()}`) : null;
  const isImage = !!a.file_path && /\.(png|jpe?g|webp|gif)$/i.test(a.file_path);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-900">{a.title}</p>
      {a.items.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {a.items.map((i, k) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="py-1 pr-2 text-slate-500">{i.label}</td>
                <td className="py-1 text-slate-900">
                  {i.value}
                  {i.flag && <span className="ml-1 rounded bg-rose-100 px-1 text-xs text-rose-700">{i.flag}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {a.text && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{a.text}</p>}
      {file &&
        (isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file} alt={a.title} className="mt-2 w-full rounded-lg border border-slate-200" />
        ) : (
          <a href={file} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-teal-700 underline">
            Open file
          </a>
        ))}
    </div>
  );
}
