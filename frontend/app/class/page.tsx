"use client";

// One class.
//   Faculty:  Patients · Assignments · People · Results
//   Student:  their assignments in this class
// URL: /class?id=<class id>[&tab=patients|assignments|people|results]

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { MoreVertical, Pencil, Plus, Send, UserMinus, X } from "lucide-react";
import AppShell, { Card, Empty, ErrorNote, Pill, Spinner, Tabs, btn } from "../components/AppShell";
import AssignmentGrid from "../components/AssignmentGrid";
import { Banner, PatientCard, bannerColor } from "../components/Banner";
import { CodeCard, CreateClassDialog } from "../components/Classes";
import CreatePatientDialog from "../components/CreatePatientDialog";
import Thumb from "../components/Thumb";
import DiagnosisPill from "../components/DiagnosisPill";
import { useRole } from "@/lib/useRole";
import { useActiveNetId } from "@/lib/identity";
import { api, type Assignment, type AssignmentResults, type ClassCard, type EncounterRow, type PatientSummary } from "@/lib/api";

export default function ClassPage() {
  return (
    <Suspense
      fallback={
        <AppShell crumb="Class">
          <Spinner label="Loading" />
        </AppShell>
      }
    >
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { role } = useRole();
  return role === "professor" ? <FacultyClass id={id} initialTab={params.get("tab") ?? "patients"} /> : <StudentClass id={id} />;
}

const TABS = [
  { key: "patients", label: "Patients" },
  { key: "assignments", label: "Assignments" },
  { key: "people", label: "People" },
  { key: "results", label: "Results" },
];

function FacultyClass({ id, initialTab }: { id: string; initialTab: string }) {
  const router = useRouter();
  const [c, setC] = useState<ClassCard | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [results, setResults] = useState<AssignmentResults[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api.klass(id).then(setC).catch((e) => setError(e.message));
    api
      .assignments({ class_id: id })
      .then(async (as) => {
        setAssignments(as);
        setResults((await Promise.all(as.map((a) => api.results(a.id).catch(() => null)))).filter(Boolean) as AssignmentResults[]);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  if (!c)
    return (
      <AppShell crumb="Class">
        {error ? <ErrorNote error={error} /> : <Spinner label="Loading class" />}
      </AppShell>
    );

  const assignedIn = (pid: string) => assignments.filter((a) => a.patient_id === pid);

  return (
    <AppShell crumb={c.name} tabs={<Tabs tabs={TABS} active={tab} onChange={setTab} />}>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
        <ErrorNote error={error} />
        <Banner id={c.id} title={c.name} subtitle={c.section || c.student_role} tall>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="absolute right-4 top-4 inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-primary shadow-sm hover:bg-[#f0f4fc]"
          >
            <Pencil size={15} /> Edit
          </button>
        </Banner>

        {tab === "patients" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm text-ink-2">
                {c.patients.length ? `${c.patients.length} patient${c.patients.length === 1 ? "" : "s"} in this class` : "No patients in this class yet."}
              </p>
              <button className={btn.ghost} type="button" onClick={() => setAdding(true)}>
                Add from library
              </button>
              <button className={btn.primary} type="button" onClick={() => setCreating(true)}>
                <Plus size={18} /> Create patient
              </button>
            </div>
            {c.patients.length === 0 ? (
              <Empty title="Add the patients for this class">
                Create a new patient from a short description, or add one you already made from your library.
              </Empty>
            ) : (
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {c.patients.map((p) => {
                  const asg = assignedIn(p.id);
                  return (
                    <li key={p.id}>
                      <PatientCard
                        id={p.id}
                        href={`/studio/patient?id=${encodeURIComponent(p.id)}&class=${c.id}`}
                        title={p.name}
                        subtitle={p.primary_diagnosis || undefined}
                        portrait={p.portrait}
                        name={p.name}
                        body={
                          <>
                            {p.status !== "published" && <Pill tone="amber">Draft</Pill>}
                            <p className={p.status !== "published" ? "mt-2" : ""}>
                              {asg.length ? `Assigned at ${asg.map((a) => a.level).join(", ")}` : "Not assigned in this class"}
                            </p>
                          </>
                        }
                        footer={
                          <>
                            <Link className={btn.text} href={`/studio/patient?id=${encodeURIComponent(p.id)}&class=${c.id}&tab=assign`}>
                              <Send size={16} /> Assign
                            </Link>
                            <CardMenu
                              onRemove={async () => {
                                if (!window.confirm(`Remove ${p.name} from ${c.name}? The patient stays in your library.`)) return;
                                setC(await api.removeClassPatient(c.id, p.id));
                              }}
                            />
                          </>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {tab === "assignments" && (
          <Card title="Assignments" hint="Open a patient and choose Assign to add one.">
            {assignments.length === 0 ? (
              <p className="text-sm text-ink-2">Nothing assigned in this class yet.</p>
            ) : (
              <ul className="-mx-2 flex flex-col">
                {assignments.map((a) => {
                  const r = results.find((x) => x.assignment.id === a.id);
                  const done = r?.attempts.filter((t) => t.status === "completed").length ?? 0;
                  const p = c.patients.find((x) => x.id === a.patient_id);
                  return (
                    <li key={a.id}>
                      <Link href={`/professor/results?assignment=${a.id}`} className="flex items-center gap-4 rounded-lg px-2 py-3 hover:bg-black/[0.03]">
                        <Thumb name={a.patient_name} portrait={p?.portrait ?? null} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] text-ink">{a.patient_name}</span>
                          <span className="block truncate text-[13px] text-ink-2">
                            {a.level_label}
                            {a.due_date ? `, due ${a.due_date}` : ""}
                            {a.student_ids.length ? `, ${a.student_ids.length} selected students` : ", whole class"}
                          </span>
                        </span>
                        <span className="text-sm text-ink-2">
                          {done} turned in
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {tab === "people" && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
            <Card title="Students" hint={`${c.student_count} joined`}>
              {(c.student_ids ?? []).length === 0 ? (
                <p className="text-sm text-ink-2">No one has joined yet. Share the class code.</p>
              ) : (
                <ul className="-mx-2 flex flex-col divide-y divide-line">
                  {(c.student_ids ?? []).map((s) => (
                    <li key={s} className="flex items-center gap-4 px-2 py-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-white" style={{ background: bannerColor(s) }}>
                        {s[0]?.toUpperCase()}
                      </span>
                      <span className="flex-1 font-mono text-sm text-ink">{s}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${s}`}
                        title="Remove from class"
                        onClick={async () => window.confirm(`Remove ${s} from ${c.name}?`) && setC(await api.removeStudent(c.id, s))}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-black/[0.05] hover:text-danger"
                      >
                        <UserMinus size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <CodeCard
              code={c.code}
              onReset={async () => {
                if (!window.confirm("Make a new code? The old one stops working; students who joined stay in the class.")) return;
                const r = await api.resetCode(c.id);
                setC({ ...c, code: r.code });
              }}
            />
          </div>
        )}

        {tab === "results" && <ClassResults results={results} />}
      </div>

      {creating && (
        <CreatePatientDialog
          classId={c.id}
          className={c.name}
          defaultRole={c.student_role}
          onClose={() => setCreating(false)}
          onDone={(p) => router.push(`/studio/patient?id=${encodeURIComponent(p.id)}&class=${c.id}&new=1`)}
        />
      )}
      {adding && (
        <AddFromLibrary
          inClass={c.patient_ids}
          onClose={() => setAdding(false)}
          onAdd={async (pid) => {
            setC(await api.addClassPatient(c.id, pid));
          }}
        />
      )}
      {editing && (
        <CreateClassDialog
          editing={c}
          onClose={() => setEditing(false)}
          onDone={(x) => {
            setC(x);
            setEditing(false);
          }}
        />
      )}
    </AppShell>
  );
}

function CardMenu({ onRemove }: { onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-auto">
      <button type="button" aria-label="More" onClick={() => setOpen((o) => !o)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]">
        <MoreVertical size={20} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <span className="absolute bottom-11 right-0 z-20 w-48 rounded-lg bg-white py-2 shadow-lg ring-1 ring-black/5">
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-sm text-ink hover:bg-black/[0.04]"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              Remove from class
            </button>
          </span>
        </>
      )}
    </span>
  );
}

function AddFromLibrary({ inClass, onClose, onAdd }: { inClass: string[]; onClose: () => void; onAdd: (id: string) => Promise<void> }) {
  const [all, setAll] = useState<PatientSummary[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => {
    api.patients().then(setAll).catch(() => setAll([]));
  }, []);
  const options = (all ?? []).filter((p) => !inClass.includes(p.id) || added.includes(p.id));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-12" role="dialog" aria-modal="true" aria-label="Add from library">
      <div className="w-full max-w-[560px] rounded-[28px] bg-surface shadow-2xl">
        <div className="flex items-center px-6 pb-2 pt-6">
          <h2 className="text-2xl text-ink">Add from library</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]">
            <X size={20} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4">
          {all === null ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : options.length === 0 ? (
            <p className="p-4 text-sm text-ink-2">Every patient in your library is already in this class.</p>
          ) : (
            <ul className="flex flex-col">
              {options.map((p) => (
                <li key={p.id} className="flex items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-black/[0.03]">
                  <Thumb name={p.name} portrait={p.portrait} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-ink">{p.name}</span>
                    <span className="block truncate text-[13px] text-ink-2">{p.primary_diagnosis}</span>
                  </span>
                  {added.includes(p.id) ? (
                    <span className="px-3 text-sm text-ok">Added</span>
                  ) : (
                    <button
                      type="button"
                      className={btn.small}
                      onClick={async () => {
                        await onAdd(p.id);
                        setAdded((a) => [...a, p.id]);
                      }}
                    >
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end px-6 pb-6">
          <button type="button" className={btn.primary} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ClassResults({ results }: { results: AssignmentResults[] }) {
  const rows = results.flatMap((r) => r.attempts.map((t) => ({ ...t, patient: r.assignment.patient_name, level: r.assignment.level })));
  if (!rows.length) return <Empty title="No attempts yet">When students finish their encounters, their scores show up here.</Empty>;
  return (
    <Card title="Results">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[13px] text-ink-2">
              <th className="py-2 pr-4 font-medium">Student</th>
              <th className="py-2 pr-4 font-medium">Patient</th>
              <th className="py-2 pr-4 font-medium">Score</th>
              <th className="py-2 pr-4 font-medium">Diagnosis</th>
              <th className="py-2 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.encounter_id} className="border-b border-line last:border-0">
                <td className="py-2.5 pr-4 font-mono text-ink">{t.student_id ?? "unknown"}</td>
                <td className="py-2.5 pr-4 text-ink">
                  {t.patient} <span className="text-ink-3">{t.level}</span>
                </td>
                <td className="py-2.5 pr-4 text-ink">{t.total != null ? `${t.total}/${t.max_total}` : <Pill tone="amber">{t.status}</Pill>}</td>
                <td className="py-2.5 pr-4">
                  <DiagnosisPill verdict={t.diagnosis} />
                </td>
                <td className="py-2.5 text-right">
                  {t.needs_review && <Pill tone="rose">Needs review</Pill>}{" "}
                  {t.status === "completed" && (
                    <Link className="ml-2 font-medium text-primary hover:underline" href={`/professor/results?encounter=${t.encounter_id}`}>
                      Review
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StudentClass({ id }: { id: string }) {
  const netId = useActiveNetId();
  const [c, setC] = useState<ClassCard | null>(null);
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [attempts, setAttempts] = useState<EncounterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!netId || !id) return;
    Promise.all([api.klass(id, netId), api.assignments({ student_id: netId, class_id: id }), api.encounters({ student_id: netId })])
      .then(([k, a, e]) => {
        setC(k);
        setItems(a);
        setAttempts(e.filter((x) => !x.preview));
      })
      .catch((e) => setError(e.message));
  }, [id, netId]);

  if (!c)
    return (
      <AppShell crumb="Class">
        {error ? <ErrorNote error={error} /> : <Spinner label="Loading class" />}
      </AppShell>
    );

  return (
    <AppShell crumb={c.name}>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
        <Banner id={c.id} title={c.name} subtitle={c.section || c.student_role} tall />
        {c.description && <p className="max-w-3xl text-[15px] leading-6 text-ink">{c.description}</p>}
        {items === null ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Empty title="Nothing assigned yet">When your instructor assigns a patient in this class, it shows up here.</Empty>
        ) : (
          <AssignmentGrid items={items} attempts={attempts} />
        )}
      </div>
    </AppShell>
  );
}
