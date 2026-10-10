"use client";

// ---------------------------------------------------------------------------
// FeedbackReport — presentational component for one feedback report
// ---------------------------------------------------------------------------
// Pure UI: it renders a FeedbackReport object. It makes no judgements of its
// own and invents nothing — everything shown comes from the engine, which
// derives it from the saved attempt and the patient's approved profile.
//
// Reused by:
//   - the Student Encounter page (shown right after End Encounter), and
//   - the My Feedback page (reviewing a past attempt).
// ---------------------------------------------------------------------------

import type {
  FeedbackReport as Report,
  ObjectiveCoverage,
} from "./feedbackTypes";

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_STYLES: Record<
  ObjectiveCoverage["status"],
  { label: string; cls: string }
> = {
  covered: { label: "Covered", cls: "bg-teal-100 text-teal-800" },
  partial: { label: "Partial", cls: "bg-amber-100 text-amber-800" },
  "not-covered": { label: "Not covered", cls: "bg-rose-100 text-rose-700" },
};

export default function FeedbackReportView({
  report,
}: {
  report: Report;
}) {
  const totalDiscoverable = report.discovered.length + report.missed.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">
          Encounter feedback
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Patient: <span className="font-medium">{report.patientName}</span> ·
          Duration: {formatDuration(report.durationSeconds)} · Findings
          discovered: {report.discovered.length}/{totalDiscoverable}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          This report is generated only from your transcript, the findings you
          revealed, and the patient&apos;s approved profile. Nothing is invented.
        </p>
      </section>

      {/* Findings discovered / missed */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-teal-700">
            Findings discovered ({report.discovered.length})
          </h3>
          {report.discovered.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No discoverable findings were uncovered this time.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {report.discovered.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800">{f.label}</span>
                  <span className="ml-2 text-xs uppercase tracking-wide text-slate-400">
                    {f.section}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-rose-600">
            Findings missed ({report.missed.length})
          </h3>
          {report.missed.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Nothing missed — every discoverable finding was uncovered.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {report.missed.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-700">{f.label}</span>
                  <span className="ml-2 text-xs uppercase tracking-wide text-slate-400">
                    {f.section}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Objective coverage */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Learning objective coverage
        </h3>
        {report.objectiveCoverage === null ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {report.objectivesNote}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {report.objectiveCoverage.map((o, i) => {
              const style = STATUS_STYLES[o.status];
              return (
                <li
                  key={i}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800">
                      {o.objective}
                    </p>
                    <span
                      className={
                        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold " +
                        style.cls
                      }
                    >
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{o.explanation}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Strengths & suggestions */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-teal-700">
            Strengths
          </h3>
          {report.strengths.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No strengths could be identified from this attempt.
            </p>
          ) : (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
              {report.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
            Suggestions
          </h3>
          {report.suggestions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No specific suggestions — nice work covering the case.
            </p>
          ) : (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
              {report.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Qualitative sections */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Interview &amp; communication
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {report.qualitative.map((q) => (
            <div
              key={q.title}
              className={
                "rounded-xl border p-4 " +
                (q.assessed
                  ? "border-slate-200 bg-white"
                  : "border-dashed border-slate-200 bg-slate-50")
              }
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">
                  {q.title}
                </p>
                {!q.assessed && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Not assessed
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">{q.note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
