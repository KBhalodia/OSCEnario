"use client";

// ---------------------------------------------------------------------------
// Studio: review one patient -> edit -> publish -> assign to a year level.
// Everything the AI added is marked "AI-added" so faculty know what to check.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import AppShell, { Card, ErrorNote, Field, Pill, Spinner, btn, input } from "../../components/AppShell";
import Thumb from "../../components/Thumb";
import {
  ApiError,
  api,
  type Assignment,
  type DocKind,
  type Disclosure,
  type Fact,
  type Issue,
  type Level,
  type PatientProfile,
  type Rubric,
} from "@/lib/api";
import { FACULTY_ID } from "@/lib/identity";
import { VoiceControls, voiceApi, type Persona as VoicePersona, type VoiceProfile } from "@/lib/voice";

const DISCLOSURE: { value: Disclosure; label: string; help: string }[] = [
  { value: "initial", label: "Volunteers it", help: "Says it early without being asked" },
  { value: "discoverable", label: "When asked", help: "Shares it when the student asks about the topic" },
  { value: "reluctant", label: "Reluctant", help: "Only once the student has built some trust" },
  { value: "hidden", label: "Hidden", help: "Only with high trust" },
  { value: "chart", label: "Chart only", help: "Never spoken; appears in the chart when released" },
];

export default function PatientReviewPage() {
  return (
    <Suspense fallback={<AppShell title="Patient Studio"><Spinner label="Loading…" /></AppShell>}>
      <Review />
    </Suspense>
  );
}

function Review() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id") ?? "";
  const isNew = params.get("new") === "1";

  const [p, setP] = useState<PatientProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(isNew ? "Draft created. Review the AI-added items, then publish." : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyAI, setOnlyAI] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .patient(id)
      .then((x) => {
        setP(x);
        return api.validate(id);
      })
      .then((v) => setIssues(v.issues))
      .catch((e) => setError(e.message));
    api.health().then((h) => setVoiceOn(h.voice)).catch(() => {});
  }, [id]);

  const edit = (fn: (draft: PatientProfile) => void) => {
    setP((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
    setDirty(true);
    setNote(null);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", async () => {
      if (!p) return;
      const r = await api.savePatient(p);
      setP(r.patient);
      setIssues(r.issues);
      setDirty(false);
      setNote(p.status === "published" ? "Saved. Edits move a published patient back to draft: publish it again when ready." : "Saved.");
    });

  const publish = () =>
    run("publish", async () => {
      if (!p) return;
      let cur = p;
      if (dirty) {
        const r = await api.savePatient(p);
        cur = r.patient;
        setDirty(false);
      }
      try {
        const r = await api.publish(cur.id);
        setIssues(r.issues);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const errs = ((e.detail as { issues?: Issue[] })?.issues ?? []).filter((i) => i.severity === "error");
          setIssues((e.detail as { issues?: Issue[] })?.issues ?? []);
          const ok = window.confirm(
            `There ${errs.length === 1 ? "is 1 error" : `are ${errs.length} errors`} in this patient:\n\n` +
              errs.map((i) => `• ${i.message}`).join("\n") +
              "\n\nPublish anyway?",
          );
          if (!ok) return;
          await api.publish(cur.id, true);
        } else throw e;
      }
      setP({ ...cur, status: "published" });
      setNote("Published. You can assign it to students below.");
    });

  const relink = () =>
    run("relink", async () => {
      if (!p) return;
      if (dirty) await api.savePatient(p);
      const r = await api.relink(p.id);
      setP(r.patient);
      setIssues(r.issues);
      setDirty(false);
      setNote("Objectives re-linked to the facts.");
    });

  const upload = (file: File, kind: DocKind) =>
    run("upload", async () => {
      if (!p) return;
      if (dirty) await api.savePatient(p);
      const r = await api.addDocument(p.id, file, kind);
      setP(r.patient);
      setIssues(r.issues);
      setDirty(false);
      setNote(`Added ${file.name}.`);
    });

  const uploadPortrait = (file: File) =>
    run("portrait", async () => {
      if (!p) return;
      if (dirty) await api.savePatient(p);
      await api.uploadPortrait(p.id, file);
      setP(await api.patient(p.id));
      setDirty(false);
    });

  if (!id) return <AppShell title="Patient Studio">Missing patient id.</AppShell>;
  if (!p)
    return (
      <AppShell title="Patient Studio">
        {error ? <ErrorNote error={error} /> : <Spinner label="Loading patient…" />}
      </AppShell>
    );

  const aiCount = p.facts.filter((f) => f.origin === "generated").length;

  return (
    <AppShell
      title={`Studio · ${p.persona.name}`}
      actions={
        <>
          <a className={btn.ghost} href={`/encounter?patient=${encodeURIComponent(p.id)}&preview=1`} target="_blank" rel="noreferrer">
            Preview as student
          </a>
          <button className={btn.ghost} type="button" onClick={save} disabled={!dirty || !!busy}>
            {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          <button className={btn.primary} type="button" onClick={publish} disabled={!!busy || (p.status === "published" && !dirty)}>
            {busy === "publish" ? "Publishing…" : p.status === "published" && !dirty ? "Published" : "Publish"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/studio" className="text-sm text-teal-700 hover:underline">
            ← All patients
          </Link>
          <Pill tone={p.status === "published" ? "green" : "amber"}>{p.status === "published" ? "Published" : "Draft"}</Pill>
          <Pill>Version {p.version}</Pill>
          {aiCount > 0 && <Pill tone="amber">{aiCount} AI-added facts to review</Pill>}
          {busy && busy !== "save" && busy !== "publish" && <Spinner label="Working…" />}
        </div>
        <ErrorNote error={error} />
        {note && <p className="rounded-lg bg-teal-50 px-4 py-2 text-sm text-teal-800">{note}</p>}

        <IssuesCard issues={issues} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <Card title="Who the student meets">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex flex-col items-center gap-2">
                  <Thumb name={p.persona.name} portrait={p.persona.portrait_path ?? null} size={96} />
                  <label className="cursor-pointer text-xs text-teal-700 hover:underline">
                    Upload portrait
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPortrait(e.target.files[0])} />
                  </label>
                </div>
                <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Name">
                    <input className={input} value={p.persona.name} onChange={(e) => edit((d) => void (d.persona.name = e.target.value))} />
                  </Field>
                  <Field label="Age">
                    <input
                      className={input}
                      type="number"
                      value={p.persona.age ?? ""}
                      onChange={(e) => edit((d) => void (d.persona.age = e.target.value === "" ? null : Number(e.target.value)))}
                    />
                  </Field>
                  <Field label="Sex">
                    <input className={input} value={p.persona.sex ?? ""} onChange={(e) => edit((d) => void (d.persona.sex = e.target.value))} />
                  </Field>
                  <div className="sm:col-span-3">
                    <Field label="Description">
                      <textarea className={input} rows={3} value={p.persona.description} onChange={(e) => edit((d) => void (d.persona.description = e.target.value))} />
                    </Field>
                  </div>
                  <div className="sm:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Personality">
                      <textarea className={input} rows={2} value={p.persona.personality} onChange={(e) => edit((d) => void (d.persona.personality = e.target.value))} />
                    </Field>
                    <Field label="How they talk">
                      <textarea
                        className={input}
                        rows={2}
                        value={p.persona.communication_style}
                        onChange={(e) => edit((d) => void (d.persona.communication_style = e.target.value))}
                      />
                    </Field>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Diagnosis on file: <b>{p.primary_diagnosis || "—"}</b>
                {p.secondary_diagnoses.length > 0 && ` · also ${p.secondary_diagnoses.join(", ")}`}. Students never see this up front.
              </p>
            </Card>

            <FactsCard p={p} edit={edit} onlyAI={onlyAI} setOnlyAI={setOnlyAI} />
            <ChartItemsCard p={p} edit={edit} onUpload={upload} />
            <ObjectivesCard p={p} onRelink={relink} busy={busy === "relink"} />
          </div>

          <div className="flex flex-col gap-6">
            <Card title="Encounter settings">
              <div className="flex flex-col gap-3">
                <Field label="Student role">
                  <input className={input} value={p.settings.student_role} onChange={(e) => edit((d) => void (d.settings.student_role = e.target.value))} />
                </Field>
                <Field label="Encounter goal">
                  <input className={input} value={p.settings.encounter_goal} onChange={(e) => edit((d) => void (d.settings.encounter_goal = e.target.value))} />
                </Field>
                <Field label="Setting">
                  <input className={input} value={p.settings.setting} onChange={(e) => edit((d) => void (d.settings.setting = e.target.value))} />
                </Field>
                <Field label="How open the patient starts" hint="The year level you assign adjusts this further.">
                  <select
                    className={input}
                    value={p.settings.opening_trust}
                    onChange={(e) => edit((d) => void (d.settings.opening_trust = Number(e.target.value)))}
                  >
                    <option value={0}>Guarded</option>
                    <option value={1}>Wary</option>
                    <option value={2}>Opening up</option>
                    <option value={3}>At ease</option>
                  </select>
                </Field>
              </div>
            </Card>

            {voiceOn ? (
              <Card title="Patient voice" hint="Picked automatically from the persona. Preview it or choose another.">
                <VoiceControls
                  persona={p.persona as unknown as VoicePersona}
                  value={p.persona.voice as VoiceProfile | null | undefined}
                  onChange={async (v) => {
                    const next = v ?? (await voiceApi.assign({ ...(p.persona as unknown as VoicePersona), voice: null }));
                    edit((d) => void (d.persona.voice = next));
                  }}
                />
              </Card>
            ) : (
              <Card title="Patient voice">
                <p className="text-sm text-slate-500">Voice service isn&apos;t running on the backend. Students will hear the browser&apos;s built-in voice.</p>
              </Card>
            )}

            {p.assumptions.length > 0 && (
              <Card title="What the AI assumed" hint="Inferred, not stated by you. Check these.">
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {p.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </Card>
            )}

            <AssignCard p={p} dirty={dirty} onGoResults={() => router.push("/professor/results")} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function IssuesCard({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity !== "error");
  if (!issues.length)
    return <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Consistency check: no problems found.</p>;
  return (
    <Card title="Consistency check" hint="Rules run on every save. Errors block publishing unless you choose to publish anyway.">
      <ul className="flex flex-col gap-2">
        {errors.map((i, k) => (
          <li key={`e${k}`} className="flex gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <b>Error</b> {i.message}
          </li>
        ))}
        {warnings.map((i, k) => (
          <li key={`w${k}`} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <b>Check</b> {i.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FactsCard({
  p,
  edit,
  onlyAI,
  setOnlyAI,
}: {
  p: PatientProfile;
  edit: (fn: (d: PatientProfile) => void) => void;
  onlyAI: boolean;
  setOnlyAI: (v: boolean) => void;
}) {
  const groups = useMemo(() => {
    const g: Record<string, Fact[]> = {};
    for (const f of p.facts) if (!onlyAI || f.origin === "generated") (g[f.category] ??= []).push(f);
    return Object.entries(g);
  }, [p.facts, onlyAI]);

  const patch = (id: string, change: Partial<Fact>) =>
    edit((d) => {
      const f = d.facts.find((x) => x.id === id);
      if (f) Object.assign(f, change, change.content !== undefined && f.origin === "generated" ? { origin: "faculty" } : {});
    });

  return (
    <Card
      title={`What the patient knows (${p.facts.length} facts)`}
      hint="The patient can only say what is here. Each fact has a rule for when it comes out. Editing an AI-added fact marks it as reviewed."
      right={
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyAI} onChange={(e) => setOnlyAI(e.target.checked)} /> Only AI-added
        </label>
      }
    >
      <div className="flex flex-col gap-2">
        {groups.map(([cat, facts]) => (
          <details key={cat} className="group rounded-xl border border-slate-200 px-3 py-2" open={onlyAI}>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
              <span className="text-slate-400 transition-transform group-open:rotate-90">▶</span>
              <span className="font-semibold uppercase tracking-wide text-teal-700">{cat}</span>
              <span className="text-slate-500">{facts.length}</span>
              {facts.some((f) => f.origin === "generated") && (
                <Pill tone="amber">{facts.filter((f) => f.origin === "generated").length} AI-added</Pill>
              )}
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {facts.map((f) => (
                <li
                  key={f.id}
                  className={"rounded-xl border p-3 " + (f.origin === "generated" ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-slate-50")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{f.id}</span>
                    <input
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-teal-400 focus:bg-white focus:outline-none"
                      value={f.topic}
                      onChange={(e) => patch(f.id, { topic: e.target.value })}
                      aria-label="Topic"
                    />
                    {f.origin === "generated" ? <Pill tone="amber">AI-added</Pill> : f.origin === "faculty" ? <Pill tone="blue">Faculty</Pill> : <Pill>Dataset</Pill>}
                    <select
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      value={f.disclosure}
                      title={DISCLOSURE.find((d) => d.value === f.disclosure)?.help}
                      onChange={(e) => patch(f.id, { disclosure: e.target.value as Disclosure })}
                    >
                      {DISCLOSURE.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="text-xs text-rose-600 hover:underline"
                      onClick={() => edit((d) => void (d.facts = d.facts.filter((x) => x.id !== f.id)))}
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-teal-400 focus:outline-none"
                    rows={2}
                    value={f.content}
                    onChange={(e) => patch(f.id, { content: e.target.value })}
                  />
                </li>
              ))}
            </ul>
          </details>
        ))}
        <button
          type="button"
          className={btn.small + " self-start"}
          onClick={() =>
            edit((d) => {
              const n = Math.max(0, ...d.facts.map((f) => Number(f.id.replace(/\D/g, "")) || 0)) + 1;
              d.facts.push({
                id: `f${String(n).padStart(3, "0")}`,
                category: "history",
                topic: "new fact",
                content: "",
                disclosure: "discoverable",
                min_trust: 0,
                show_in_chart: true,
                origin: "faculty",
              });
            })
          }
        >
          + Add fact
        </button>
      </div>
    </Card>
  );
}

function ChartItemsCard({
  p,
  edit,
  onUpload,
}: {
  p: PatientProfile;
  edit: (fn: (d: PatientProfile) => void) => void;
  onUpload: (f: File, kind: DocKind) => void;
}) {
  const [kind, setKind] = useState<DocKind>("patient_record");
  return (
    <Card title="Chart items" hint="Labs, vitals, notes and images. They appear in the student's chart only when the student asks for them.">
      <ul className="flex flex-col gap-2">
        {p.artifacts.map((a) => (
          <li key={a.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-800">{a.title}</span>
              <Pill>{a.type.replace("_", " ")}</Pill>
              {a.origin === "generated" && <Pill tone="amber">AI-added</Pill>}
              <select
                className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                value={a.release.trigger}
                onChange={(e) =>
                  edit((d) => {
                    const x = d.artifacts.find((y) => y.id === a.id);
                    if (x) x.release.trigger = e.target.value as typeof a.release.trigger;
                  })
                }
              >
                <option value="on_request">When the student asks</option>
                <option value="at_start">Visible from the start</option>
                <option value="manual">Hidden</option>
              </select>
            </div>
            {a.items.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                {a.items
                  .slice(0, 8)
                  .map((i) => `${i.label}: ${i.value}${i.flag ? ` (${i.flag})` : ""}`)
                  .join(" · ")}
                {a.items.length > 8 && ` · +${a.items.length - 8} more`}
              </p>
            )}
            {a.text && <p className="mt-1 line-clamp-3 text-xs text-slate-600">{a.text}</p>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Add a file:</span>
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
          <option value="patient_record">About this patient (becomes a chart item)</option>
          <option value="reference">Reference material (grading only)</option>
        </select>
        <input
          type="file"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f, kind);
            e.target.value = "";
          }}
        />
      </div>
    </Card>
  );
}

function ObjectivesCard({ p, onRelink, busy }: { p: PatientProfile; onRelink: () => void; busy: boolean }) {
  return (
    <Card
      title="Learning objectives"
      hint="Feedback checks whether the student uncovered each expected finding."
      right={
        <button className={btn.small} type="button" onClick={onRelink} disabled={busy}>
          {busy ? "Re-linking…" : "Re-link to facts"}
        </button>
      }
    >
      <ol className="flex list-decimal flex-col gap-3 pl-5">
        {p.objectives.map((o) => (
          <li key={o.id} className="text-sm text-slate-800">
            <span className="font-medium">{o.objective}</span>
            {o.min_level && <span className="ml-2 text-xs text-slate-500">(graded from {o.min_level})</span>}
            <ul className="mt-1 flex flex-col gap-0.5">
              {o.expected_discoveries.map((d) => (
                <li key={d.id} className="text-xs text-slate-600">
                  • {d.text}{" "}
                  <span className={d.linked_fact_ids.length ? "text-slate-400" : "text-amber-700"}>
                    {d.linked_fact_ids.length ? `→ ${d.linked_fact_ids.join(", ")}` : "→ not linked to any fact"}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function AssignCard({ p, dirty, onGoResults }: { p: PatientProfile; dirty: boolean; onGoResults: () => void }) {
  const [levels, setLevels] = useState<Level[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [level, setLevel] = useState("M2");
  const [students, setStudents] = useState("");
  const [attempts, setAttempts] = useState("");
  const [due, setDue] = useState("");
  const [instructions, setInstructions] = useState("");
  const [checklists, setChecklists] = useState<string[]>(p.settings.checklist_rubric_ids);
  const [existing, setExisting] = useState<Assignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Assignment | null>(null);

  useEffect(() => {
    api.gradingConfig().then((c) => setLevels(c.levels)).catch(() => {});
    api.rubrics().then((r) => setRubrics(r.filter((x) => x.type !== "domain_rubric"))).catch(() => {});
    api
      .assignments({ created_by: FACULTY_ID })
      .then((a) => setExisting(a.filter((x) => x.patient_id === p.id)))
      .catch(() => {});
  }, [p.id, done]);

  const published = p.status === "published" && !dirty;
  const chosen = levels.find((l) => l.key === level);

  const assign = async () => {
    setError(null);
    const ids = students
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    try {
      const a = await api.createAssignment({
        patient_id: p.id,
        level,
        student_ids: ids,
        checklist_rubric_ids: checklists,
        max_attempts: attempts ? Number(attempts) : null,
        due_date: due || null,
        instructions,
        created_by: FACULTY_ID,
      });
      setDone(a);
      setStudents("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card title="Assign to students" hint="The year level sets how hard the patient is and how the encounter is graded.">
      {!published && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Save and publish this patient before assigning it.</p>}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {levels.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLevel(l.key)}
              className={
                "rounded-xl border px-3 py-2 text-left text-sm transition-colors " +
                (l.key === level ? "border-teal-500 bg-teal-50 text-teal-900" : "border-slate-200 hover:border-slate-300")
              }
            >
              <b>{l.key}</b>
              <span className="block text-xs text-slate-500">{l.label}</span>
            </button>
          ))}
        </div>
        {chosen && <p className="text-xs leading-5 text-slate-600">{chosen.expectations}</p>}
        <Field label="Student NetIDs" hint="Comma or space separated. Leave empty to let any student open it.">
          <input className={input} value={students} onChange={(e) => setStudents(e.target.value)} placeholder="abc123, xyz789" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max attempts">
            <input className={input} type="number" min={1} value={attempts} onChange={(e) => setAttempts(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="Due date">
            <input className={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Instructions for students (optional)">
          <textarea className={input} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="You are seeing this patient for a first nutrition visit." />
        </Field>
        {rubrics.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist rubrics</span>
            {rubrics.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={checklists.includes(r.id)}
                  onChange={(e) => setChecklists((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))}
                />
                {r.title}
              </label>
            ))}
          </div>
        )}
        <ErrorNote error={error} />
        <button className={btn.primary} type="button" onClick={assign} disabled={!published}>
          Assign at {level}
        </button>
        {done && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Assigned “{done.title}”{done.student_ids.length ? ` to ${done.student_ids.join(", ")}` : " to everyone"}.
          </p>
        )}
        {existing.length > 0 && (
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Already assigned</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {existing.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    {a.level} · {a.student_ids.length ? a.student_ids.join(", ") : "everyone"}
                  </span>
                  <button type="button" className="text-xs text-teal-700 hover:underline" onClick={onGoResults}>
                    Results
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
