"use client";

// Create a patient (POST /patients/generate) or edit a draft's description and rebuild it
// (POST /patients/{id}/regenerate). Opened from the library and from inside a class.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type FacultyInput, type PatientProfile, type Rubric, type UploadDoc } from "@/lib/api";
import { Field, Spinner, btn, input } from "./AppShell";
import { DocsPicker, RolePicker, docsReady } from "./Forms";

const EMPTY: FacultyInput = {
  name: "",
  age: null,
  gender: "",
  ethnicity: "",
  background: "",
  personality: "",
  notes: "",
  summary: "",
  student_role: "Medical student",
  encounter_goal: "",
};

export function briefFromPatient(p: PatientProfile): FacultyInput {
  const b = p.faculty_brief;
  return {
    name: p.persona.name,
    age: p.persona.age ?? null,
    gender: (p.persona.sex ?? "").toLowerCase(),
    ethnicity: (p.persona.ethnicity as string) || "",
    background: b?.background || "",
    personality: b?.personality || p.persona.personality || "",
    notes: b?.notes || "",
    summary: b?.summary || p.primary_diagnosis || "",
    student_role: p.settings.student_role,
    encounter_goal: p.settings.encounter_goal,
  };
}

export default function CreatePatientDialog({
  onClose,
  onDone,
  classId,
  className,
  editing,
  defaultRole,
}: {
  onClose: () => void;
  onDone: (p: PatientProfile) => void;
  classId?: string | null;
  className?: string | null;
  editing?: PatientProfile | null;
  defaultRole?: string;
}) {
  const [form, setForm] = useState<FacultyInput>(() =>
    editing ? briefFromPatient(editing) : { ...EMPTY, student_role: defaultRole || EMPTY.student_role },
  );
  const [docs, setDocs] = useState<UploadDoc[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [checklists, setChecklists] = useState<string[]>(editing?.settings.checklist_rubric_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.rubrics().then((r) => setRubrics(r.filter((x) => x.type !== "domain_rubric"))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const set = (k: keyof FacultyInput, v: string) => setForm((f) => ({ ...f, [k]: k === "age" ? (v === "" ? null : Number(v)) : v }));

  const submit = async () => {
    if (!form.name?.trim()) return setError("Give the patient a name.");
    if (!form.student_role?.trim()) return setError("Choose who the student is.");
    const docErr = docsReady(docs);
    if (docErr) return setError(docErr);
    setError(null);
    setElapsed(0);
    setBusy(true);
    try {
      const r = editing ? await api.regenerate(editing.id, form, docs, checklists) : await api.generate(form, docs, checklists, classId);
      onDone(r.patient);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={editing ? "Edit description" : "Create patient"}>
      <div className="w-full max-w-[780px] rounded-[28px] bg-surface shadow-2xl">
        <div className="flex items-center gap-3 px-6 pb-2 pt-6 sm:px-8">
          <h2 className="text-2xl text-ink">{editing ? "Edit description" : "Create patient"}</h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05] disabled:opacity-40">
            <X size={20} />
          </button>
        </div>
        <p className="px-6 text-sm leading-5 text-ink-2 sm:px-8">
          {editing
            ? "Change what you wrote and the studio rebuilds the case. Edits you made to individual facts are replaced; uploaded documents are kept."
            : `Only the name is required. Type what you know; the studio fills in the rest and marks everything it added.${className ? ` The patient is added to ${className}.` : ""}`}
        </p>

        <fieldset disabled={busy} className="flex flex-col gap-6 px-6 py-6 sm:px-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="Name">
              <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Maria Lopez" autoFocus />
            </Field>
            <Field label="Age">
              <input className={input} type="number" value={form.age ?? ""} onChange={(e) => set("age", e.target.value)} />
            </Field>
            <Field label="Gender">
              <select className={input} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non-binary">Non-binary</option>
              </select>
            </Field>
          </div>
          <Field label="Clinical notes" hint="Numbers, medications and history are kept exactly as you write them.">
            <textarea className={input} rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Stage II hypertension (BP 155/110). BMI 34. Takes lisinopril but often skips doses." />
          </Field>
          <Field
            label="Diagnosis the student should reach"
            hint="The answer key. Students never see it in the chart, and the patient won't say it; they have to work it out from the interview."
          >
            <input className={input} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Hypertension, obesity" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Who the student is">
              <RolePicker value={form.student_role ?? ""} onChange={(v) => set("student_role", v)} />
            </Field>
            <Field label="Encounter goal (optional)">
              <input className={input} value={form.encounter_goal} onChange={(e) => set("encounter_goal", e.target.value)} placeholder="Focused history for a new complaint" />
            </Field>
            <Field label="Life and background">
              <input className={input} value={form.background} onChange={(e) => set("background", e.target.value)} placeholder="Works night shifts, lives with two kids" />
            </Field>
            <Field label="Personality">
              <input className={input} value={form.personality} onChange={(e) => set("personality", e.target.value)} placeholder="Guarded, embarrassed about her weight" />
            </Field>
            <Field label="Cultural background">
              <input className={input} value={form.ethnicity} onChange={(e) => set("ethnicity", e.target.value)} />
            </Field>
          </div>

          <div>
            <p className="text-[15px] font-medium text-ink">{editing ? "Add documents" : "Documents"}</p>
            <p className="mb-3 mt-0.5 text-sm leading-5 text-ink-2">
              Records about this patient become chart items students can ask for. Reference material shapes the learning objectives and grading and is never shown to students.
            </p>
            <DocsPicker docs={docs} onChange={setDocs} />
            {editing && editing.documents.length > 0 && (
              <p className="mt-2 text-xs text-ink-3">Already attached: {editing.documents.map((d) => d.name).join(", ")}</p>
            )}
          </div>

          {rubrics.length > 0 && (
            <div>
              <p className="text-[15px] font-medium text-ink">Extra checklist rubrics</p>
              <div className="mt-2 flex flex-col gap-2">
                {rubrics.map((r) => (
                  <label key={r.id} className="flex items-center gap-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#0b57d0]"
                      checked={checklists.includes(r.id)}
                      onChange={(e) => setChecklists((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))}
                    />
                    {r.title}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 sm:px-8">
          {error && <span className="text-sm text-danger">{error}</span>}
          {busy && <Spinner label={`Writing the case and checking it. Usually 30 to 90 seconds (${elapsed}s).`} />}
          <div className="ml-auto flex gap-2">
            <button type="button" className={btn.text} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={btn.primary} onClick={submit} disabled={busy}>
              {busy ? (editing ? "Rebuilding" : "Creating") : editing ? "Rebuild patient" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
