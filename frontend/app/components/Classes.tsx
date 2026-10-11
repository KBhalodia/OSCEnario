"use client";

// Class cards and dialogs. A class groups patients and students; students join with its code.
// The card shows the class's patients as a row of faces: you can see who's in the class at a glance.

import Link from "next/link";
import { useState } from "react";
import { Copy, Users, X } from "lucide-react";
import { api, type ClassCard } from "@/lib/api";
import { FACULTY_ID } from "@/lib/identity";
import { bannerColor } from "./Banner";
import { Field, btn, input } from "./AppShell";
import { RolePicker } from "./Forms";
import Thumb from "./Thumb";

function Trace() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 420 120" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 76 H230 l8 -6 l6 6 l6 0 l7 -38 l8 64 l6 -26 l5 0 l8 -8 l8 8 H420" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx="380" cy="-10" r="90" fill="#fff" fillOpacity="0.06" />
    </svg>
  );
}

export function ClassCardView({ c, href, faculty }: { c: ClassCard; href: string; faculty: boolean }) {
  const faces = c.patients.slice(0, 5);
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow hover:shadow-[0_1px_3px_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)]">
      <Link href={href} className="relative block h-[100px] overflow-hidden px-4 py-3.5 text-white" style={{ background: bannerColor(c.id) }}>
        <Trace />
        <p className="relative truncate text-[22px] leading-7 hover:underline">{c.name}</p>
        {c.section && <p className="relative truncate text-sm text-white/90">{c.section}</p>}
      </Link>
      <Link href={href} className="flex min-h-[112px] flex-1 flex-col justify-center px-4 py-4">
        {faces.length ? (
          <>
            <div className="flex -space-x-3">
              {faces.map((p) => (
                <span key={p.id} className="rounded-full ring-2 ring-white" title={p.name}>
                  <Thumb name={p.name} portrait={p.portrait} size={44} />
                </span>
              ))}
              {c.patients.length > faces.length && (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e8eaed] text-[13px] font-medium text-ink-2 ring-2 ring-white">
                  +{c.patients.length - faces.length}
                </span>
              )}
            </div>
            <p className="mt-2.5 text-sm text-ink-2">
              {c.patients.length} patient{c.patients.length === 1 ? "" : "s"}
              {faculty ? `, ${c.assignment_count} assignment${c.assignment_count === 1 ? "" : "s"}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2">{faculty ? "No patients yet. Open the class to add or create one." : "Nothing assigned yet."}</p>
        )}
      </Link>
      <div className="flex min-h-[52px] items-center gap-2 border-t border-line px-4 text-[13px] text-ink-2">
        {faculty ? (
          <>
            <Users size={16} strokeWidth={1.75} />
            {c.student_count} student{c.student_count === 1 ? "" : "s"}
            <span className="ml-auto">
              Class code <span className="font-mono text-ink">{c.code}</span>
            </span>
          </>
        ) : (
          <span>{c.student_role || "Student"}</span>
        )}
      </div>
    </div>
  );
}

export function CodeCard({ code, onReset }: { code: string; onReset?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line p-5">
      <p className="text-[15px] font-medium text-ink">Class code</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-[28px] tracking-wide text-primary">{code}</span>
        <button
          type="button"
          title="Copy code"
          aria-label="Copy class code"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]"
        >
          <Copy size={18} />
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">{copied ? "Copied." : "Students enter this on their home page to join."}</p>
      {onReset && (
        <button type="button" className={btn.text + " -ml-3 mt-1 h-8"} onClick={onReset}>
          Make a new code
        </button>
      )}
    </div>
  );
}

function Dialog({ title, children, onClose, footer }: { title: string; children: React.ReactNode; onClose: () => void; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-12" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-[520px] rounded-[28px] bg-surface shadow-2xl">
        <div className="flex items-center px-6 pb-2 pt-6">
          <h2 className="text-2xl text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]">
            <X size={20} />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-4">{children}</div>
        <div className="flex justify-end gap-2 px-6 pb-6 pt-2">{footer}</div>
      </div>
    </div>
  );
}

export function CreateClassDialog({ onClose, onDone, editing }: { onClose: () => void; onDone: (c: ClassCard) => void; editing?: ClassCard }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [section, setSection] = useState(editing?.section ?? "");
  const [role, setRole] = useState(editing?.student_role ?? "Medical student");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError("Give the class a name.");
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), section, description, student_role: role };
      onDone(editing ? await api.updateClass(editing.id, body) : await api.createClass({ ...body, created_by: FACULTY_ID }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={editing ? "Edit class" : "Create class"}
      onClose={onClose}
      footer={
        <>
          {error && <span className="mr-auto self-center text-sm text-danger">{error}</span>}
          <button type="button" className={btn.text} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.primary} onClick={submit} disabled={busy}>
            {editing ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <Field label="Class name">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Clinical Skills II" autoFocus />
      </Field>
      <Field label="Section (optional)">
        <input className={input} value={section} onChange={(e) => setSection(e.target.value)} placeholder="Fall 2026, small group B" />
      </Field>
      <Field label="Students in this class are" hint="Used as the default when you create patients here.">
        <RolePicker value={role} onChange={setRole} />
      </Field>
      <Field label="Description (optional)">
        <textarea className={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Dialog>
  );
}

export function JoinClassDialog({ netId, onClose, onDone }: { netId: string; onClose: () => void; onDone: (c: ClassCard) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const join = async () => {
    setError(null);
    try {
      onDone(await api.joinClass(code, netId));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      title="Join class"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn.text} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.primary} onClick={join} disabled={code.trim().length < 5}>
            Join
          </button>
        </>
      }
    >
      <p className="text-sm leading-5 text-ink-2">Ask your instructor for the class code, then enter it here.</p>
      <Field label="Class code">
        <input
          className={input + " font-mono text-lg tracking-wide"}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && code.trim().length >= 5 && join()}
          placeholder="abc2xyz"
          autoFocus
        />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-ink-3">Joining as {netId}</p>
    </Dialog>
  );
}
