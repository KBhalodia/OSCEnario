"use client";

// ---------------------------------------------------------------------------
// Studio: one patient, in tabs.
//   Overview · What they know · Chart · Objectives · Assign · Results
// Everything the AI added is marked "AI-added" so faculty know what to check.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, ImageUp, Link2, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import AppShell, { Card, Empty, ErrorNote, Field, Notice, Pill, Spinner, Tabs, btn, input } from "../../components/AppShell";
import { Banner } from "../../components/Banner";
import Thumb from "../../components/Thumb";
import CreatePatientDialog from "../../components/CreatePatientDialog";
import { DocsPicker, RolePicker, docsReady } from "../../components/Forms";
import {
  ApiError,
  api,
  fileUrl,
  type Assignment,
  type AssignmentResults,
  type ClassCard,
  type DocKind,
  type UploadDoc,
  type Disclosure,
  type Fact,
  type Issue,
  type Level,
  type PatientProfile,
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

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "facts", label: "What they know" },
  { key: "chart", label: "Chart" },
  { key: "objectives", label: "Objectives" },
  { key: "assign", label: "Assign" },
  { key: "results", label: "Results" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function PatientReviewPage() {
  return (
    <Suspense
      fallback={
        <AppShell crumb="Patient studio">
          <Spinner label="Loading" />
        </AppShell>
      }
    >
      <Review />
    </Suspense>
  );
}

function Review() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const isNew = params.get("new") === "1";
  const classId = params.get("class");
  const router = useRouter();

  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const [p, setP] = useState<PatientProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(isNew ? "Draft created. Check the AI-added items, then publish." : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [assigned, setAssigned] = useState<Assignment[]>([]);
  const [klass, setKlass] = useState<ClassCard | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .assignments()
      .then((as) => setAssigned(as.filter((a) => a.patient_id === id)))
      .catch(() => {});
    if (classId) api.klass(classId).then(setKlass).catch(() => {});
    api
      .patient(id)
      .then((x) => {
        setP(x);
        return api.validate(id);
      })
      .then((v) => setIssues(v.issues))
      .catch((e) => setError(e.message));
    api.health().then((h) => setVoiceOn(h.voice)).catch(() => {});
  }, [id, classId]);

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

  const saveIfDirty = async (cur: PatientProfile) => {
    if (!dirty) return cur;
    const r = await api.savePatient(cur);
    setDirty(false);
    setIssues(r.issues);
    return r.patient;
  };

  const save = () =>
    run("save", async () => {
      if (!p) return;
      const wasPublished = p.status === "published";
      const r = await api.savePatient(p);
      setP(r.patient);
      setIssues(r.issues);
      setDirty(false);
      setNote(wasPublished ? "Saved. Edits move a published patient back to draft, so publish it again when you're ready." : "Saved.");
    });

  const publish = () =>
    run("publish", async () => {
      if (!p) return;
      const cur = await saveIfDirty(p);
      try {
        const r = await api.publish(cur.id);
        setIssues(r.issues);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const all = (e.detail as { issues?: Issue[] })?.issues ?? [];
          const errs = all.filter((i) => i.severity === "error");
          setIssues(all);
          const ok = window.confirm(
            `${errs.length === 1 ? "1 problem needs" : `${errs.length} problems need`} a look:\n\n` +
              errs.map((i) => `- ${i.message}`).join("\n") +
              "\n\nPublish anyway?",
          );
          if (!ok) return;
          await api.publish(cur.id, true);
        } else throw e;
      }
      setP({ ...cur, status: "published" });
      setNote("Published. Students can be assigned this patient now.");
    });

  const relink = () =>
    run("relink", async () => {
      if (!p) return;
      await saveIfDirty(p);
      const r = await api.relink(p.id);
      setP(r.patient);
      setIssues(r.issues);
      setNote("Objectives re-linked to the facts.");
    });

  const upload = (docs: UploadDoc[]) =>
    run("upload", async () => {
      if (!p) return;
      await saveIfDirty(p);
      let last = null;
      for (const d of docs) {
        last = await api.addDocument(p.id, d.file, "patient_record" as DocKind, { name: d.name, type: d.type, summary: d.summary });
      }
      if (last) {
        setP(last.patient);
        setIssues(last.issues);
      }
      setNote(`Added ${docs.length} file${docs.length === 1 ? "" : "s"}.`);
    });

  const remove = () =>
    run("delete", async () => {
      if (!p) return;
      if (!window.confirm(`Delete ${p.persona.name}? This can't be undone.`)) return;
      await api.deletePatient(p.id);
      router.push(classId ? `/class?id=${classId}` : "/studio");
    });

  const uploadPortrait = (file: File) =>
    run("portrait", async () => {
      if (!p) return;
      await saveIfDirty(p);
      await api.uploadPortrait(p.id, file);
      setP(await api.patient(p.id));
    });

  if (!id)
    return (
      <AppShell crumb="Patient studio">
        <Empty title="No patient selected" action={<Link className={btn.primary} href="/studio">Open the library</Link>} />
      </AppShell>
    );
  if (!p)
    return (
      <AppShell crumb="Patient studio">{error ? <ErrorNote error={error} /> : <Spinner label="Loading patient" />}</AppShell>
    );

  const aiCount = p.facts.filter((f) => f.origin === "generated").length;
  const errors = issues.filter((i) => i.severity === "error").length;
  const published = p.status === "published" && !dirty;

  return (
    <AppShell
      crumb={p.persona.name}
      title={p.persona.name}
      actions={
        <>
          <span className="mr-1 flex items-center gap-2">
            {published ? <Pill tone="green">Published</Pill> : <Pill tone="amber">{dirty ? "Unsaved changes" : "Draft"}</Pill>}
            {busy && <Spinner />}
          </span>
          <a className={btn.text} href={`/encounter?patient=${encodeURIComponent(p.id)}&preview=1`} target="_blank" rel="noreferrer">
            <Play size={16} /> Try it
          </a>
          <button className={btn.ghost} type="button" onClick={save} disabled={!dirty || !!busy}>
            Save
          </button>
          <button className={btn.primary} type="button" onClick={publish} disabled={!!busy || published}>
            {published ? "Published" : "Publish"}
          </button>
        </>
      }
      tabs={<Tabs tabs={TABS} active={tab} onChange={setTab} />}
    >
      <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
        <Link href={classId ? `/class?id=${classId}` : "/studio"} className={btn.text + " -ml-3 -mt-2 self-start"}>
          <ArrowLeft size={18} /> {klass ? klass.name : "Patient library"}
        </Link>
        <ErrorNote error={error} />
        {note && <Notice tone="ok">{note}</Notice>}

        {tab === "overview" && (
          <>
            <Banner id={p.id} title={p.persona.name} subtitle={[p.persona.age && `${p.persona.age} years old`, p.persona.sex].filter(Boolean).join(", ")} tall />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_300px]">
              <div className="flex flex-col gap-6">
                <ReviewSummary issues={issues} aiCount={aiCount} onGo={setTab} />
                <Card title="Who the student meets" hint="The patient plays this person. The answer key is never shown to students or said by the patient.">
                  <div className="flex flex-col gap-5 sm:flex-row">
                    <label className="group relative flex shrink-0 cursor-pointer flex-col items-center gap-2 self-start">
                      <Thumb name={p.persona.name} portrait={p.persona.portrait_path ?? null} size={96} />
                      <span className="flex items-center gap-1 text-xs text-primary group-hover:underline">
                        <ImageUp size={14} /> Change photo
                      </span>
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadPortrait(e.target.files[0])} />
                    </label>
                    <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
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
                      <div className="grid grid-cols-1 gap-4 sm:col-span-3 sm:grid-cols-2">
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
                  <p className="mt-5 border-t border-line pt-4 text-sm text-ink-2">
                    Answer key: <span className="text-ink">{p.primary_diagnosis || "not set"}</span>
                    {p.secondary_diagnoses.length > 0 && <>, also {p.secondary_diagnoses.join(", ")}</>}
                  </p>
                </Card>
                {p.assumptions.length > 0 && (
                  <Card title="What the studio assumed" hint="Inferred, not stated by you.">
                    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-5 text-ink">
                      {p.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>

              <div className="flex flex-col gap-6">
                <Card title="Encounter">
                  <div className="flex flex-col gap-4">
                    <Field label="Who the student is">
                      <RolePicker value={p.settings.student_role} onChange={(v) => edit((d) => void (d.settings.student_role = v))} />
                    </Field>
                    <Field label="Goal">
                      <input className={input} value={p.settings.encounter_goal} onChange={(e) => edit((d) => void (d.settings.encounter_goal = e.target.value))} />
                    </Field>
                    <Field label="Setting">
                      <input className={input} value={p.settings.setting} onChange={(e) => edit((d) => void (d.settings.setting = e.target.value))} />
                    </Field>
                    <Field label="How open they are at first" hint="The year level you assign adjusts this.">
                      <select className={input} value={p.settings.opening_trust} onChange={(e) => edit((d) => void (d.settings.opening_trust = Number(e.target.value)))}>
                        <option value={0}>Guarded</option>
                        <option value={1}>Wary</option>
                        <option value={2}>Opening up</option>
                        <option value={3}>At ease</option>
                      </select>
                    </Field>
                    <label className="flex items-start gap-3 text-sm leading-5 text-ink">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[#0b57d0]"
                        checked={!!p.settings.patient_names_diagnosis}
                        onChange={(e) => edit((d) => void (d.settings.patient_names_diagnosis = e.target.checked))}
                      />
                      <span>
                        Patient may say their diagnosis
                        <span className="block text-xs text-ink-3">Off for OSCE practice: the patient describes symptoms and the student works out the diagnosis.</span>
                      </span>
                    </label>
                  </div>
                </Card>
                <Card title="Voice">
                  {voiceOn ? (
                    <VoiceControls
                      persona={p.persona as unknown as VoicePersona}
                      value={p.persona.voice as VoiceProfile | null | undefined}
                      onChange={async (v) => {
                        const next = v ?? (await voiceApi.assign({ ...(p.persona as unknown as VoicePersona), voice: null }));
                        edit((d) => void (d.persona.voice = next));
                      }}
                    />
                  ) : (
                    <p className="text-sm text-ink-2">The voice service isn&apos;t running on the backend. Students will hear the browser&apos;s built-in voice.</p>
                  )}
                </Card>
                <Card title="Manage">
                  {assigned.length ? (
                    <p className="text-sm leading-5 text-ink-2">
                      Assigned {assigned.length} time{assigned.length === 1 ? "" : "s"}, so the description is locked and it can&apos;t be deleted. You can still edit facts.
                    </p>
                  ) : (
                    <div className="flex flex-col items-start gap-1">
                      <button type="button" className={btn.text + " -ml-3"} onClick={() => setEditingBrief(true)}>
                        <Pencil size={16} /> Edit description and rebuild
                      </button>
                      <button type="button" className={btn.text + " -ml-3 text-danger hover:bg-[#fce8e6]"} onClick={remove}>
                        <Trash2 size={16} /> Delete patient
                      </button>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}

        {tab === "facts" && <FactsTab p={p} edit={edit} />}
        {tab === "chart" && <ChartTab p={p} edit={edit} onUpload={upload} busy={busy === "upload"} />}
        {tab === "objectives" && <ObjectivesTab p={p} onRelink={relink} busy={busy === "relink"} />}
        {tab === "assign" && <AssignTab p={p} published={published} errors={errors} defaultClass={classId} onGoResults={() => setTab("results")} />}
        {tab === "results" && <ResultsTab patientId={p.id} />}
      </div>
      {editingBrief && (
        <CreatePatientDialog
          editing={p}
          onClose={() => setEditingBrief(false)}
          onDone={(np) => {
            setEditingBrief(false);
            setP(np);
            setDirty(false);
            api.validate(np.id).then((v) => setIssues(v.issues)).catch(() => {});
            setNote("Rebuilt from your new description. Review it again before publishing.");
          }}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function ReviewSummary({ issues, aiCount, onGo }: { issues: Issue[]; aiCount: number; onGo: (t: string) => void }) {
  const errs = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity !== "error");
  return (
    <Card title="Before you publish" hint="Checks run every time you save.">
      <ul className="-mx-2 flex flex-col">
        {errs.map((i, k) => (
          <li key={`e${k}`} className="flex gap-3 rounded-lg px-2 py-2 text-sm text-ink">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
            {i.message}
          </li>
        ))}
        {warns.map((i, k) => (
          <li key={`w${k}`} className="flex gap-3 rounded-lg px-2 py-2 text-sm text-ink-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#b06000]" />
            {i.message}
          </li>
        ))}
        {aiCount > 0 && (
          <li>
            <button type="button" onClick={() => onGo("facts")} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-ink hover:bg-black/[0.03]">
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#fef7e0] text-[11px] font-medium text-[#7a4f01]">{aiCount > 99 ? "99" : aiCount}</span>
              facts were added by the studio. Review them in What they know.
              <ChevronRight size={18} className="ml-auto text-ink-3" />
            </button>
          </li>
        )}
        {!issues.length && !aiCount && <li className="px-2 py-2 text-sm text-ok">No problems found.</li>}
      </ul>
    </Card>
  );
}

function FactsTab({ p, edit }: { p: PatientProfile; edit: (fn: (d: PatientProfile) => void) => void }) {
  const [onlyAI, setOnlyAI] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
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
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="text-[22px] text-ink">What the patient knows</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-2">
            The patient can only say what is here, and each fact has a rule for when it comes out. Editing a fact the studio added marks it as reviewed.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="h-4 w-4 accent-[#0b57d0]" checked={onlyAI} onChange={(e) => setOnlyAI(e.target.checked)} />
          Only show AI-added
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        {groups.map(([cat, facts], gi) => {
          const isOpen = open === cat || onlyAI;
          const ai = facts.filter((f) => f.origin === "generated").length;
          return (
            <div key={cat} className={gi ? "border-t border-line" : ""}>
              <button
                type="button"
                onClick={() => setOpen(isOpen && !onlyAI ? null : cat)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-black/[0.02]"
                aria-expanded={isOpen}
              >
                <ChevronRight size={18} className={"text-ink-3 transition-transform " + (isOpen ? "rotate-90" : "")} />
                <span className="text-[15px] font-medium text-ink">{cap(cat)}</span>
                <span className="text-sm text-ink-3">{facts.length}</span>
                {ai > 0 && <Pill tone="amber">{ai} to review</Pill>}
              </button>
              {isOpen && (
                <ul className="flex flex-col gap-3 px-5 pb-5 pl-14">
                  {facts.map((f) => (
                    <li key={f.id} className={"rounded-lg border p-3 " + (f.origin === "generated" ? "border-[#f9e4a8] bg-[#fffbf0]" : "border-line")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm font-medium text-ink hover:border-line focus:border-primary focus:outline-none"
                          value={f.topic}
                          onChange={(e) => patch(f.id, { topic: e.target.value })}
                          aria-label="Topic"
                        />
                        {f.origin === "generated" ? <Pill tone="amber">AI-added</Pill> : f.origin === "faculty" ? <Pill tone="blue">You</Pill> : <Pill>Dataset</Pill>}
                        <select
                          className="rounded-md border border-[#c4c7c5] bg-white px-2 py-1 text-[13px]"
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
                          aria-label="Remove fact"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-black/[0.05] hover:text-danger"
                          onClick={() => edit((d) => void (d.facts = d.facts.filter((x) => x.id !== f.id)))}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <textarea
                        className="mt-2 w-full rounded-md border border-line bg-white px-2.5 py-2 text-sm leading-5 text-ink focus:border-primary focus:outline-none"
                        rows={2}
                        value={f.content}
                        onChange={(e) => patch(f.id, { content: e.target.value })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={btn.small + " self-start"}
        onClick={() =>
          edit((d) => {
            const n = Math.max(0, ...d.facts.map((f) => Number(f.id.replace(/\D/g, "")) || 0)) + 1;
            d.facts.push({
              id: `f${String(n).padStart(3, "0")}`,
              category: "history",
              topic: "New fact",
              content: "",
              disclosure: "discoverable",
              min_trust: 0,
              show_in_chart: true,
              origin: "faculty",
            });
          })
        }
      >
        <Plus size={16} /> Add fact
      </button>
    </>
  );
}

function ChartTab({
  p,
  edit,
  onUpload,
  busy,
}: {
  p: PatientProfile;
  edit: (fn: (d: PatientProfile) => void) => void;
  onUpload: (docs: UploadDoc[]) => void;
  busy: boolean;
}) {
  const [docs, setDocs] = useState<UploadDoc[]>([]);
  const [docErr, setDocErr] = useState<string | null>(null);
  return (
    <>
      <div>
        <h2 className="text-[22px] text-ink">Chart</h2>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-2">Labs, vitals, notes and images. Students see an item only after they ask for it.</p>
      </div>
      <ul className="flex flex-col overflow-hidden rounded-xl border border-line">
        {p.artifacts.map((a, i) => (
          <li key={a.id} className={"px-5 py-4 " + (i ? "border-t border-line" : "")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-medium text-ink">{a.title}</span>
              {a.origin === "generated" && <Pill tone="amber">AI-added</Pill>}
              <select
                className="ml-auto rounded-md border border-[#c4c7c5] bg-white px-2 py-1 text-[13px]"
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
              <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                {a.items.slice(0, 10).map((it, k) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-dashed border-line py-1">
                    <dt className="text-ink-2">{it.label}</dt>
                    <dd className="text-right text-ink">
                      {it.value}
                      {it.flag && <span className="ml-1.5 text-danger">{it.flag}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {a.items.length > 10 && <p className="mt-1 text-xs text-ink-3">and {a.items.length - 10} more</p>}
            {isImage(a.file_path) ? (
              <ImagePreview p={p} filePath={a.file_path!} title={a.title} />
            ) : (
              <>
                {a.text && <p className="mt-2 line-clamp-3 text-sm leading-5 text-ink-2">{a.text}</p>}
                {a.file_path && (
                  <a className={btn.text + " -ml-3 mt-1 h-8"} href={fileUrl(`uploads/${a.file_path.split("/").pop()}`) ?? "#"} target="_blank" rel="noreferrer">
                    Open file
                  </a>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <Card title="Add documents" hint="Records about this patient become chart items; reference material is used for grading only.">
        <DocsPicker docs={docs} onChange={setDocs} compact />
        {docs.length > 0 && (
          <div className="mt-4 flex items-center justify-end gap-3">
            {docErr && <span className="text-sm text-danger">{docErr}</span>}
            <button
              type="button"
              className={btn.primary}
              disabled={busy}
              onClick={() => {
                const e = docsReady(docs);
                setDocErr(e);
                if (e) return;
                onUpload(docs);
                setDocs([]);
              }}
            >
              <Upload size={16} /> {busy ? "Uploading" : `Upload ${docs.length} file${docs.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

function ObjectivesTab({ p, onRelink, busy }: { p: PatientProfile; onRelink: () => void; busy: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="text-[22px] text-ink">Learning objectives</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-2">Feedback checks whether the student uncovered each expected finding.</p>
        </div>
        <button className={btn.small} type="button" onClick={onRelink} disabled={busy}>
          <Link2 size={15} /> {busy ? "Re-linking" : "Re-link to facts"}
        </button>
      </div>
      <ol className="flex flex-col gap-4">
        {p.objectives.map((o, i) => (
          <li key={o.id} className="rounded-xl border border-line p-5">
            <p className="text-[15px] text-ink">
              <span className="mr-2 text-ink-3">{i + 1}.</span>
              {o.objective}
              {o.min_level && <span className="ml-2 text-xs text-ink-3">graded from {o.min_level}</span>}
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 pl-6">
              {o.expected_discoveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-2">
                  <span className="text-ink">{d.text}</span>
                  {d.linked_fact_ids.length ? (
                    <span className="text-xs text-ink-3">linked to {d.linked_fact_ids.join(", ")}</span>
                  ) : (
                    <span className="text-xs text-[#b06000]">not linked, graded from the transcript</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  );
}

function AssignTab({
  p,
  published,
  errors,
  defaultClass,
  onGoResults,
}: {
  p: PatientProfile;
  published: boolean;
  errors: number;
  defaultClass: string | null;
  onGoResults: () => void;
}) {
  const [classes, setClasses] = useState<ClassCard[]>([]);
  const [classId, setClassId] = useState<string>(defaultClass ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState("M2");
  const [students, setStudents] = useState("");
  useEffect(() => {
    api
      .classes({ created_by: FACULTY_ID })
      .then((cs) => {
        setClasses(cs);
        setClassId((cur) => cur || cs[0]?.id || "");
      })
      .catch(() => {});
  }, []);
  const roster = classes.find((c) => c.id === classId)?.student_ids ?? [];
  const [attempts, setAttempts] = useState("");
  const [due, setDue] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Assignment | null>(null);

  useEffect(() => {
    api.gradingConfig().then((c) => setLevels(c.levels)).catch(() => {});
  }, []);

  const chosen = levels.find((l) => l.key === level);

  const assign = async () => {
    setError(null);
    const ids = classId
      ? picked
      : students
          .split(/[\s,;]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
    try {
      const a = await api.createAssignment({
        patient_id: p.id,
        class_id: classId || null,
        level,
        student_ids: ids,
        max_attempts: attempts ? Number(attempts) : null,
        due_date: due || null,
        instructions,
        created_by: FACULTY_ID,
      });
      setDone(a);
      setStudents("");
      setPicked([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
      <Card title="Assign to students" hint="The year level sets how hard the patient is and how the encounter is graded.">
        {!published && (
          <div className="mb-4">
            <Notice tone="warn">Save and publish this patient first{errors ? `. ${errors} problem${errors === 1 ? "" : "s"} still need a look on the Overview tab.` : "."}</Notice>
          </div>
        )}
        <div className="flex flex-col gap-5">
          <div role="radiogroup" aria-label="Year level" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {levels.map((l) => (
              <button
                key={l.key}
                type="button"
                role="radio"
                aria-checked={l.key === level}
                onClick={() => setLevel(l.key)}
                className={
                  "rounded-xl border px-3 py-3 text-left transition-colors " +
                  (l.key === level ? "border-primary bg-[#f0f4fc]" : "border-line hover:bg-black/[0.02]")
                }
              >
                <span className={"block text-[17px] " + (l.key === level ? "text-primary" : "text-ink")}>{l.key}</span>
                <span className="block text-xs leading-4 text-ink-2">{l.label.replace(/^Year \d /, "")}</span>
              </button>
            ))}
          </div>
          <Field label="Class">
            <select className={input} value={classId} onChange={(e) => (setClassId(e.target.value), setPicked([]))}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.section ? `, ${c.section}` : ""}
                </option>
              ))}
              <option value="">No class: list NetIDs instead</option>
            </select>
          </Field>
          {classId ? (
            <div>
              <p className="text-[13px] font-medium text-ink-2">Students</p>
              {roster.length === 0 ? (
                <p className="mt-1 text-sm text-ink-2">Nobody has joined this class yet. The assignment will reach everyone who joins.</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="flex items-center gap-3 text-sm text-ink">
                    <input type="radio" className="h-4 w-4 accent-[#0b57d0]" checked={picked.length === 0} onChange={() => setPicked([])} />
                    Whole class ({roster.length})
                  </label>
                  <div className="flex flex-wrap gap-2 pl-7">
                    {roster.map((sid) => {
                      const on = picked.includes(sid);
                      return (
                        <button
                          key={sid}
                          type="button"
                          onClick={() => setPicked((cur) => (on ? cur.filter((x) => x !== sid) : [...cur, sid]))}
                          className={"h-8 rounded-lg border px-3 font-mono text-[13px] " + (on ? "border-primary bg-[#f0f4fc] text-primary" : "border-line text-ink-2 hover:bg-black/[0.03]")}
                        >
                          {sid}
                        </button>
                      );
                    })}
                  </div>
                  {picked.length > 0 && <p className="pl-7 text-xs text-ink-3">Only the {picked.length} selected student{picked.length === 1 ? "" : "s"}.</p>}
                </div>
              )}
            </div>
          ) : (
            <Field label="Student NetIDs" hint="Separate with commas or spaces. Leave empty to let any student open it.">
              <input className={input} value={students} onChange={(e) => setStudents(e.target.value)} placeholder="abc123, xyz789" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Attempts allowed">
              <input className={input} type="number" min={1} value={attempts} onChange={(e) => setAttempts(e.target.value)} placeholder="Unlimited" />
            </Field>
            <Field label="Due date">
              <input className={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <Field label="Instructions (optional)">
            <textarea className={input} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="First nutrition visit. Find out what's getting in the way of her plan." />
          </Field>
          <ErrorNote error={error} />
          {done && (
            <Notice tone="ok">
              Assigned at {done.level}
              {done.class_name ? ` in ${done.class_name}` : ""}
              {done.student_ids.length ? ` to ${done.student_ids.join(", ")}` : done.class_name ? " to the whole class" : " to every student"}.{" "}
              <button type="button" className="font-medium underline" onClick={onGoResults}>
                See results
              </button>
            </Notice>
          )}
          <div className="flex justify-end">
            <button className={btn.primary} type="button" onClick={assign} disabled={!published}>
              Assign
            </button>
          </div>
        </div>
      </Card>
      {chosen && (
        <aside className="rounded-xl bg-shell p-5 text-sm leading-6 text-ink-2">
          <p className="text-[15px] font-medium text-ink">{chosen.label}</p>
          <p className="mt-2">{chosen.expectations}</p>
          <p className="mt-4 font-medium text-ink">How the patient behaves</p>
          <p className="mt-1">{chosen.patient_difficulty}</p>
        </aside>
      )}
    </div>
  );
}

function ResultsTab({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<AssignmentResults[] | null>(null);
  useEffect(() => {
    api
      .assignments()
      .then((as) => Promise.all(as.filter((a) => a.patient_id === patientId).map((a) => api.results(a.id))))
      .then(setRows)
      .catch(() => setRows([]));
  }, [patientId]);

  if (rows === null) return <Spinner label="Loading results" />;
  if (!rows.length) return <Empty title="Not assigned yet">Assign this patient to students and their attempts will appear here.</Empty>;

  return (
    <div className="flex flex-col gap-6">
      {rows.map((r) => (
        <Card
          key={r.assignment.id}
          title={`${r.assignment.level_label}`}
          hint={`${r.assignment.student_ids.length ? r.assignment.student_ids.join(", ") : "Every student"}${r.assignment.due_date ? `, due ${r.assignment.due_date}` : ""}`}
          right={
            <Link className={btn.text} href={`/professor/results?assignment=${r.assignment.id}`}>
              Open
            </Link>
          }
        >
          {r.attempts.length === 0 ? (
            <p className="text-sm text-ink-2">No attempts yet.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {r.attempts.map((t) => (
                <li key={t.encounter_id}>
                  <Link href={`/professor/results?encounter=${t.encounter_id}`} className="flex items-center gap-4 rounded-lg px-2 py-2.5 text-sm hover:bg-black/[0.03]">
                    <span className="w-24 font-mono text-ink">{t.student_id ?? "unknown"}</span>
                    <span className="flex-1 text-ink-2">{t.started_at ? new Date(t.started_at).toLocaleString() : ""}</span>
                    {t.needs_review && <Pill tone="rose">Needs review</Pill>}
                    <span className="w-16 text-right font-medium text-ink">{t.total != null ? `${t.total}/${t.max_total}` : t.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

const isImage = (fp?: string | null) => !!fp && /\.(png|jpe?g|gif|webp)$/i.test(fp);

/** Faculty view of an uploaded image: the file itself, and the read faculty wrote. */
function ImagePreview({ p, filePath, title }: { p: PatientProfile; filePath: string; title: string }) {
  const src = fileUrl(`uploads/${filePath.split("/").pop()}`) ?? "";
  const doc = p.documents.find((d) => d.file_path === filePath);
  return (
    <div className="mt-3 flex flex-col gap-4 sm:flex-row">
      <a href={src} target="_blank" rel="noreferrer" className="block shrink-0 overflow-hidden rounded-lg border border-line bg-black sm:w-56">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} className="h-40 w-full object-contain" />
      </a>
      <div className="min-w-0 text-sm leading-5">
        <p className="text-ink-2">Students see the image only.</p>
        <p className="mt-2 text-[13px] font-medium text-ink-2">Your read (case writing and grading only)</p>
        <p className="mt-0.5 text-ink">{doc?.summary || <span className="text-ink-3">None given. Add a summary when you upload to tell the grader what the image shows.</span>}</p>
        <a className={btn.text + " -ml-3 mt-1 h-8"} href={src} target="_blank" rel="noreferrer">
          Open full size
        </a>
      </div>
    </div>
  );
}
