"use client";

// ---------------------------------------------------------------------------
// AppShell + shared UI primitives (OSCEnario).
// Look: calm and mostly white (Classroom-like). Shell colour behind a light
// sidebar and top bar; page content sits on a white panel. One blue accent.
// The Professor/Student switch is a demo toggle, not authentication.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  Loader2,
  Menu,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { useRole, type Role } from "@/lib/useRole";
import { api, type ClassCard } from "@/lib/api";
import { FACULTY_ID, useActiveNetId } from "@/lib/identity";
import { bannerColor } from "./Banner";

type NavItem = { label: string; href: string; icon: LucideIcon; description: string };

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  professor: [
    { label: "Home", href: "/", icon: Home, description: "Your teaching overview." },
    { label: "Patient library", href: "/studio", icon: Stethoscope, description: "Every patient you've created, across classes." },
    { label: "Results", href: "/professor/results", icon: BarChart3, description: "Every attempt, with feedback to review." },
  ],
  student: [
    { label: "Home", href: "/", icon: Home, description: "Your practice overview." },
    { label: "To do", href: "/student", icon: ClipboardList, description: "Patients your instructors assigned to you." },
    { label: "Feedback", href: "/feedback", icon: FileText, description: "Feedback from your past encounters." },
  ],
};

export default function AppShell({
  title,
  crumb,
  children,
  actions,
  tabs,
}: {
  title?: string;
  crumb?: string;
  children: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  const { role, setRole } = useRole();
  const pathname = usePathname();
  const router = useRouter();
  const netId = useActiveNetId();
  const [navOpen, setNavOpen] = useState(false);
  const [classes, setClasses] = useState<ClassCard[]>([]);

  useEffect(() => {
    const q = role === "professor" ? { created_by: FACULTY_ID } : netId ? { student_id: netId } : null;
    if (!q) return;
    api
      .classes(q)
      .then(setClasses)
      .catch(() => {});
  }, [role, netId]);

  const switchRole = (r: Role) => {
    setRole(r);
    if (pathname !== "/") router.push("/");
  };

  const nav = (
    <nav className="flex flex-col gap-0.5 py-2 pr-3">
      {NAV_BY_ROLE[role].map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setNavOpen(false)}
            className={
              "flex h-14 items-center gap-5 rounded-r-full pl-6 text-[15px] transition-colors " +
              (active ? "bg-primary-soft font-medium text-on-primary-soft" : "text-ink hover:bg-black/[0.04]")
            }
          >
            <Icon size={22} strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
      {classes.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="px-6 pb-1 text-[13px] font-medium text-ink-2">{role === "professor" ? "Teaching" : "Enrolled"}</p>
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/class?id=${c.id}`}
              onClick={() => setNavOpen(false)}
              className="flex h-14 items-center gap-4 rounded-r-full pl-5 text-sm text-ink hover:bg-black/[0.04]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white" style={{ background: bannerColor(c.id) }}>
                {c.name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{c.name}</span>
                {c.section && <span className="block truncate text-xs text-ink-2">{c.section}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-shell text-ink">
      {/* top bar */}
      <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:px-4">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setNavOpen((o) => !o)}
          className="flex h-12 w-12 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05] lg:hidden"
        >
          <Menu size={22} />
        </button>
        <Link href="/" className="flex items-center gap-2.5 pl-1 pr-2">
          <Logo />
          <Wordmark />
        </Link>
        {crumb && (
          <span className="hidden min-w-0 items-center gap-2 text-ink-2 sm:flex">
            <ChevronRight size={18} className="shrink-0 text-ink-3" />
            <span className="truncate text-[17px] text-ink">{crumb}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center rounded-full border border-line bg-white p-0.5 sm:flex" role="group" aria-label="Switch view">
            {(["professor", "student"] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => switchRole(r)}
                className={
                  "rounded-full px-3.5 py-1.5 text-sm transition-colors " +
                  (role === r ? "bg-primary-soft font-medium text-on-primary-soft" : "text-ink-2 hover:text-ink")
                }
              >
                {r === "professor" ? "Faculty" : "Student"}
              </button>
            ))}
          </div>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4d6a87] text-sm font-medium text-white"
            title={role === "professor" ? "Faculty (demo)" : netId || "Student (demo)"}
          >
            {role === "professor" ? "F" : (netId[0] ?? "S").toUpperCase()}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar: fixed on large screens, a drawer on small ones */}
        <aside className="hidden w-[280px] shrink-0 lg:block">{nav}</aside>
        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setNavOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[280px] bg-shell shadow-xl">
              <div className="flex h-16 items-center gap-2.5 px-5">
                <Logo />
                <Wordmark />
              </div>
              {nav}
              <div className="flex gap-2 px-6 pt-4">
                {(["professor", "student"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => switchRole(r)} className={btn.tonalSmall}>
                    {r === "professor" ? "Faculty view" : "Student view"}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}

        {/* content panel */}
        <main className="min-w-0 flex-1 overflow-hidden bg-surface lg:rounded-tl-[28px]">
          {(title || actions || tabs) && (
            <div className="border-b border-line px-4 sm:px-8">
              {(title || actions) && (
                <div className="flex flex-wrap items-center gap-3 pb-2 pt-5">
                  {title && <h1 className="text-[22px] text-ink">{title}</h1>}
                  {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
                </div>
              )}
              {tabs}
            </div>
          )}
          <div className="px-4 py-6 sm:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** A speech bubble with a heart-rhythm line: talking with a patient, clinically. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <path d="M6 5h22a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H15l-6.5 5.2a.6.6 0 0 1-1-.5V26H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="#0b57d0" />
      <path d="M6.5 15.5h5l1.8-3.6 3.2 8 2.4-6 1.6 1.6h7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** OSCEnario: "OSCE" carries the meaning, so it takes the colour. */
export function Wordmark() {
  return (
    <span className="text-[22px] tracking-[-0.01em]" aria-label="OSCEnario">
      <span className="font-medium text-primary">OSCE</span>
      <span className="text-ink-2">nario</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={
              "relative h-12 whitespace-nowrap px-5 text-[15px] transition-colors " +
              (on ? "font-medium text-primary" : "text-ink-2 hover:bg-black/[0.03] hover:text-ink")
            }
          >
            {t.label}
            {on && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />}
          </button>
        );
      })}
    </div>
  );
}

export function Card({
  title,
  hint,
  children,
  right,
  className = "",
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"rounded-xl border border-line bg-surface p-5 sm:p-6 " + className}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-medium text-ink">{title}</h2>}
            {hint && <p className="mt-1 text-sm leading-5 text-ink-2">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg bg-[#fce8e6] px-4 py-3 text-sm text-danger">{error}</p>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "ok" | "warn" }) {
  const tones = { info: "bg-[#e8f0fe] text-on-primary-soft", ok: "bg-[#e6f4ea] text-ok", warn: "bg-[#fef7e0] text-[#7a4f01]" };
  return <p className={`rounded-lg px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>;
}

export const btn = {
  primary:
    "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-white transition-colors hover:bg-[#0842a0] hover:shadow-sm disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/40",
  tonal:
    "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary-soft px-6 text-sm font-medium text-on-primary-soft transition-colors hover:bg-[#c2d7f8] disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[#747775] bg-white px-6 text-sm font-medium text-primary transition-colors hover:bg-[#f0f4fc] disabled:cursor-not-allowed disabled:border-line disabled:text-black/40",
  text: "inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-primary transition-colors hover:bg-[#f0f4fc] disabled:opacity-50",
  danger:
    "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-danger px-6 text-sm font-medium text-white hover:bg-[#8c1d18] disabled:opacity-50",
  small:
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[#747775] bg-white px-3.5 text-[13px] font-medium text-primary hover:bg-[#f0f4fc] disabled:opacity-50",
  tonalSmall:
    "inline-flex h-8 items-center justify-center rounded-full bg-primary-soft px-3.5 text-[13px] font-medium text-on-primary-soft hover:bg-[#c2d7f8]",
};

export const input =
  "w-full rounded-md border border-[#c4c7c5] bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-3 transition-colors hover:border-ink-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs leading-4 text-ink-3">{hint}</span>}
    </label>
  );
}

export function Pill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "teal" | "amber" | "rose" | "green" | "blue";
}) {
  const tones = {
    slate: "bg-[#f1f3f4] text-ink-2",
    teal: "bg-primary-soft text-on-primary-soft",
    blue: "bg-primary-soft text-on-primary-soft",
    amber: "bg-[#fef7e0] text-[#7a4f01]",
    rose: "bg-[#fce8e6] text-danger",
    green: "bg-[#e6f4ea] text-ok",
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      <Loader2 size={18} className="animate-spin text-primary" />
      {label}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <EmptyArt />
      <p className="mt-5 text-[17px] text-ink">{title}</p>
      {children && <p className="mt-1.5 max-w-md text-sm leading-5 text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Small line drawing: a clipboard with a heart-rhythm trace. */
function EmptyArt() {
  return (
    <svg width="132" height="96" viewBox="0 0 132 96" aria-hidden="true" fill="none" stroke="#5f6368" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="38" y="10" width="56" height="76" rx="6" fill="#fff" />
      <rect x="54" y="5" width="24" height="10" rx="3" fill="#fff" />
      <path d="M46 46h10l4-10 7 22 5-12h14" stroke="#0b57d0" strokeWidth="2" />
      <path d="M48 66h36M48 74h24" stroke="#c4c7c5" />
      <circle cx="104" cy="70" r="9" fill="#e6f4ea" stroke="#1e8e3e" />
      <path d="M100 70l3 3 5-6" stroke="#1e8e3e" />
      <path d="M18 80h96" stroke="#dadce0" />
    </svg>
  );
}
