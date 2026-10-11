"use client";

// ---------------------------------------------------------------------------
// The encounter room: a voice-only visit, laid out like a video call.
//
//   left tile  = the patient (portrait that glows while they speak)
//   right tile = the student's own camera (a live mirror: never recorded or sent)
//
// Hold the talk button (or the space bar), speak, let go. The browser turns the
// speech into text, the backend engine decides what the patient may say
// (grounded, disclosure-gated), and the reply is spoken in the patient's voice
// (ElevenLabs via the backend, else the browser voice). No captions, no script.
// The chart is a side panel that only holds what the student has uncovered.
// Only the transcript is saved, for feedback.
//
// URLs:  /encounter?assignment=<id>                    (student)
//        /encounter?patient=<id>&preview=1[&level=M3]  (faculty preview)
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ClipboardList, Keyboard, Loader2, Mic, PhoneOff, Video, VideoOff, X } from "lucide-react";
import AppShell, { Field, Logo, Spinner, Wordmark, btn, input } from "../components/AppShell";
import FeedbackReport from "../components/FeedbackReport";
import { bannerColor } from "../components/Banner";
import NetIdGate from "../components/NetIdGate";
import {
  api,
  fileUrl,
  type Artifact,
  type Assignment,
  type AssignmentBrief,
  type ChartView,
  type EncounterStart,
  type Feedback,
  type TranscriptTurn,
} from "@/lib/api";
import { FACULTY_ID, useActiveNetId } from "@/lib/identity";
import { PatientAvatar, usePushToTalk, useVoicePlayer, type AvatarState } from "@/lib/voice";

// The engine releases the referral summary "at start". Students find everything
// out by talking, so it stays out of their chart.
const SHOW_AT_START_ITEMS = false;

const CATEGORY_LABEL: Record<string, string> = {
  demographics: "About them",
  diagnosis: "Diagnoses",
  history: "History",
  symptom: "Symptoms",
  finding: "Findings",
  allergy: "Allergies",
  medication: "Medications",
  nutrition: "Diet and nutrition",
  lifestyle: "Lifestyle",
  psychosocial: "Feelings and stressors",
  social: "Home and social",
  other: "Other",
};

type Phase = "lobby" | "starting" | "live" | "grading" | "done";

export default function EncounterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <Spinner />
        </div>
      }
    >
      <Room />
    </Suspense>
  );
}

function Room() {
  const params = useSearchParams();
  const assignmentId = params.get("assignment");
  const patientId = params.get("patient");
  const preview = params.get("preview") === "1";
  const netId = useActiveNetId();

  const [phase, setPhase] = useState<Phase>("lobby");
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [brief, setBrief] = useState<AssignmentBrief | null>(null);
  const [askingDx, setAskingDx] = useState(false);
  const [previewLevel, setPreviewLevel] = useState(params.get("level") ?? "M2");
  const [enc, setEnc] = useState<EncounterStart | null>(null);
  const [chart, setChart] = useState<ChartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);
  const [chartOpen, setChartOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [typeMode, setTypeMode] = useState(false);
  const [typed, setTyped] = useState("");
  const [camOn, setCamOn] = useState(true);
  const [camLive, setCamLive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);

  const player = useVoicePlayer();
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const encRef = useRef<EncounterStart | null>(null);
  // Timing for the pacing feedback: when the patient last finished speaking, and the pending turn's timing.
  const patientDoneAt = useRef<number | null>(null);
  const pendingTiming = useRef<{ response_ms: number | null; interrupted: boolean } | null>(null);
  const markTurnStart = useCallback((speaking: boolean) => {
    const done = patientDoneAt.current;
    pendingTiming.current = { response_ms: !speaking && done ? Math.max(0, Date.now() - done) : null, interrupted: speaking };
  }, []);
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
    api.brief(assignmentId).then(setBrief).catch(() => {});
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
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // ---- camera: a live mirror in the lobby and the call, never recorded ----
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoEl.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  const camWanted = camOn && (phase === "lobby" || phase === "starting" || phase === "live");
  useEffect(() => {
    if (!camWanted) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (videoEl.current) videoEl.current.srcObject = s;
        setCamLive(true);
        setCamError(null);
      })
      .catch(() => setCamError("Camera unavailable. You can still talk to the patient."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoEl.current) videoEl.current.srcObject = null;
      setCamLive(false);
    };
  }, [camWanted]);

  // ---- one turn -----------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      const e = encRef.current;
      const msg = text.trim();
      if (!e || !msg) return;
      setSending(true);
      setError(null);
      setLastFailed(null);
      const timing = pendingTiming.current ?? { response_ms: null, interrupted: false };
      pendingTiming.current = null;
      try {
        const r = await api.send(e.encounter_id, msg, timing);
        setTurns((n) => n + 1);
        setChart(r.chart);
        const fresh = r.new_facts.length + r.new_artifacts.filter((a) => SHOW_AT_START_ITEMS || a.release.trigger !== "at_start").length;
        if (fresh) setUnseen((n) => n + fresh);
        setSending(false);
        await player.speak({
          text: r.reply,
          patientId: e.patient.id,
          persona: { name: e.patient.name, age: e.patient.age, sex: e.patient.sex },
          trust: r.trust,
          deflected: r.deflected,
        });
        patientDoneAt.current = Date.now();
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
    markTurnStart(player.status !== "idle");
    player.unlock();
    player.stop(); // barge-in: the student interrupts the patient
    ptt.start();
  }, [player, ptt, sending, markTurnStart]);

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
    // Ask for the microphone once now, so the first push-to-talk works. The track
    // is stopped right away: we never capture audio ourselves.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* the talk button shows its own error */
    }
    try {
      const r = assignmentId
        ? await api.startEncounter({ assignment_id: assignmentId, student_id: netId })
        : await api.startEncounter({ patient_id: patientId ?? "", preview, level: previewLevel, student_id: FACULTY_ID });
      encRef.current = r;
      setEnc(r);
      setChart(r.chart);
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
      setError("Say something to the patient before you end the visit.");
      return;
    }
    if (enc.asks_diagnosis) {
      player.stop();
      setAskingDx(true);
      return;
    }
    if (!window.confirm("End the visit and get your feedback?")) return;
    await finish();
  };

  const finish = async (answer?: { diagnosis: string; differential: string[]; reasoning: string }) => {
    if (!enc) return;
    setAskingDx(false);
    player.stop();
    ptt.stop();
    setPhase("grading");
    setError(null);
    try {
      const fb = await api.end(enc.encounter_id, answer);
      setFeedback(fb);
      api
        .encounter(enc.encounter_id)
        .then((d) => setTranscript(d.transcript))
        .catch(() => {});
      setPhase("done");
    } catch (e) {
      setError(`${(e as Error).message}`);
    }
  };

  // ---- render ---------------------------------------------------------------
  if (assignmentId && !netId)
    return (
      <AppShell crumb="Encounter">
        <div className="mx-auto max-w-md pt-10">
          <NetIdGate />
        </div>
      </AppShell>
    );

  if (!assignmentId && !patientId)
    return (
      <AppShell crumb="Encounter">
        <p className="text-ink-2">
          No patient selected.{" "}
          <Link className="text-primary underline" href="/student">
            Go to your assignments
          </Link>
        </p>
      </AppShell>
    );

  if (phase === "done" && feedback)
    return (
      <AppShell
        crumb="Feedback"
        title={`Feedback: ${feedback.patient_name}`}
        actions={
          preview ? (
            <button className={btn.ghost} type="button" onClick={() => window.close()}>
              Close preview
            </button>
          ) : (
            <>
              <Link className={btn.text} href="/feedback">
                All feedback
              </Link>
              <Link className={btn.primary} href="/student">
                Back to assignments
              </Link>
            </>
          )
        }
      >
        <div className="mx-auto max-w-[1000px]">
          <p className="mb-5 text-sm text-ink-2">Visit length {fmt(elapsed)}</p>
          <FeedbackReport fb={feedback} transcript={transcript} />
        </div>
      </AppShell>
    );

  const patientName = enc?.patient.name ?? assignment?.patient_name ?? "";

  // ---------------- lobby: "ready to join?" ----------------
  if (phase === "lobby" || phase === "starting")
    return (
      <div className="flex min-h-screen flex-col bg-white text-ink">
        <header className="flex h-16 items-center gap-2.5 px-5">
          <Logo />
          <Wordmark />
        </header>
        <div className="mx-auto grid w-full max-w-[1100px] flex-1 grid-cols-1 items-center gap-10 px-5 pb-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-[#202124]">
            {camOn && !camError ? (
              <video ref={attachVideo} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[15px] text-white/80">{camError ?? "Camera is off"}</div>
            )}
            {camOn && !camLive && !camError && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Starting camera</div>}
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <RoundButton label={camOn ? "Turn off camera" : "Turn on camera"} onClick={() => setCamOn((c) => !c)} tone={camOn ? "glass" : "red"}>
                {camOn ? <Video size={22} /> : <VideoOff size={22} />}
              </RoundButton>
            </div>
          </div>

          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            {preview && <p className="mb-3 rounded-md bg-[#fef7e0] px-2.5 py-1 text-xs font-medium text-[#7a4f01]">Faculty preview, not graded for a student</p>}
            <h1 className="text-[28px] leading-9 text-ink">{patientName ? `Ready to see ${patientName}?` : preview ? "Ready to try this patient?" : "Loading"}</h1>
            <p className="mt-2 text-[15px] text-ink-2">{assignment ? assignment.level_label : preview ? "Pick the year level to try it at" : ""}</p>
            {assignment?.instructions && <p className="mt-3 max-w-md text-[15px] leading-6 text-ink">{assignment.instructions}</p>}
            {preview && (
              <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Year level">
                {["M1", "M2", "M3", "M4"].map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={l === previewLevel}
                    onClick={() => setPreviewLevel(l)}
                    className={"h-9 rounded-lg border px-4 text-sm " + (l === previewLevel ? "border-primary bg-[#f0f4fc] font-medium text-primary" : "border-line text-ink-2 hover:bg-black/[0.03]")}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <ul className="mt-6 flex max-w-md flex-col gap-2.5 text-left text-sm leading-5 text-ink-2">
              <li className="flex gap-3">
                <Mic size={18} className="mt-0.5 shrink-0 text-primary" />
                Hold the talk button or the space bar while you speak, then let go. The patient answers out loud.
              </li>
              <li className="flex gap-3">
                <ClipboardList size={18} className="mt-0.5 shrink-0 text-primary" />
                There are no captions. The chart fills in only with what you find out by asking.
              </li>
              <li className="flex gap-3">
                <Video size={18} className="mt-0.5 shrink-0 text-primary" />
                Your camera is a mirror for you. Nothing is recorded; only the words are saved for feedback.
              </li>
            </ul>
            {brief && <GradingPreview brief={brief} />}
            {!ptt.supported && (
              <p className="mt-4 max-w-md rounded-lg bg-[#fef7e0] px-3 py-2 text-sm text-[#7a4f01]">
                This browser can&apos;t turn speech into text. Use Chrome or Edge for a voice visit, or join and type.
              </p>
            )}
            {error && <p className="mt-4 max-w-md rounded-lg bg-[#fce8e6] px-3 py-2 text-sm text-danger">{error}</p>}
            <button
              type="button"
              onClick={start}
              disabled={phase === "starting" || (!!assignmentId && !assignment)}
              className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-8 text-[15px] font-medium text-white hover:bg-[#0842a0] disabled:bg-black/10 disabled:text-black/40"
            >
              {phase === "starting" && <Loader2 size={18} className="animate-spin" />}
              {phase === "starting" ? "Joining" : "Join now"}
            </button>
          </div>
        </div>
      </div>
    );

  // ---------------- the call ----------------
  const avatarState: AvatarState = ptt.listening
    ? "idle"
    : sending || player.status === "loading"
      ? "thinking"
      : player.status === "speaking"
        ? "speaking"
        : "idle";
  const patientStatus = sending || player.status === "loading" ? "Thinking" : player.status === "speaking" ? "Speaking" : "";

  return (
    <div className="flex h-screen flex-col bg-[#202124] text-white">
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          {/* patient tile */}
          <section className="meet-tile relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-xl bg-[#3c4043]">
            <PatientAvatar name={patientName} portraitUrl={fileUrl(enc?.patient.portrait)} state={avatarState} levelRef={player.levelRef} size={200} color={enc ? bannerColor(enc.patient.id) : undefined} />
            <TileLabel name={patientName} status={patientStatus} />
            {player.provider === "browser" && turns > 0 && <span className="absolute right-3 top-3 text-[11px] text-white/50">Browser voice</span>}
          </section>

          {/* student tile */}
          <section
            className={
              "relative min-h-[220px] overflow-hidden rounded-xl bg-[#3c4043] transition-shadow " +
              (ptt.listening ? "shadow-[inset_0_0_0_3px_#8ab4f8]" : "")
            }
          >
            {camOn && !camError ? (
              <video ref={attachVideo} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="flex h-28 w-28 items-center justify-center rounded-full bg-[#5f6368] text-4xl">
                  {(netId[0] ?? "Y").toUpperCase()}
                </span>
              </div>
            )}
            <TileLabel name="You" status={ptt.listening ? "Talking" : ""} />
          </section>
        </main>

        {chartOpen && <ChartPanel chart={chart} onClose={() => setChartOpen(false)} />}
      </div>

      {/* messages above the bar */}
      <div className="flex min-h-10 flex-col items-center gap-2 px-4">
        {error && phase === "live" && (
          <p className="flex items-center gap-3 rounded-lg bg-[#fce8e6] px-4 py-2 text-sm text-danger">
            {error}
            {lastFailed && (
              <button type="button" className="font-medium underline" onClick={() => send(lastFailed)}>
                Try again
              </button>
            )}
          </p>
        )}
        {ptt.error && <p className="rounded-lg bg-[#3c4043] px-4 py-2 text-sm text-white/90">{ptt.error}</p>}
        {!error && !ptt.error && turns === 0 && !ptt.listening && !sending && (
          <p className="rounded-lg bg-[#3c4043] px-4 py-2 text-sm text-white/90">Introduce yourself to begin. Hold the space bar to talk.</p>
        )}
        {typeMode && (
          <form
            className="flex w-full max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim() || sending) return;
              markTurnStart(player.status !== "idle");
              player.unlock();
              player.stop();
              send(typed);
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type what you would say"
              aria-label="Type what you would say"
              className="h-11 flex-1 rounded-full border-0 bg-[#3c4043] px-5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
            />
            <button type="submit" disabled={sending} className="h-11 rounded-full bg-[#8ab4f8] px-5 text-sm font-medium text-[#062e6f] disabled:opacity-40">
              Say it
            </button>
          </form>
        )}
      </div>

      {/* control bar */}
      <footer className="grid h-20 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6">
        <div className="hidden min-w-0 items-center gap-3 truncate text-[15px] text-white/90 sm:flex">
          <span className="tabular-nums">{fmt(elapsed)}</span>
          <span className="h-4 w-px bg-white/30" />
          <span className="truncate">{enc?.level_label}</span>
          {preview && <span className="rounded bg-white/10 px-2 py-0.5 text-xs">Preview</span>}
        </div>

        <div className="col-start-2 flex items-center gap-3">
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
              style={{ touchAction: "none" }}
              className={
                "flex h-12 select-none items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors disabled:opacity-40 " +
                (ptt.listening ? "bg-[#8ab4f8] text-[#062e6f]" : "bg-[#3c4043] text-white hover:bg-[#4a4e51]")
              }
            >
              {sending ? <Loader2 size={20} className="animate-spin" /> : <Mic size={20} />}
              <span className="hidden sm:inline">{ptt.listening ? "Listening" : sending ? "Patient is thinking" : "Hold to talk"}</span>
            </button>
          )}
          <RoundButton label={camOn ? "Turn off camera" : "Turn on camera"} onClick={() => setCamOn((c) => !c)} tone={camOn ? "dark" : "red"}>
            {camOn ? <Video size={22} /> : <VideoOff size={22} />}
          </RoundButton>
          <RoundButton label={typeMode ? "Hide typing" : "Type instead"} onClick={() => setTypeMode((t) => !t)} tone={typeMode ? "light" : "dark"}>
            <Keyboard size={22} />
          </RoundButton>
          <span className="relative">
            <RoundButton
              label="Chart"
              onClick={() => {
                setChartOpen((o) => !o);
                setUnseen(0);
              }}
              tone={chartOpen ? "light" : "dark"}
            >
              <ClipboardList size={22} />
            </RoundButton>
            {unseen > 0 && !chartOpen && (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#8ab4f8] px-1 text-[11px] font-medium text-[#062e6f]">
                {unseen}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={end}
            disabled={phase === "grading"}
            aria-label="End the visit"
            className="flex h-12 items-center gap-2 rounded-full bg-[#ea4335] px-6 text-sm font-medium text-white hover:bg-[#d93025] disabled:opacity-60"
          >
            <PhoneOff size={20} />
            <span className="hidden sm:inline">End visit</span>
          </button>
        </div>
        <div />
      </footer>

      {askingDx && <DiagnosisDialog onCancel={() => setAskingDx(false)} onSubmit={finish} />}

      {phase === "grading" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-7 text-ink">
            {error ? (
              <>
                <p className="text-xl">Grading didn&apos;t finish</p>
                <p className="mt-2 text-sm leading-5 text-ink-2">{error}</p>
                <div className="mt-6 flex justify-end">
                  <button type="button" className={btn.primary} onClick={() => finish()}>
                    Try again
                  </button>
                </div>
              </>
            ) : (
              <>
                <Loader2 size={28} className="animate-spin text-primary" />
                <p className="mt-4 text-xl">Grading your visit</p>
                <p className="mt-2 text-sm leading-5 text-ink-2">Scoring against the encounter rubric and your learning objectives. This takes about half a minute.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function TileLabel({ name, status }: { name: string; status: string }) {
  return (
    <span className="absolute bottom-3 left-3 flex items-center gap-2 text-sm text-white drop-shadow">
      {name}
      {status && <span className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-white/90">{status}</span>}
    </span>
  );
}

function RoundButton({
  children,
  label,
  onClick,
  tone = "dark",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "dark" | "light" | "red" | "glass";
}) {
  const tones = {
    dark: "bg-[#3c4043] text-white hover:bg-[#4a4e51]",
    light: "bg-[#8ab4f8] text-[#062e6f]",
    red: "bg-[#ea4335] text-white hover:bg-[#d93025]",
    glass: "border border-white/60 bg-black/20 text-white hover:bg-black/30",
  };
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${tones[tone]}`}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The chart: a side panel in the call. It only ever contains what the student
// has uncovered (the backend's chart_view).
// ---------------------------------------------------------------------------
function ChartPanel({ chart, onClose }: { chart: ChartView | null; onClose: () => void }) {
  const groups = Object.entries(chart?.facts_by_category ?? {});
  const arts = (chart?.artifacts ?? []).filter((a) => SHOW_AT_START_ITEMS || a.release.trigger !== "at_start");
  const empty = groups.length === 0 && arts.length === 0;

  return (
    <aside className="fixed inset-x-3 bottom-24 top-3 z-40 flex flex-col overflow-hidden rounded-xl bg-white text-ink md:static md:w-[360px] md:shrink-0" aria-label="Chart">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="text-lg">Chart</h2>
        <button type="button" aria-label="Close chart" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]">
          <X size={20} />
        </button>
      </div>
      <p className="px-5 text-[13px] text-ink-2">Only what you&apos;ve found out so far.</p>
      <div className="mt-3 flex-1 overflow-y-auto px-5 pb-5">
        {empty ? (
          <p className="mt-10 text-center text-sm leading-5 text-ink-2">Nothing yet. Ask the patient about their health, or ask to see their labs or records.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map(([cat, facts]) => (
              <div key={cat}>
                <p className="text-[13px] font-medium text-primary">{CATEGORY_LABEL[cat] ?? cat}</p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {facts.map((f) => (
                    <li key={f.id} className="rounded-lg bg-shell px-3 py-2 text-sm leading-5 text-ink">
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
  );
}

function ArtifactView({ a }: { a: Artifact }) {
  const file = a.file_path ? fileUrl(`uploads/${a.file_path.split("/").pop()}`) : null;
  const isImage = !!a.file_path && /\.(png|jpe?g|webp|gif)$/i.test(a.file_path);
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-ink">{a.title}</p>
      {a.items.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {a.items.map((i, k) => (
              <tr key={k} className="border-t border-line">
                <td className="py-1.5 pr-2 text-ink-2">{i.label}</td>
                <td className="py-1.5 text-right text-ink">
                  {i.value}
                  {i.flag && <span className="ml-1.5 text-xs font-medium text-danger">{i.flag}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {a.text && <p className="mt-2 whitespace-pre-line text-sm leading-5 text-ink-2">{a.text}</p>}
      {file &&
        (isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file} alt={a.title} className="mt-2 w-full rounded-md border border-line" />
        ) : (
          <a href={file} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-primary underline">
            Open file
          </a>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby: how the visit is graded (domains, year-level expectations, learning goal titles).
// The expected findings under each goal are never shown: they would give the case away.
// ---------------------------------------------------------------------------
function GradingPreview({ brief }: { brief: AssignmentBrief }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 w-full max-w-md rounded-xl border border-line text-left">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <ClipboardList size={18} className="shrink-0 text-primary" />
        <span className="flex-1 text-[15px] text-ink">How you&apos;ll be graded</span>
        <ChevronRight size={18} className={"text-ink-3 transition-transform " + (open ? "rotate-90" : "")} />
      </button>
      {open && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-line px-4 pb-4 pt-3 text-sm leading-5 text-ink-2">
          <p>{brief.expectations}</p>
          {brief.asks_diagnosis && (
            <p className="mt-3 rounded-lg bg-[#e8f0fe] px-3 py-2 text-on-primary-soft">When you end the visit, you&apos;ll be asked for your working diagnosis.</p>
          )}
          {brief.learning_goals.length > 0 && (
            <>
              <p className="mt-4 font-medium text-ink">Learning goals</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {brief.learning_goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-4 font-medium text-ink">Rubric, scored 1 to 4</p>
          <ul className="mt-1 flex flex-col gap-2">
            {brief.domains
              .filter((d) => d.mode !== "na")
              .map((d) => (
                <li key={d.key}>
                  <span className="text-ink">{d.name}</span>
                  {d.mode === "lenient" && <span className="text-xs text-ink-3"> (graded for your year)</span>}
                  {d.what_good_looks_like && <span className="block text-[13px] text-ink-2">A 4 looks like: {d.what_good_looks_like}</span>}
                </li>
              ))}
          </ul>
          {brief.checklists.map((c) => (
            <div key={c.id} className="mt-4">
              <p className="font-medium text-ink">{c.title}</p>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
                {c.sections.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// M3/M4: working diagnosis before grading.
// ---------------------------------------------------------------------------
function DiagnosisDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (a: { diagnosis: string; differential: string[]; reasoning: string }) => void;
}) {
  const [dx, setDx] = useState("");
  const [diff, setDiff] = useState(["", "", ""]);
  const [why, setWhy] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Your working diagnosis">
      <div className="w-full max-w-lg rounded-[28px] bg-white p-7 text-ink">
        <p className="text-2xl">Your working diagnosis</p>
        <p className="mt-2 text-sm leading-5 text-ink-2">Before you see your feedback: what do you think is going on? Your answer is compared with the case&apos;s diagnosis.</p>
        <div className="mt-5 flex flex-col gap-4">
          <Field label="Most likely diagnosis">
            <input className={input} value={dx} onChange={(e) => setDx(e.target.value)} placeholder="e.g. poorly controlled type 2 diabetes" autoFocus />
          </Field>
          <div>
            <p className="text-[13px] font-medium text-ink-2">Differential (optional)</p>
            <div className="mt-1.5 flex flex-col gap-2">
              {diff.map((d, i) => (
                <input key={i} className={input} value={d} onChange={(e) => setDiff((x) => x.map((y, j) => (j === i ? e.target.value : y)))} placeholder={`Alternative ${i + 1}`} />
              ))}
            </div>
          </div>
          <Field label="What in the history pointed you there? (optional)">
            <textarea className={input} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={btn.text} onClick={onCancel}>
            Back to the visit
          </button>
          <button type="button" className={btn.primary} onClick={() => onSubmit({ diagnosis: dx, differential: diff.filter((x) => x.trim()), reasoning: why })}>
            {dx.trim() ? "End visit and see feedback" : "Skip and end visit"}
          </button>
        </div>
      </div>
    </div>
  );
}
