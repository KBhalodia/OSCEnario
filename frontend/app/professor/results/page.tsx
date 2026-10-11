"use client";

// Faculty: assignments -> attempts -> one attempt's feedback + instructor review.
//   /professor/results                       all assignments
//   /professor/results?assignment=<id>       attempts table
//   /professor/results?encounter=<id>        one attempt, with review form

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AppShell, { Card, ErrorNote, Field, Pill, Spinner, btn, input } from "../../components/AppShell";
import FeedbackReport from "../../components/FeedbackReport";
import DiagnosisPill from "../../components/DiagnosisPill";
import { api, type Assignment, type AssignmentResults, type EncounterDetail, type Feedback } from "@/lib/api";
import { FACULTY_ID } from "@/lib/identity";

export default function ResultsPage() {
  return (
    <Suspense fallback={<AppShell title="Results" crumb="Results"><Spinner label="Loading…" /></AppShell>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const q = useSearchParams();
  const enc = q.get("encounter");
  const asg = q.get("assignment");
  if (enc) return <Attempt id={enc} />;
  if (asg) return <Attempts id={asg} />;
  return <AllAssignments />;
}

function AllAssignments() {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .assignments()
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <AppShell title="Results" crumb="Results">
      <ErrorNote error={error} />
      {rows === null ? (
        <Spinner label="Loading…" />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">
            No assignments yet. Open a published patient in the{" "}
            <Link href="/studio" className="text-primary underline">
              patient studio
            </Link>{" "}
            and assign it.
          </p>
        </Card>
      ) : (
        <Card title="Assignments">
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-medium text-ink">{a.patient_name}</span>
                <Pill tone="teal">{a.level}</Pill>
                <span className="text-xs text-ink-2">
                  {a.student_ids.length ? a.student_ids.join(", ") : "Everyone"}
                  {a.due_date ? ` · due ${a.due_date}` : ""}
                </span>
                <Link className="ml-auto text-sm text-primary hover:underline" href={`/professor/results?assignment=${a.id}`}>
                  See attempts
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}

function Attempts({ id }: { id: string }) {
  const [r, setR] = useState<AssignmentResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .results(id)
      .then(setR)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <AppShell title="Results" crumb="Results">
      <Link href="/professor/results" className="text-sm text-primary hover:underline">
        All assignments
      </Link>
      <div className="mt-4 flex flex-col gap-4">
        <ErrorNote error={error} />
        {!r ? (
          !error && <Spinner label="Loading…" />
        ) : (
          <Card title={`${r.assignment.patient_name} · ${r.assignment.level_label}`} hint={`${r.attempts.length} attempt(s)`}>
            {r.attempts.length === 0 ? (
              <p className="text-sm text-ink-2">No attempts yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-2">
                      <th className="py-2 pr-3">Student</th>
                      <th className="py-2 pr-3">Started</th>
                      <th className="py-2 pr-3">Score</th>
                      <th className="py-2 pr-3">EPAs</th>
                      <th className="py-2 pr-3">Diagnosis</th>
                      <th className="py-2 pr-3">Flags</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.attempts.map((a) => (
                      <tr key={a.encounter_id} className="border-t border-line">
                        <td className="py-2 pr-3 font-mono">{a.student_id ?? "—"}</td>
                        <td className="py-2 pr-3 text-ink-2">{a.started_at ? new Date(a.started_at).toLocaleString() : ""}</td>
                        <td className="py-2 pr-3 font-semibold">{a.total != null ? `${a.total}/${a.max_total}` : <Pill tone="amber">{a.status}</Pill>}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {(a.epas ?? []).map((e) => (
                              <Pill key={e.id} tone={e.meets_target ? "green" : e.meets_target === false ? "amber" : "slate"}>
                                {e.id}
                              </Pill>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <DiagnosisPill verdict={a.diagnosis} />
                        </td>
                        <td className="py-2 pr-3">{a.needs_review && <Pill tone="rose">Needs review</Pill>}</td>
                        <td className="py-2 text-right">
                          {a.status === "completed" && (
                            <Link className="text-primary hover:underline" href={`/professor/results?encounter=${a.encounter_id}`}>
                              Review
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function Attempt({ id }: { id: string }) {
  const [d, setD] = useState<EncounterDetail | null>(null);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [notes, setNotes] = useState("");
  const [epa, setEpa] = useState<Record<string, number>>({});
  const [clear, setClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .encounter(id)
      .then((x) => {
        setD(x);
        setFb(x.feedback);
        setNotes(x.feedback?.faculty_notes ?? "");
        const conf: Record<string, number> = {};
        for (const e of x.feedback?.epas ?? []) if (e.faculty_confirmed_level != null) conf[e.id] = e.faculty_confirmed_level;
        setEpa(conf);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const save = async () => {
    setError(null);
    try {
      const r = await api.facultyReview(id, { notes, reviewed_by: FACULTY_ID, epa_confirmed_levels: epa, clear_review_flag: clear });
      setFb(r);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <AppShell title="Review attempt" crumb="Results">
      {d?.assignment_id && (
        <Link href={`/professor/results?assignment=${d.assignment_id}`} className="text-sm text-primary hover:underline">
          Back to attempts
        </Link>
      )}
      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ErrorNote error={error} />
          {!fb ? !error && <Spinner label="Loading…" /> : <FeedbackReport fb={fb} transcript={d?.transcript} />}
        </div>
        {fb && (
          <div className="flex flex-col gap-4">
            <Card title="Instructor review" hint={`Student ${d?.student_id ?? "—"} · the student sees your note.`}>
              <div className="flex flex-col gap-3">
                {fb.needs_review && (
                  <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    <b>Flagged:</b> {fb.review_reasons.join(" ") || "Low score in a safety-related domain."}
                  </div>
                )}
                <Field label="Note to the student">
                  <textarea className={input} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                {fb.epas.map((e) => (
                  <Field key={e.id} label={`${e.id} confirmed level`} hint={`AI estimate: ${e.estimated_label ?? "none"} · target ${e.target_label}`}>
                    <select
                      className={input}
                      value={epa[e.id] ?? ""}
                      onChange={(ev) =>
                        setEpa((m) => {
                          const n = { ...m };
                          if (ev.target.value === "") delete n[e.id];
                          else n[e.id] = Number(ev.target.value);
                          return n;
                        })
                      }
                    >
                      <option value="">Not confirmed</option>
                      <option value={1}>1 · Observe only</option>
                      <option value={2}>2 · Direct supervision</option>
                      <option value={3}>3 · Indirect supervision</option>
                      <option value={4}>4 · Unsupervised</option>
                      <option value={5}>5 · Supervises others</option>
                    </select>
                  </Field>
                ))}
                {fb.needs_review && (
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Mark as reviewed (clear the flag)
                  </label>
                )}
                <button className={btn.primary} type="button" onClick={save}>
                  Save review
                </button>
                {saved && <p className="text-sm text-ok">Saved.</p>}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
