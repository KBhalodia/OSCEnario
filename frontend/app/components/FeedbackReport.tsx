"use client";

// Renders the backend's feedback report (POST /encounters/{id}/end).
// Every quote shown here was checked by the backend against the real transcript.

import { Check, Circle } from "lucide-react";
import type { DiagnosisResult, Evidence, Feedback, Pacing, TranscriptTurn } from "@/lib/api";
import { Card, Pill } from "./AppShell";
import DiagnosisPill from "./DiagnosisPill";

function Quotes({ evidence }: { evidence: Evidence[] }) {
  if (!evidence?.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {evidence.map((e, i) => (
        <li key={i} className="border-l-2 border-[#a8c7fa] pl-3 text-[13px] leading-5 text-ink-2">
          “{e.quote}” <span className="text-ink-3">(turn {e.turn})</span>
        </li>
      ))}
    </ul>
  );
}

/** Four segments for a 1–4 rubric score; empty track for N/A. */
function ScoreBar({ score }: { score: string }) {
  const n = Number(score);
  const color = n >= 4 ? "#146c2e" : n === 3 ? "#0b57d0" : n === 2 ? "#b06000" : "#b3261e";
  return (
    <span className="flex items-center gap-3" aria-label={score === "N/A" ? "Not assessed" : `${score} out of 4`}>
      <span className="flex gap-1">
        {[1, 2, 3, 4].map((k) => (
          <span key={k} className="h-1.5 w-6 rounded-full" style={{ background: !Number.isNaN(n) && k <= n ? color : "#e0e3e7" }} />
        ))}
      </span>
      <span className="w-9 text-right text-sm font-medium text-ink">{score === "N/A" ? "N/A" : `${score}/4`}</span>
    </span>
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
    pacing?: Pacing;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-line p-6 sm:p-8">
        <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
          <div>
            <p className="text-[44px] leading-none text-ink">
              {fb.total}
              <span className="text-2xl text-ink-3">/{fb.max_total}</span>
            </p>
            <p className="mt-2 text-sm text-ink-2">
              Rubric score, {pct}%, graded at {fb.level_label || fb.level}
            </p>
          </div>
          {total > 0 && (
            <div>
              <p className="text-[28px] leading-none text-ink">
                {found}
                <span className="text-lg text-ink-3">/{total}</span>
              </p>
              <p className="mt-2 text-sm text-ink-2">Key findings uncovered</p>
            </div>
          )}
          {fb.needs_review && (
            <span className="ml-auto">
              <Pill tone="amber">Your instructor will review this</Pill>
            </span>
          )}
        </div>
        {fb.summary && <p className="mt-6 max-w-3xl text-[15px] leading-6 text-ink">{fb.summary}</p>}
        {fb.faculty_notes && (
          <div className="mt-6 flex gap-3 rounded-lg bg-[#e8f0fe] p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4d6a87] text-sm font-medium text-white">F</span>
            <div>
              <p className="text-sm font-medium text-ink">Instructor comment</p>
              <p className="mt-0.5 text-sm leading-5 text-ink">{fb.faculty_notes}</p>
            </div>
          </div>
        )}
      </section>

      {fb.diagnosis && <DiagnosisCard d={fb.diagnosis} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="What went well">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-5 text-ink">
            {fb.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Card>
        <Card title="To work on">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-5 text-ink">
            {fb.areas_for_improvement.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Card>
        <Card title="Try next time">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-5 text-ink">
            {fb.next_attempt_suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Encounter rubric" hint="Seven domains scored 1 to 4. N/A means it isn't expected at this year level.">
        <ul className="flex flex-col divide-y divide-line">
          {fb.domains.map((d) => (
            <li key={d.key} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[15px] text-ink">{d.name}</span>
                {d.mode === "lenient" && <span className="text-xs text-ink-3">graded for this year</span>}
                <span className="ml-auto">
                  <ScoreBar score={d.score} />
                </span>
              </div>
              {d.score !== "N/A" && (
                <div className="max-w-3xl">
                  <p className="mt-1.5 text-sm leading-5 text-ink-2">{d.rationale}</p>
                  {d.important_gap_or_missed_opportunity && <p className="mt-1.5 text-sm leading-5 text-ink-2">Missed: {d.important_gap_or_missed_opportunity}</p>}
                  {d.safety_or_accuracy_concern && <p className="mt-1.5 text-sm leading-5 text-danger">Safety or accuracy: {d.safety_or_accuracy_concern}</p>}
                  <Quotes evidence={d.evidence} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {fb.objectives.length > 0 && (
        <Card title="Learning objectives" hint="A finding counts when the patient told you or you opened it in the chart.">
          <ul className="flex flex-col gap-5">
            {fb.objectives.map((o) => (
              <li key={o.id}>
                <div className="flex items-baseline gap-3">
                  <p className="text-[15px] text-ink">{o.objective}</p>
                  <span className="ml-auto shrink-0 text-sm text-ink-2">
                    {o.found}/{o.total}
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {o.items.map((it) => (
                    <li key={it.id} className="flex items-start gap-2.5 text-sm leading-5">
                      {it.status === "found" ? (
                        <Check size={16} className="mt-0.5 shrink-0 text-ok" />
                      ) : (
                        <Circle size={14} className="mt-[3px] shrink-0 text-[#c4c7c5]" />
                      )}
                      <span className={it.status === "found" ? "text-ink" : "text-ink-2"}>{it.text}</span>
                      {it.turn != null && <span className="text-ink-3">(turn {it.turn})</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {fb.epas.length > 0 && (
        <Card title="Entrustable Professional Activities" hint="AAMC Core EPAs, estimated from one simulated encounter. Your instructor confirms the level.">
          <ul className="flex flex-col divide-y divide-line">
            {fb.epas.map((e) => (
              <li key={e.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] text-ink">
                    {e.id}: {e.title}
                  </span>
                  <span className="ml-auto">
                    {e.meets_target === true && <Pill tone="green">Meets target</Pill>}
                    {e.meets_target === false && <Pill tone="amber">Below target</Pill>}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-2">
                  Estimated {e.estimated_label ? e.estimated_label.toLowerCase() : "(not enough evidence)"}, target {e.target_label.toLowerCase()}
                  {e.faculty_confirmed_level != null && `. Instructor confirmed level ${e.faculty_confirmed_level}`}
                </p>
                {e.rationale && <p className="mt-1.5 max-w-3xl text-sm leading-5 text-ink-2">{e.rationale}</p>}
                <Quotes evidence={e.evidence} />
              </li>
            ))}
          </ul>
          {fb.epas_not_assessed.length > 0 && (
            <ul className="mt-4 border-t border-line pt-3 text-[13px] text-ink-3">
              {fb.epas_not_assessed.map((e) => (
                <li key={e.id}>
                  {e.id}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Communication">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Questions asked" value={comm.questions ?? 0} />
          <Stat label="Open questions" value={comm.open_questions ?? 0} />
          <Stat label="Empathy or reflection" value={comm.empathy_or_reflection ?? 0} />
          <Stat label="Introduced yourself" value={comm.introduced_self ? "Yes" : "No"} />
          <Stat label="Checked understanding" value={comm.checked_understanding ? "Yes" : "No"} />
          <Stat label="Closed the visit" value={comm.closed_encounter ? "Yes" : "No"} />
        </dl>
      </Card>

      {comm.pacing && comm.pacing.measured_turns > 0 && <PacingCard p={comm.pacing} />}

      {transcript && transcript.length > 0 && (
        <Card title="Transcript" hint="The words only, with when they were said. No audio was recorded.">
          <ol className="flex flex-col gap-3">
            {transcript.map((t) => (
              <li key={t.n} className="grid grid-cols-[44px_64px_1fr] gap-3 text-sm leading-5">
                <span className="pt-px font-mono text-xs tabular-nums text-ink-3">{t.offset_s != null ? clock(t.offset_s) : ""}</span>
                <span className={t.speaker === "student" ? "font-medium text-primary" : "font-medium text-ink"}>{t.speaker === "student" ? "You" : "Patient"}</span>
                <span className="text-ink">
                  {t.text}
                  {t.speaker === "student" && (t.interrupted || t.response_ms != null) && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {t.interrupted && <Pill tone="amber">Talked over the patient</Pill>}
                      {!t.interrupted && t.response_ms != null && (
                        <Pill tone={t.response_ms >= 15000 ? "amber" : "slate"}>Paused {secs(t.response_ms)}</Pill>
                      )}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-xl text-ink">{value}</dd>
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const secs = (ms: number) => (ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

function DiagnosisCard({ d }: { d: DiagnosisResult }) {
  return (
    <Card title="Your working diagnosis" right={<DiagnosisPill verdict={d.verdict} />}>
      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-2">You said</dt>
          <dd className="mt-0.5 text-[15px] text-ink">{d.submitted || "No answer"}</dd>
          {d.differential.length > 0 && <dd className="mt-1 text-ink-2">Differential: {d.differential.join(", ")}</dd>}
        </div>
        <div>
          <dt className="text-ink-2">The case</dt>
          <dd className="mt-0.5 text-[15px] text-ink">{d.expected.join(", ") || "Not set"}</dd>
        </div>
      </dl>
      {d.explanation && <p className="mt-4 max-w-3xl text-sm leading-5 text-ink">{d.explanation}</p>}
    </Card>
  );
}

function PacingCard({ p }: { p: Pacing }) {
  return (
    <Card title="Pacing" hint={p.note}>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Stat label="Typical pause" value={p.median_pause_s != null ? `${p.median_pause_s}s` : "n/a"} />
        <Stat label="Longest pause" value={p.longest_pause_s != null ? `${p.longest_pause_s}s` : "n/a"} />
        <Stat label="Long silences" value={p.long_pauses.length} />
        <Stat label="Talked over the patient" value={p.interrupted_turns.length} />
      </dl>
      {(p.long_pauses.length > 0 || p.interrupted_turns.length > 0) && (
        <p className="mt-4 text-sm leading-5 text-ink-2">
          {p.long_pauses.length > 0 && `Long silences before turn ${p.long_pauses.join(", ")}. `}
          {p.interrupted_turns.length > 0 && `You started talking while the patient was still speaking at turn ${p.interrupted_turns.join(", ")}. Letting the patient finish is part of listening.`}
        </p>
      )}
    </Card>
  );
}
