"use client";

// ---------------------------------------------------------------------------
// My Feedback — students review their previous encounter attempts
// ---------------------------------------------------------------------------
// Reads saved attempts from localStorage (the same records a future Professor
// Results dashboard can read) and renders a feedback report for the selected
// one. Reuses Twinverse's teal/navy card styling.
// ---------------------------------------------------------------------------

import { useMemo, useSyncExternalStore, useState } from "react";
import Link from "next/link";
import {
  ATTEMPTS_STORAGE_KEY,
  loadAttempts,
} from "../encounter/feedback/attemptStorage";
import { buildFeedbackReport } from "../encounter/feedback/feedbackEngine";
import type { EncounterAttempt } from "../encounter/feedback/feedbackTypes";
import FeedbackReportView from "../encounter/feedback/FeedbackReport";
import { useActiveNetId } from "../encounter/netId";

// --- Subscribe to the attempts store so the list stays fresh ----------------
// We cache the client snapshot because useSyncExternalStore requires
// getSnapshot to return the SAME reference until the data actually changes
// (otherwise it re-renders forever). The cache is cleared when a storage event
// fires, so the next read rebuilds it.
let cachedSnapshot: EncounterAttempt[] | null = null;

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ATTEMPTS_STORAGE_KEY) {
      cachedSnapshot = null; // invalidate so getClientSnapshot rebuilds
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
}

function getClientSnapshot(): EncounterAttempt[] {
  if (cachedSnapshot === null) {
    cachedSnapshot = loadAttempts();
  }
  return cachedSnapshot;
}

// Attempts only exist in the browser; the server snapshot is a stable empty
// list (same reference every call).
const EMPTY: EncounterAttempt[] = [];
function getServerSnapshot() {
  return EMPTY;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MyFeedbackPage() {
  // Read attempts via useSyncExternalStore so SSR/hydration is clean.
  const attempts = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  // Which attempt is expanded (null = none).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The active demo NetID (from the external-store hook). We default to showing
  // only this student's attempts, with a toggle to view everyone's on device.
  const activeNetId = useActiveNetId();
  const [showAll, setShowAll] = useState(false);

  // Filter to the active student's attempts unless "show all" is on, or no
  // NetID is set yet (then show everything so nothing is hidden).
  const visibleAttempts = useMemo(() => {
    if (showAll || activeNetId === "") return attempts;
    return attempts.filter((a) => a.netId === activeNetId);
  }, [attempts, showAll, activeNetId]);

  const selected =
    visibleAttempts.find((a) => a.attemptId === selectedId) ?? null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50 font-sans text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
            TV
          </span>
          <span className="text-base font-semibold text-slate-900">
            Twin<span className="text-teal-600">verse</span>
          </span>
        </Link>
        <Link
          href="/encounter"
          className="inline-flex h-10 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          Start an encounter
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">My Feedback</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review feedback from your previous encounter attempts.
        </p>

        {/* Active NetID banner + show-all toggle (demo identification only). */}
        {activeNetId !== "" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">
            <span>
              Showing attempts for NetID{" "}
              <span className="font-mono font-semibold text-slate-800">
                {activeNetId}
              </span>{" "}
              <span className="text-xs text-slate-400">
                (demo identification, not verified login)
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setShowAll((v) => !v);
                setSelectedId(null);
              }}
              className="font-medium text-teal-600 hover:text-teal-700"
            >
              {showAll ? "Show only mine" : "Show all on this device"}
            </button>
          </div>
        )}

        {attempts.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <span className="text-3xl">📝</span>
            <p className="mt-3 max-w-sm text-sm text-slate-500">
              No attempts yet. Finish an encounter and your feedback will show
              up here.
            </p>
            <Link
              href="/encounter"
              className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            >
              Go to encounters
            </Link>
          </div>
        ) : (
          <>
            {visibleAttempts.length === 0 && (
              <p className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No attempts found for NetID{" "}
                <span className="font-mono font-semibold">{activeNetId}</span>.
                Use &ldquo;Show all on this device&rdquo; above to see other
                attempts.
              </p>
            )}

            {/* Attempt list */}
            <ul className="mt-6 flex flex-col gap-3">
              {visibleAttempts.map((a) => {
                const isOpen = a.attemptId === selectedId;
                return (
                  <li
                    key={a.attemptId}
                    className="rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedId(isOpen ? null : a.attemptId)
                      }
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {a.patientName}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatWhen(a.endedAt)} · {formatDuration(a.durationSeconds)} ·{" "}
                          {a.revealedFindingIds.length} finding
                          {a.revealedFindingIds.length === 1 ? "" : "s"} revealed
                        </p>
                      </div>
                      <span className="text-sm font-medium text-teal-600">
                        {isOpen ? "Hide" : "View"}
                      </span>
                    </button>

                    {isOpen && selected && (
                      <div className="border-t border-slate-200 p-5">
                        <FeedbackReportView
                          report={buildFeedbackReport(selected)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
