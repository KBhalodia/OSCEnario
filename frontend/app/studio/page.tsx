"use client";

// ---------------------------------------------------------------------------
// Patient Studio (faculty): library + "Create a patient".
// Create = a short description (+ optional files) -> POST /patients/generate
// -> the AI builds a full draft patient -> faculty review it on the next page.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell, { Card, ErrorNote, Field, Pill, Spinner, btn, input } from "../components/AppShell";
import Thumb from "../components/Thumb";
import { api, type DocKind, type FacultyInput, type PatientSummary, type Rubric } from "@/lib/api";

const EMPTY: FacultyInput = {
  name: "",
  age: null,
  gender: "",
  ethnicity: "",
  background: "",
  personality: "",
  notes: "",
  summary: "",
  student_role: "Dietetics student",
  encounter_goal: "",
};

export default function StudioPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FacultyInput>(EMPTY);
  const [files, setFiles] = useState<{ file: File; kind: DocKind }[]>([]);
  const [checklists, setChecklists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const load = () =>
    api
      .patients()
      .then(setPatients)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.rubrics().then((r) => setRubrics(r.filter((x) => x.type !== "domain_rubric"))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const set = (k: keyof FacultyInput, v: string) =>
    setForm((f) => ({ ...f, [k]: k === "age" ? (v === "" ? null : Number(v)) : v }));

  const importSamples = async () => {
    setError(null);
    try {
      await api.importSamples();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const generate = async () => {
    if (!form.name?.trim()) {
      setError("Give the patient a name.");
      return;
    }
    setError(null);
    setElapsed(0);
    setBusy(true);
    try {
      const r = await api.generate(form, files, checklists);
      router.push(`/studio/patient?id=${encodeURIComponent(r.patient.id)}&new=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Patient Studio"
      actions={
        <button className={btn.primary} onClick={() => setShowForm((s) => !s)} type="button">
          {showForm ? "Close" : "+ Create patient"}
        </button>
      }
    >
      <div className="flex flex-col gap-6">
        <ErrorNote error={error} />

        {showForm && (
          <Card
            title="Create a new patient"
            hint="Only the name is required. Type what you know; the AI fills in the rest and marks everything it added so you can review it before publishing."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label="Name *">
                <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Maria Lopez" />
              </Field>
              <Field label="Age">
                <input className={input} type="number" value={form.age ?? ""} onChange={(e) => set("age", e.target.value)} />
              </Field>
              <Field label="Gender">
                <select className={input} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                  <option value="">—</option>
                  <option>female</option>
                  <option>male</option>
                  <option>non-binary</option>
                </select>
              </Field>
              <Field label="Ethnicity / background">
                <input className={input} value={form.ethnicity} onChange={(e) => set("ethnicity", e.target.value)} />
              </Field>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Clinical notes" hint="Numbers, meds, history, what's going on. These are kept exactly as written.">
                <textarea className={input} rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Stage II hypertension (BP 155/110). BMI 34. Takes lisinopril but skips doses…" />
              </Field>
              <div className="flex flex-col gap-4">
                <Field label="Main diagnosis / topic">
                  <input className={input} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Hypertension, obesity" />
                </Field>
                <Field label="Life & background">
                  <input className={input} value={form.background} onChange={(e) => set("background", e.target.value)} placeholder="Works night shifts, lives with her two kids" />
                </Field>
                <Field label="Personality">
                  <input className={input} value={form.personality} onChange={(e) => set("personality", e.target.value)} placeholder="Guarded, a bit embarrassed about her weight" />
                </Field>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Student role">
                <input className={input} value={form.student_role} onChange={(e) => set("student_role", e.target.value)} />
              </Field>
              <Field label="Encounter goal (optional)">
                <input className={input} value={form.encounter_goal} onChange={(e) => set("encounter_goal", e.target.value)} placeholder="Nutrition assessment and counseling" />
              </Field>
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents (optional)</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Patient records (labs, prior notes, ECG/X-ray images) become chart items the student can request. Reference
                material (guidelines, syllabus) shapes objectives and grading; the patient never sees it.
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {files.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <span className="flex-1 truncate">{f.file.name}</span>
                    <select
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                      value={f.kind}
                      onChange={(e) => setFiles((fs) => fs.map((x, j) => (j === i ? { ...x, kind: e.target.value as DocKind } : x)))}
                    >
                      <option value="patient_record">About this patient</option>
                      <option value="reference">Reference material</option>
                    </select>
                    <button className={btn.small} type="button" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <input
                type="file"
                multiple
                className="mt-2 text-sm"
                accept=".pdf,.docx,.txt,.csv,.json,.md,.png,.jpg,.jpeg,.webp,.gif"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []).map((file) => ({
                    file,
                    kind: (/\.(png|jpe?g|webp|gif)$/i.test(file.name) ? "patient_record" : "reference") as DocKind,
                  }));
                  setFiles((fs) => [...fs, ...picked]);
                  e.target.value = "";
                }}
              />
            </div>

            {rubrics.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra checklist rubrics</p>
                <div className="mt-2 flex flex-wrap gap-3">
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
              </div>
            )}

            <div className="mt-6 flex items-center gap-4">
              <button className={btn.primary} type="button" onClick={generate} disabled={busy}>
                {busy ? "Building patient…" : "Generate patient"}
              </button>
              {busy && <Spinner label={`Usually 30–90 seconds · ${elapsed}s`} />}
            </div>
          </Card>
        )}

        <Card
          title="Your patients"
          hint="Drafts can be previewed by you only. Publish a patient to assign it to students."
          right={
            <button className={btn.ghost} type="button" onClick={importSamples}>
              Load the 8 sample patients
            </button>
          }
        >
          {patients === null ? (
            <Spinner label="Loading…" />
          ) : patients.length === 0 ? (
            <p className="text-sm text-slate-500">No patients yet. Create one, or load the 8 sample patients.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {patients.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/studio/patient?id=${encodeURIComponent(p.id)}`}
                    className="flex gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
                  >
                    <Thumb name={p.name} portrait={p.portrait} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{p.name}</span>
                        <Pill tone={p.status === "published" ? "green" : "amber"}>{p.status === "published" ? "Published" : "Draft"}</Pill>
                      </div>
                      <p className="text-xs text-slate-500">
                        {[p.age && `${p.age} y/o`, p.sex, p.primary_diagnosis].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
