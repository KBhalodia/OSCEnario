"use client";

// Renders the backend's feedback report (POST /encounters/{id}/end).
// Every quote shown here was checked by the backend against the real transcript.

import type { Evidence, Feedback, TranscriptTurn } from "@/lib/api";
import { Card, Pill } from "./AppShell";

const SCORE_TONE: Record<string, "rose" | "amber" | "teal" | "green" | "slate"> = {
  "1": "rose",
  "2": "amber",
  "3": "teal",
  "4": "green",
  "N/A": "slate",
};

function Quotes({ evidence }: { evidence: Evidence[] }) {
  if (!evidence?.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {evidence.map((e, i) => (
        <li key={i} className="border-l-2 border-teal-300 pl-2 text-xs italic text-slate-600">
          “{e.quote}” <span className="not-italic text-slate-400">· turn {e.turn}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FeedbackReport({ fb, transcript }: { fb: Feedback; transcript?: TranscriptTurn[] }) {
  const pct = fb.max_total ? Math.round((fb.total / fb.max_total) * 100) : 0;
  const found = fb.objectives.reduce((n, o) => n + o.found, 0);
  const total = fb.objectives.reduce((n, o) => n + o.total, 0);
  const comm = fb.communication as {
    questions?: number;
    open_questions?: number;
    empathy_or_reflection?: number;
    introduced_self?: boolean;
    closed_encounter?: boolean;
    checked_understanding?: boolean;
    final_trust?: number;
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rubric score</p>
            <p className="text-4xl font-bold text-slate-900">
              {fb.total}
              <span className="text-xl font-medium text-slate-400"> / {fb.max_total}</span>
            </p>
            <p className="text-sm text-slate-500">{pct}% · graded at {fb.level_label || fb.level}</p>
          </div>
          {total > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Key findings uncovered</p>
              <p className="text-2xl font-bold text-slate-900">
                {found}
                <span className="text-base font-medium text-slate-400"> / {total}</span>
              </p>
            </div>
          )}
          {fb.needs_review && <Pill tone="amber">Flagged for faculty review</Pill>}
        </div>
        {fb.summary && <p className="mt-4 text-sm leading-6 text-slate-700">{fb.summary}</p>}
        {fb.faculty_notes && (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <b>Instructor note:</b> {fb.faculty_notes}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="What went well">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {fb.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Card>
        <Card title="To work on">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {fb.areas_for_improvement.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Card>
        <Card title="Try next time">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {fb.next_attempt_suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title="Encounter rubric" hint="Seven domains, scored 1–4. N/A means not expected at this year level.">
        <ul className="flex flex-col divide-y divide-slate-100">
          {fb.domains.map((d) => (
            <li key={d.key} className="py-3">
              <div className="flex items-center gap-3">
                <Pill tone={SCORE_TONE[d.score] ?? "slate"}>{d.score === "N/A" ? "N/A" : `${d.score} / 4`}</Pill>
                <span className="font-medium text-slate-900">{d.name}</span>
                {d.mode === "lenient" && <span className="text-xs text-slate-400">graded for this year</span>}
              </div>
              {d.score !== "N/A" && (
                <>
                  <p className="mt-1 text-sm text-slate-600">{d.rationale}</p>
                  {d.important_gap_or_missed_opportunity && (
                    <p className="mt-1 text-xs text-amber-800">Missed: {d.important_gap_or_missed_opportunity}</p>
                  )}
                  {d.safety_or_accuracy_concern && <p className="mt-1 text-xs text-rose-700">Safety/accuracy: {d.safety_or_accuracy_concern}</p>}
                  <Quotes evidence={d.evidence} />
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {fb.objectives.length > 0 && (
        <Card title="Learning objectives" hint="Found = the patient told you, or you opened it in the chart.">
          <ul className="flex flex-col gap-4">
            {fb.objectives.map((o) => (
              <li key={o.id}>
                <p className="text-sm font-medium text-slate-900">
                  {o.objective} <span className="text-slate-400">({o.found}/{o.total})</span>
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {o.items.map((it) => (
                    <li key={it.id} className="text-sm">
                      <span className={it.status === "found" ? "text-emerald-700" : "text-slate-500"}>
                        {it.status === "found" ? "✓" : "○"} {it.text}
                      </span>
                      {it.turn != null && <span className="text-xs text-slate-400"> · turn {it.turn}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {fb.epas.length > 0 && (
        <Card title="Entrustable Professional Activities (AAMC)" hint="An estimate from one simulated encounter. Your instructor confirms it.">
          <ul className="flex flex-col gap-3">
            {fb.epas.map((e) => (
              <li key={e.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm text-slate-900">
                    {e.id}: {e.title}
                  </b>
                  {e.meets_target === true && <Pill tone="green">Meets target</Pill>}
                  {e.meets_target === false && <Pill tone="amber">Below target</Pill>}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Estimated: <b>{e.estimated_label ?? "not enough evidence"}</b> · Target: {e.target_label}
                  {e.faculty_confirmed_level != null && ` · Instructor confirmed level ${e.faculty_confirmed_level}`}
                </p>
                {e.rationale && <p className="mt-1 text-sm text-slate-600">{e.rationale}</p>}
                <Quotes evidence={e.evidence} />
              </li>
            ))}
          </ul>
          {fb.epas_not_assessed.length > 0 && (
            <ul className="mt-3 text-xs text-slate-500">
              {fb.epas_not_assessed.map((e) => (
                <li key={e.id}>
                  {e.id}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {fb.checklists.map((c) => (
        <Card key={c.id} title={c.title} hint={`${c.score} / ${c.max_points} points (${c.percent}%)`}>
          {c.excluded.length > 0 && (
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Not counted ({c.original_max_points - c.max_points} points): this patient has no{" "}
              {Array.from(new Set(c.excluded.map((x) => x.missing))).join(", ")} to review.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {c.sections
              .filter((s) => s.applicable)
              .map((s) => (
                <li key={s.id}>
                  <p className="text-sm font-medium text-slate-900">
                    {s.name} <span className="text-slate-400">({s.earned}/{s.points})</span>
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {s.items.map((it) => (
                      <li key={it.id} className="text-sm text-slate-600">
                        {it.status === "achieved" ? "✓" : it.status === "partial" ? "◐" : it.status === "not_applicable" ? "—" : "○"} {it.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </Card>
      ))}

      <Card title="Communication">
        <div className="flex flex-wrap gap-2 text-sm">
          <Pill>{comm.questions ?? 0} questions</Pill>
          <Pill>{comm.open_questions ?? 0} open questions</Pill>
          <Pill>{comm.empathy_or_reflection ?? 0} empathy / reflection</Pill>
          <Pill tone={comm.introduced_self ? "green" : "amber"}>{comm.introduced_self ? "Introduced yourself" : "No introduction"}</Pill>
          <Pill tone={comm.checked_understanding ? "green" : "slate"}>{comm.checked_understanding ? "Checked understanding" : "Didn't check understanding"}</Pill>
          <Pill tone={comm.closed_encounter ? "green" : "amber"}>{comm.closed_encounter ? "Closed the visit" : "No closing"}</Pill>
        </div>
      </Card>

      {transcript && transcript.length > 0 && (
        <Card title="Transcript" hint="The words only. No audio was recorded.">
          <ol className="flex flex-col gap-2">
            {transcript.map((t) => (
              <li key={t.n} className={"flex " + (t.speaker === "student" ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-4 py-2 text-sm " +
                    (t.speaker === "student" ? "rounded-br-sm bg-teal-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800")
                  }
                >
                  <span className="mr-2 text-[10px] opacity-60">{t.n}</span>
                  {t.text}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
