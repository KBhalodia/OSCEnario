"use client";

// ---------------------------------------------------------------------------
// AppShell: the sidebar + top bar every portal page sits in (from the
// frontend-upload dashboard). The Professor/Student toggle is a demo switch,
// not authentication.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useRole, type Role } from "@/lib/useRole";

type NavItem = { label: string; href: string; emoji: string; description: string };

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  professor: [
    { label: "Dashboard", href: "/", emoji: "🏠", description: "Your teaching overview." },
    { label: "Patient Studio", href: "/studio", emoji: "🧑‍⚕️", description: "Create, review and publish virtual patients." },
    { label: "Assignments & Results", href: "/professor/results", emoji: "📊", description: "See every attempt and review feedback." },
  ],
  student: [
    { label: "Dashboard", href: "/", emoji: "🏠", description: "Your practice overview." },
    { label: "My Assignments", href: "/student", emoji: "🩺", description: "Patients your faculty assigned to you." },
    { label: "My Feedback", href: "/feedback", emoji: "📝", description: "Feedback from your past encounters." },
  ],
};

export default function AppShell({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { role, setRole } = useRole();
  const pathname = usePathname();
  const router = useRouter();
  const navItems = NAV_BY_ROLE[role];

  const switchRole = (r: Role) => {
    setRole(r);
    if (pathname !== "/") router.push("/");
  };

  return (
    <div className="flex min-h-screen flex-1 bg-slate-50 font-sans text-slate-900">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-[#0f2a4a] text-white md:flex">
        <Link href="/" className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">TV</span>
          <span className="text-lg font-semibold">
            Twin<span className="text-teal-300">verse</span>
          </span>
        </Link>
        <nav className="flex-1 px-3 py-2">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {role === "professor" ? "Faculty" : "Student"}
          </p>
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                      (active ? "bg-white/15 text-white" : "text-slate-200 hover:bg-white/10 hover:text-white")
                    }
                  >
                    <span aria-hidden="true">{item.emoji}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="px-5 py-4 text-xs text-slate-400">Demo mode · no login required</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">TV</span>
          </Link>
          <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
          <div className="flex items-center gap-3">
            {actions}
            <RoleToggle role={role} onChange={switchRole} />
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              {item.emoji} {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function RoleToggle({ role, onChange }: { role: Role; onChange: (role: Role) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Switch between Professor and Student view">
      {(["professor", "student"] as const).map((option) => {
        const active = role === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            className={
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 " +
              (active ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:text-teal-700")
            }
          >
            {option === "professor" ? "Professor" : "Student"}
          </button>
        );
      })}
    </div>
  );
}

// ---- small shared UI bits ---------------------------------------------------

export function Card({ title, hint, children, right }: { title?: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
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
  return <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>;
}

export const btn = {
  primary:
    "inline-flex h-10 items-center justify-center rounded-full bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300",
  ghost:
    "inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex h-10 items-center justify-center rounded-full bg-rose-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50",
  small:
    "inline-flex h-8 items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50",
};

export const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "teal" | "amber" | "rose" | "green" | "blue" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    teal: "bg-teal-100 text-teal-800",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-700",
    green: "bg-emerald-100 text-emerald-800",
    blue: "bg-sky-100 text-sky-800",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      {label}
    </span>
  );
}
