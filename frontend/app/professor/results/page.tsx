"use client";

// ---------------------------------------------------------------------------
// Professor Results Dashboard
// ---------------------------------------------------------------------------
// Faculty view of completed student encounters. It reads the SAME saved
// attempts the student feedback page uses (via attemptStorage) — there is no
// separate results source. Every number shown is computed from real saved
// data; nothing (students, scores, findings) is invented.
//
// Demo note: this is a frontend-only prototype backed by localStorage. It is
// NOT secure faculty-only access and does NOT persist across devices.
// ---------------------------------------------------------------------------

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ATTEMPTS_STORAGE_KEY,
  loadAttempts,
} from "../../encounter/feedback/attemptStorage";
import { buildFeedbackReport } from "../../encounter/feedback/feedbackEngine";
import type { EncounterAttempt } from "../../encounter/feedback/feedbackTypes";
import FeedbackReportView from "../../encounter/feedback/FeedbackReport";
import TranscriptView from "../../encounter/feedback/TranscriptView";
import { displayNetId } from "../../encounter/netId";

// --- Subscribe to the attempts store (cached snapshot, SSR-safe) ------------
let cachedSnapshot: EncounterAttempt[] | null = null;

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ATTEMPTS_STORAGE_KEY) {
      cachedSnapshot = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function getClientSnapshot(): EncounterAttempt[] {
  if (cachedSnapshot === null) cachedSnapshot = loadAttempts();
  return cachedSnapshot;
}

const EMPTY: EncounterAttempt[] = [];
function getServerSnapshot() {
  return EMPTY;
}

// --- Helpers ----------------------------------------------------------------

// Count discoverable (non-start) findings and how many were discovered for an
// attempt. Mirrors the feedback engine's definition so numbers stay consistent.
function findingCounts(attempt: EncounterAttempt): {
  discovered: number;
  discoverable: number;
} {
  const revealed = new Set(attempt.revealedFindingIds);
  const discoverable = attempt.findingsSnapshot.filter((f) => !f.startVisible);
  const discovered = discoverable.filter((f) => revealed.has(f.id)).length;
  return { discovered, discoverable: discoverable.length };
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

// Short, non-identifying label for an attempt (requirement 11: never invent a
// student name — label by encounter id instead).
function shortId(attemptId: string): string {
  return attemptId.length > 10 ? `${attemptId.slice(0, 10)}…` : attemptId;
}

export default function ProfessorResultsPage() {
  const attempts = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  // Filters ("all" = everything).
  const [patientFilter, setPatientFilter] = useState<string>("all");
  const [netIdFilter, setNetIdFilter] = useState<string>("all");
  // Which attempt's detail is open.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Distinct patients present in the saved data, for the filter dropdown.
  const patientOptions = useMemo(() => {
    const map = new Map<string, string>(); // patientId -> patientName
    for (const a of attempts) {
      if (!map.has(a.patientId)) map.set(a.patientId, a.patientName);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [attempts]);

  // Distinct NetIDs present (older attempts without one are grouped as
  // "unknown"). We never fabricate an identity.
  const netIdOptions = useMemo(() => {
    const set = new Set<string>();
    let hasUnknown = false;
    for (const a of attempts) {
      if (a.netId && a.netId.trim() !== "") set.add(a.netId);
      else hasUnknown = true;
    }
    const options = Array.from(set).sort();
    return { options, hasUnknown };
  }, [attempts]);

  // Attempts after applying BOTH filters.
  const filtered = useMemo(
    () =>
      attempts.filter((a) => {
        if (patientFilter !== "all" && a.patientId !== patientFilter) {
          return false;
        }
        if (netIdFilter !== "all") {
          const id = a.netId && a.netId.trim() !== "" ? a.netId : "__unknown__";
          if (id !== netIdFilter) return false;
        }
        return true;
      }),
    [attempts, patientFilter, netIdFilter],
  );

  // Summary metrics computed from the filtered real data.
  const metrics = useMemo(() => {
    const totalAttempts = filtered.length;
    const uniquePatients = new Set(filtered.map((a) => a.patientId)).size;

    // Average findings coverage = mean of (discovered / discoverable), only
    // over attempts that actually had discoverable findings.
    let coverageSum = 0;
    let coverageCount = 0;
    for (const a of filtered) {
      const { discovered, discoverable } = findingCounts(a);
      if (discoverable > 0) {
        coverageSum += discovered / discoverable;
        coverageCount += 1;
      }
    }
    const avgCoverage =
      coverageCount > 0 ? Math.round((coverageSum / coverageCount) * 100) : null;

    return { totalAttempts, uniquePatients, avgCoverage };
  }, [filtered]);

  const selected = filtered.find((a) => a.attemptId === selectedId) ?? null;

  return (
    <div className="flex min-h-full flex-1 bg-slate-50 font-sans text-slate-900">
      {/* ============================ SIDEBAR ============================ */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-[#0f2a4a] text-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">
            TV
          </span>
          <span className="text-lg font-semibold">
            Twin<span className="text-teal-300">verse</span>
          </span>
        </div>
        <nav className="flex-1 px-3 py-2">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Faculty
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                href="/"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span aria-hidden="true">🏠</span> Dashboard
              </Link>
            </li>
            <li>
              <Link
                href="/studio"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span aria-hidden="true">🧑‍⚕️</span> Patient Studio
              </Link>
            </li>
            <li>
              <span className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white">
                <span aria-hidden="true">📊</span> Student Results
              </span>
            </li>
          </ul>
        </nav>
        <div className="px-5 py-4 text-xs text-slate-400">
          Demo mode · localStorage only
        </div>
      </aside>

      {/* ============================= MAIN ============================= */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
              TV
            </span>
            <span className="text-base font-semibold text-slate-900">
              Twin<span className="text-teal-600">verse</span>
            </span>
          </Link>
          <h1 className="hidden text-lg font-semibold text-slate-900 md:block">
            Student Results
          </h1>
          <Link
            href="/studio"
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
          >
            Patient Studio
          </Link>
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                Student Results
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Completed encounters saved on this device.
              </p>
            </div>

            {/* Filters */}
            {attempts.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  NetID:
                  <select
                    value={netIdFilter}
                    onChange={(e) => {
                      setNetIdFilter(e.target.value);
                      setSelectedId(null);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                  >
                    <option value="all">All students</option>
                    {netIdOptions.options.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                    {netIdOptions.hasUnknown && (
                      <option value="__unknown__">Unknown student</option>
                    )}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Case:
                  <select
                    value={patientFilter}
                    onChange={(e) => {
                      setPatientFilter(e.target.value);
                      setSelectedId(null);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                  >
                    <option value="all">All patients</option>
                    {patientOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Demo disclaimer */}
          <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Demo prototype: results are stored only in this browser&apos;s
            localStorage. This is not secure faculty access and does not sync
            across devices.
          </p>

          {attempts.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {/* Summary metrics */}
              <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <MetricCard label="Total attempts" value={metrics.totalAttempts} />
                <MetricCard label="Unique patients" value={metrics.uniquePatients} />
                <MetricCard
                  label="Avg. findings coverage"
                  value={
                    metrics.avgCoverage === null
                      ? "—"
                      : `${metrics.avgCoverage}%`
                  }
                />
              </section>

              {/* Results table */}
              <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Student NetID</th>
                        <th className="px-4 py-3">Patient</th>
                        <th className="px-4 py-3">Encounter</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Duration</th>
                        <th className="px-4 py-3">Findings</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map((a) => {
                        const { discovered, discoverable } = findingCounts(a);
                        const isOpen = a.attemptId === selectedId;
                        return (
                          <tr
                            key={a.attemptId}
                            className={isOpen ? "bg-teal-50/40" : undefined}
                          >
                            <td className="px-4 py-3">
                              {a.netId ? (
                                <span className="font-mono text-slate-800">
                                  {a.netId}
                                </span>
                              ) : (
                                <span className="italic text-slate-400">
                                  {displayNetId(a.netId)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {a.patientName}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500">
                              {shortId(a.attemptId)}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {formatWhen(a.endedAt)}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {formatDuration(a.durationSeconds)}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {discovered}/{discoverable}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedId(isOpen ? null : a.attemptId)
                                }
                                className="text-sm font-medium text-teal-600 hover:text-teal-700"
                              >
                                {isOpen ? "Hide" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-8 text-center text-sm text-slate-500"
                          >
                            No encounters for this patient yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Detail: full feedback report + transcript */}
              {selected && (
                <section className="mt-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">
                      <span
                        className={
                          selected.netId ? "font-mono" : "italic text-slate-500"
                        }
                      >
                        {displayNetId(selected.netId)}
                      </span>{" "}
                      · {selected.patientName} ·{" "}
                      <span className="font-mono text-sm text-slate-500">
                        {shortId(selected.attemptId)}
                      </span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="text-sm font-medium text-slate-500 hover:text-slate-700"
                    >
                      Close
                    </button>
                  </div>

                  <FeedbackReportView report={buildFeedbackReport(selected)} />

                  {/* Transcript */}
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Encounter transcript
                    </h3>
                    <div className="mt-4">
                      <TranscriptView transcript={selected.transcript} />
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// --- Small building blocks --------------------------------------------------

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
        {value}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      <span className="text-3xl">📊</span>
      <p className="mt-3 max-w-sm text-sm text-slate-500">
        No completed encounters yet. When a student finishes an encounter, it
        will appear here with its feedback report and transcript.
      </p>
      <Link
        href="/encounter"
        className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
      >
        Open an encounter
      </Link>
    </div>
  );
}
