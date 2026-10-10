// This directive marks the file as a Client Component. We need it because this
// page uses React state, event handlers (clicks, typing), timers, and effects —
// all of which run in the browser.
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import NavBar from "../components/NavBar";
import Footer from "../components/Footer";
import { type ChartTabId, type Patient } from "./demoPatient";
import { getPatientResponse } from "./chatEngine";
import { resolvePortraitSrc } from "./patientPortraits";
import { getPatientById } from "./patientRegistry";
import {
  type EncounterAttempt,
  type FeedbackReport,
  type FindingSnapshot,
} from "./feedback/feedbackTypes";
import { buildFeedbackReport } from "./feedback/feedbackEngine";
import { newAttemptId, saveAttempt } from "./feedback/attemptStorage";
import FeedbackReportView from "./feedback/FeedbackReport";
import {
  isValidNetId,
  normalizeNetId,
  setActiveNetId,
  useActiveNetId,
} from "./netId";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types used only by the UI
// ---------------------------------------------------------------------------

// One bubble in the chat transcript. `sender` tells us how to style it.
type ChatMessage = {
  id: number;
  sender: "student" | "patient";
  text: string;
};

// The encounter can be in one of three phases. This drives which buttons and
// panels are enabled.
type EncounterStatus = "idle" | "active" | "ended";

// ---------------------------------------------------------------------------
// Small helper: format a number of seconds as mm:ss for the timer.
// ---------------------------------------------------------------------------
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, "0");
  return `${minutes}:${paddedSeconds}`;
}

// ---------------------------------------------------------------------------
// Default export: resolve which patient to load from the URL, then render.
// ---------------------------------------------------------------------------
//
// `useSearchParams` needs a <Suspense> boundary in the App Router, so the
// default export provides one and the actual URL reading happens inside
// <EncounterRouter />.
export default function EncounterPage() {
  return (
    <Suspense fallback={<EncounterLoading />}>
      <EncounterRouter />
    </Suspense>
  );
}

// Reads `?patientId=...` from the URL and decides what to show:
//   - no id       -> default demo patient (Jordan Avery)
//   - known id    -> that patient (demo, or one published by Patient Studio)
//   - unknown id  -> "Patient not found" (we never fall back to Jordan here,
//                    and we invent no medical details)
//
// Patients published by Studio live in localStorage, which only exists in the
// browser. So we resolve the patient AFTER mount in an effect. Until then we
// show the loading placeholder, which also avoids any SSR/hydration mismatch.
function EncounterRouter() {
  const searchParams = useSearchParams();
  const patientId = searchParams.get("patientId");

  // Only read patients once we're on the client, because published patients
  // live in localStorage (which doesn't exist during server rendering). This
  // flag flips to true after mount.
  const mounted = useClientMounted();

  // Resolve the patient during render (not in an effect). `getPatientById`
  // is cheap and pure given the current localStorage contents.
  const patient = useMemo(
    () => (mounted ? getPatientById(patientId) : null),
    [mounted, patientId],
  );

  // Before mount we can't know about published patients yet, so show loading
  // rather than a premature "not found". This also avoids hydration mismatch.
  if (!mounted) {
    return <EncounterLoading />;
  }

  if (!patient) {
    return <PatientNotFound patientId={patientId} />;
  }

  // `key` ensures a fresh encounter (chat, timer, revealed findings) if the
  // patient id changes while on the page.
  return <EncounterExperience key={patient.id} patient={patient} />;
}

// Returns false during SSR and the first client render, then true after mount.
// Used so browser-only lookups (localStorage) run only on the client.
function useClientMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

// Simple placeholder shown during the brief Suspense fallback.
function EncounterLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50 font-sans text-slate-900">
      <NavBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading encounter…
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Shown when the URL asks for a patient id we don't recognise.
function PatientNotFound({ patientId }: { patientId: string | null }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50 font-sans text-slate-900">
      <NavBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-3xl">
            🚫
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">
            Patient not found
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-600">
            We couldn&apos;t find a patient
            {patientId ? (
              <>
                {" "}with the id{" "}
                <span className="font-mono font-semibold text-slate-800">
                  {patientId}
                </span>
              </>
            ) : null}
            . Check the link, or start the default demo encounter instead.
          </p>
          <a
            href="/encounter"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-teal-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            Go to demo encounter
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// The interactive encounter UI for ONE patient. It receives the patient as a
// prop so it doesn't care where the data came from (registry, backend, etc.).
function EncounterExperience({ patient }: { patient: Patient }) {
  // --- State -----------------------------------------------------------------

  // The current phase of the encounter (idle / active / ended).
  const [status, setStatus] = useState<EncounterStatus>("idle");

  // The full chat transcript shown on the left.
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // What the student has typed but not yet sent.
  const [draft, setDraft] = useState("");

  // Whether the patient is "typing" (shows the typing indicator).
  const [isPatientTyping, setIsPatientTyping] = useState(false);

  // The set of chart finding IDs the student has unlocked so far.
  // Using a Set makes "is this revealed?" checks simple and fast.
  const [disclosedIds, setDisclosedIds] = useState<Set<string>>(new Set());

  // Which chart tab is currently open on the right.
  const [activeTab, setActiveTab] = useState<ChartTabId>("overview");

  // How many seconds the encounter has been running.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // The feedback report, generated when the student ends the encounter. Null
  // while the encounter is idle/active or after a restart.
  const [report, setReport] = useState<FeedbackReport | null>(null);

  // The student's demo NetID. We prefill from the stored active NetID (via the
  // external-store hook) and let the student override it by typing. `netIdDraft`
  // is null until the student edits; the effective value falls back to the
  // stored one. Demo identification only — not real auth.
  const storedNetId = useActiveNetId();
  const [netIdDraft, setNetIdDraft] = useState<string | null>(null);
  const netId = netIdDraft ?? storedNetId;
  const setNetId = (value: string) => setNetIdDraft(value);
  // Whether to show the NetID prompt (e.g. when Start was clicked without one).
  const [netIdError, setNetIdError] = useState<string | null>(null);

  // We give each message a unique, increasing id. A ref keeps the counter
  // without causing re-renders.
  const nextMessageId = useRef(0);

  // Reference to the bottom of the chat list so we can auto-scroll to it.
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Derived values --------------------------------------------------------

  // On the Overview tab we always include its (already-visible) findings.
  // For other tabs, a finding only counts as disclosed if its id is in our Set.
  // We also compute how many findings exist and how many are revealed, to show
  // a small progress hint.
  const totalFindings = useMemo(
    () =>
      patient.chart
        .filter((section) => section.id !== "overview")
        .reduce((count, section) => count + section.findings.length, 0),
    [patient],
  );

  const revealedCount = useMemo(() => {
    let count = 0;
    for (const section of patient.chart) {
      if (section.id === "overview") continue;
      for (const finding of section.findings) {
        if (disclosedIds.has(finding.id)) count += 1;
      }
    }
    return count;
  }, [patient, disclosedIds]);

  // --- Effects ---------------------------------------------------------------

  // Encounter timer: tick once per second while the encounter is active.
  useEffect(() => {
    if (status !== "active") return;

    const intervalId = setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);

    // Cleanup stops the timer when the encounter ends or the page unmounts.
    return () => clearInterval(intervalId);
  }, [status]);

  // Auto-scroll the chat to the newest message whenever messages change or the
  // typing indicator appears.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPatientTyping]);

  // --- Actions ---------------------------------------------------------------

  // Add a message to the transcript and return its id.
  function appendMessage(sender: ChatMessage["sender"], text: string) {
    const id = nextMessageId.current++;
    setMessages((previous) => [...previous, { id, sender, text }]);
  }

  // Start a fresh encounter: reset everything and show the patient's greeting.
  // Starting (or restarting) clears any previous on-screen report, but saved
  // attempts in localStorage are never deleted.
  function handleStart() {
    // Require a valid demo NetID before starting (demo identification, not
    // real authentication). If it's missing/invalid, show the prompt and stop.
    if (!isValidNetId(netId)) {
      setNetIdError(
        "Enter a demo NetID (letters and numbers, e.g. abc123) to begin.",
      );
      return;
    }
    // Persist the normalised NetID so it prefills next time and the student's
    // My Feedback page can filter to it.
    const normalized = normalizeNetId(netId);
    setNetId(normalized);
    setActiveNetId(normalized);
    setNetIdError(null);

    nextMessageId.current = 0;
    setMessages([]);
    setDraft("");
    setDisclosedIds(new Set());
    setActiveTab("overview");
    setElapsedSeconds(0);
    setIsPatientTyping(false);
    setReport(null);
    setStatus("active");

    // Greet after a short beat so it feels like the patient is "arriving".
    appendMessage("patient", patient.greeting);
  }

  // End the encounter: stop the timer, lock the input, then save a complete
  // attempt record and generate the feedback report (shown automatically).
  function handleEnd() {
    setStatus("ended");
    setIsPatientTyping(false);

    // Snapshot every finding with its section + whether it was visible from
    // the start, so the report can distinguish "discovered" from "missed".
    const findingsSnapshot: FindingSnapshot[] = [];
    for (const section of patient.chart) {
      for (const finding of section.findings) {
        findingsSnapshot.push({
          id: finding.id,
          label: finding.label,
          value: finding.value,
          section: section.id,
          startVisible: finding.disclosed === true,
        });
      }
    }

    const attempt: EncounterAttempt = {
      attemptId: newAttemptId(),
      netId: normalizeNetId(netId),
      patientId: patient.id,
      patientName: patient.name,
      endedAt: new Date().toISOString(),
      durationSeconds: elapsedSeconds,
      transcript: messages.map((m) => ({ sender: m.sender, text: m.text })),
      revealedFindingIds: Array.from(disclosedIds),
      findingsSnapshot,
      objectivesSnapshot: patient.objectives ?? [],
    };

    // Persist the attempt (append-only) and show its report immediately.
    saveAttempt(attempt);
    setReport(buildFeedbackReport(attempt));
  }

  // Send the student's current draft to the patient.
  function handleSend() {
    const trimmed = draft.trim();
    // Ignore empty messages, or input while the encounter isn't active.
    if (trimmed === "" || status !== "active") return;

    // Show the student's message immediately and clear the input box.
    appendMessage("student", trimmed);
    setDraft("");

    // Ask the rule-based engine what the patient should say. We pass the
    // conversation so far so vague follow-ups ("anything else?") can be
    // answered in context. `messages` is the transcript BEFORE this new
    // student line, which is exactly the history we want.
    const result = getPatientResponse(patient, trimmed, messages);

    // Reveal any chart findings this question unlocked (progressive disclosure).
    if (result.revealedFindingIds.length > 0) {
      setDisclosedIds((previous) => {
        const next = new Set(previous);
        for (const id of result.revealedFindingIds) next.add(id);
        return next;
      });
    }

    // Simulate the patient "thinking", then show the reply. This is just a UI
    // delay — there is no network or AI call.
    setIsPatientTyping(true);
    setTimeout(() => {
      setIsPatientTyping(false);
      appendMessage("patient", result.reply);
    }, 900);
  }

  // Send on Enter (but allow Shift+Enter for a newline).
  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  const isActive = status === "active";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50 font-sans text-slate-900">
      <NavBar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* Page header: title, synthetic-data badge, timer, and controls. */}
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                Student Encounter
              </h1>
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                Synthetic demo patient
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Practice your clinical interview. All data below is fake example
              data for training only.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Encounter timer */}
            <div className="flex flex-col items-end">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Elapsed
              </span>
              <span className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                {formatElapsed(elapsedSeconds)}
              </span>
            </div>

            {/* Demo NetID field. Editable before/after an encounter; locked
                while active. Demo identification only — not Rutgers auth. */}
            <div className="flex flex-col items-start">
              <label
                htmlFor="netid"
                className="text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Student NetID
              </label>
              {status === "active" ? (
                <span className="font-mono text-sm font-semibold text-slate-700">
                  {netId || "—"}
                </span>
              ) : (
                <input
                  id="netid"
                  value={netId}
                  onChange={(e) => {
                    setNetId(e.target.value);
                    if (netIdError) setNetIdError(null);
                  }}
                  placeholder="e.g. abc123"
                  autoComplete="off"
                  className="mt-0.5 w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                />
              )}
            </div>

            {/* Start / End buttons. Only one is enabled at a time. */}
            {status === "active" ? (
              <button
                type="button"
                onClick={handleEnd}
                className="inline-flex h-11 items-center justify-center rounded-full bg-rose-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
              >
                End Encounter
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                className="inline-flex h-11 items-center justify-center rounded-full bg-teal-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
              >
                {status === "ended" ? "Restart Encounter" : "Start Encounter"}
              </button>
            )}
          </div>
        </div>

        {/* NetID validation message + demo disclaimer. */}
        {netIdError && (
          <p className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {netIdError}
          </p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          NetID is for demo identification only — this is not verified Rutgers
          authentication.
        </p>

        {/* Feedback report: shown automatically after End Encounter. The
            split-screen stays below so the student can review the transcript
            and chart alongside their feedback. */}
        {report && (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                Your feedback
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleStart}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                >
                  Restart Encounter
                </button>
                <Link
                  href="/feedback"
                  className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                >
                  View My Feedback
                </Link>
              </div>
            </div>
            <FeedbackReportView report={report} />
          </div>
        )}

        {/* Split screen: chat on the left, medical chart on the right. */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ============================= LEFT ============================= */}
          <section className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Patient banner */}
            <div className="flex items-center gap-4 rounded-t-2xl bg-[#0f2a4a] p-5 text-white">
              <PatientAvatar name={patient.name} fallbackEmoji={patient.avatarEmoji} />
              <div>
                <h2 className="text-lg font-semibold">{patient.name}</h2>
                <p className="text-sm text-teal-200">
                  {patient.age} y/o · {patient.gender}
                </p>
                <p className="mt-0.5 text-sm text-slate-200">
                  Chief complaint: {patient.chiefComplaint}
                </p>
              </div>
            </div>

            {/* Chat transcript */}
            <div className="flex h-[26rem] flex-col gap-3 overflow-y-auto p-5">
              {messages.length === 0 && !isPatientTyping ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-400">
                  <span className="text-3xl">💬</span>
                  <p className="mt-2 max-w-xs">
                    {status === "idle"
                      ? "Press Start Encounter to meet your patient and begin the interview."
                      : "This encounter has ended. Press Restart Encounter to try again."}
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <ChatBubble key={message.id} message={message} />
                ))
              )}

              {/* Typing indicator: three animated dots. */}
              {isPatientTyping && <TypingIndicator />}

              {/* Invisible anchor we scroll to. */}
              <div ref={chatEndRef} />
            </div>

            {/* Input row */}
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={!isActive}
                  rows={1}
                  placeholder={
                    isActive
                      ? "Ask the patient a question…"
                      : "Start the encounter to ask questions"
                  }
                  className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-not-allowed disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!isActive || draft.trim() === ""}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Send
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Tip: ask about onset, radiation, past history, medications, or
                tests to uncover chart findings.
              </p>
            </div>
          </section>

          {/* ============================ RIGHT ============================ */}
          <section className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Chart header + disclosure progress */}
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <h2 className="text-lg font-semibold text-slate-900">
                Medical Chart
              </h2>
              <span className="text-xs font-medium text-slate-500">
                {revealedCount}/{totalFindings} findings revealed
              </span>
            </div>

            {/* Tab buttons */}
            <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2">
              {patient.chart.map((section) => {
                const selected = section.id === activeTab;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveTab(section.id)}
                    className={
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                      (selected
                        ? "bg-teal-600 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-teal-700")
                    }
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content: the findings for the active tab. */}
            <div className="flex-1 overflow-y-auto p-5">
              {patient.chart
                .filter((section) => section.id === activeTab)
                .map((section) => {
                  // A finding is visible if it started visible (Overview) or has
                  // been unlocked by the student's questions.
                  const visibleFindings = section.findings.filter(
                    (finding) => finding.disclosed || disclosedIds.has(finding.id),
                  );

                  if (visibleFindings.length === 0) {
                    return (
                      <div
                        key={section.id}
                        className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400"
                      >
                        <span className="text-2xl">🔒</span>
                        <p className="mt-2 max-w-xs">
                          Nothing here yet. Interview the patient about this
                          area to reveal findings.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <ul key={section.id} className="flex flex-col gap-3">
                      {visibleFindings.map((finding) => (
                        <li
                          key={finding.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                            {finding.label}
                          </p>
                          <p className="mt-1 text-sm text-slate-800">
                            {finding.value}
                          </p>
                        </li>
                      ))}
                    </ul>
                  );
                })}
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational components kept in the same file for simplicity.
// ---------------------------------------------------------------------------

// A circular patient portrait. It looks up an image by the patient's exact
// name; if there's no match (or the file fails to load) it shows a clean
// emoji avatar instead. This works for the demo patient today and for
// Patient-Studio patients later — just pass their name.
function PatientAvatar({
  name,
  fallbackEmoji,
}: {
  name: string;
  fallbackEmoji: string;
}) {
  const src = resolvePortraitSrc(name);

  // Track whether the image failed to load at runtime, so a broken/missing
  // file still falls back gracefully to the emoji.
  const [failed, setFailed] = useState(false);

  const showImage = src !== null && !failed;

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-3xl ring-2 ring-white/20">
      {showImage ? (
        // Plain <img> keeps things simple and avoids extra Next config for the
        // image optimizer. The portrait is cropped to a circle by the parent.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Portrait of ${name}`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{fallbackEmoji}</span>
      )}
    </div>
  );
}

// A single chat bubble, styled by who sent it.
function ChatBubble({ message }: { message: ChatMessage }) {
  const isStudent = message.sender === "student";
  return (
    <div className={isStudent ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed " +
          (isStudent
            ? "rounded-br-sm bg-teal-600 text-white"
            : "rounded-bl-sm bg-slate-100 text-slate-800")
        }
      >
        {message.text}
      </div>
    </div>
  );
}

// The "patient is typing" indicator: three dots that pulse in sequence.
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
      </div>
    </div>
  );
}
