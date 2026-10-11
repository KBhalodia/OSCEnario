"use client";

// Shared form pieces: the student-role picker and the labelled document picker.

import { useState } from "react";
import { FileUp, X } from "lucide-react";
import { DOC_TYPES, REFERENCE_TYPES, STUDENT_ROLES, type UploadDoc } from "@/lib/api";
import { input } from "./AppShell";

/** Dropdown of common roles; "Other" opens a text box. */
export function RolePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = STUDENT_ROLES.includes(value);
  const [other, setOther] = useState(!known && value !== "");
  return (
    <div className="flex flex-col gap-2">
      <select
        className={input}
        value={other ? "__other" : value}
        onChange={(e) => {
          if (e.target.value === "__other") {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="" disabled>
          Choose a role
        </option>
        {STUDENT_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value="__other">Other</option>
      </select>
      {other && <input className={input} autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="Describe the student's role" />}
    </div>
  );
}

const guessType = (name: string) => {
  const n = name.toLowerCase();
  if (/ecg|ekg/.test(n)) return "ecg";
  if (/x-?ray|ct|mri|ultrasound|scan/.test(n)) return "imaging";
  if (/lab|cbc|bmp|cmp|panel|a1c|lipid/.test(n)) return "lab_report";
  if (/med|rx/.test(n)) return "medication_list";
  if (/guideline|protocol/.test(n)) return "guideline";
  if (/syllabus|lecture|course/.test(n)) return "syllabus";
  if (/\.(png|jpe?g|webp|gif)$/.test(n)) return "imaging";
  return "";
};

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

const stem = (name: string) => name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");

/** Big, obvious file picker; every file gets a name, a type and an optional summary. */
export function DocsPicker({ docs, onChange, compact = false }: { docs: UploadDoc[]; onChange: (d: UploadDoc[]) => void; compact?: boolean }) {
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => {
    if (!list) return;
    onChange([...docs, ...Array.from(list).map((file) => ({ file, name: stem(file.name), type: guessType(file.name), summary: "" }))]);
  };
  const patch = (i: number, change: Partial<UploadDoc>) => onChange(docs.map((d, j) => (j === i ? { ...d, ...change } : d)));

  return (
    <div className="flex flex-col gap-3">
      {docs.map((d, i) => (
        <div key={i} className="rounded-xl border border-line p-4">
          <div className="flex items-start gap-3">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-ink-2">Name students will see</span>
                <input className={input} value={d.name} onChange={(e) => patch(i, { name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-ink-2">Type</span>
                <select className={input + (d.type ? "" : " text-ink-3")} value={d.type} onChange={(e) => patch(i, { type: e.target.value })}>
                  <option value="" disabled>
                    Choose a type
                  </option>
                  <optgroup label="About this patient (becomes a chart item)">
                    {DOC_TYPES.filter((t) => !t.reference).map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Reference material (never shown to students)">
                    {DOC_TYPES.filter((t) => t.reference).map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[13px] font-medium text-ink-2">{IMAGE_RE.test(d.file.name) ? "Your read of this image (optional)" : "Summary (optional)"}</span>
                <input
                  className={input}
                  value={d.summary}
                  onChange={(e) => patch(i, { summary: e.target.value })}
                  placeholder={
                    REFERENCE_TYPES.has(d.type)
                      ? "What graders should use it for"
                      : IMAGE_RE.test(d.file.name)
                        ? "e.g. Left lower lobe consolidation"
                        : "What it shows, for the case writer and graders"
                  }
                />
                {IMAGE_RE.test(d.file.name) && (
                  <span className="text-xs leading-4 text-ink-3">The AI doesn&apos;t read images. Your read guides the case and grading; students only see the image.</span>
                )}
              </label>
            </div>
            <button
              type="button"
              aria-label={`Remove ${d.file.name}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]"
              onClick={() => onChange(docs.filter((_, j) => j !== i))}
            >
              <X size={18} />
            </button>
          </div>
          <p className="mt-2 truncate text-xs text-ink-3">{d.file.name}</p>
        </div>
      ))}

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors " +
          (compact ? "px-4 py-5 " : "px-6 py-8 ") +
          (drag ? "border-primary bg-[#f0f4fc]" : "border-[#c4c7c5] hover:border-primary hover:bg-[#f8fafd]")
        }
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-on-primary-soft">
          <FileUp size={22} />
        </span>
        <span className="text-[15px] font-medium text-primary">{docs.length ? "Add more files" : "Choose files"}</span>
        <span className="text-xs text-ink-2">or drag them here. PDF, Word, text, CSV or images (ECG, X-ray, scanned labs). Up to 15 MB each.</span>
        <input
          type="file"
          multiple
          className="sr-only"
          accept=".pdf,.docx,.txt,.csv,.json,.md,.png,.jpg,.jpeg,.webp,.gif"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

export function docsReady(docs: UploadDoc[]): string | null {
  const missing = docs.filter((d) => !d.type);
  if (missing.length) return `Choose a type for ${missing.map((d) => d.name || d.file.name).join(", ")}.`;
  return null;
}
