"use client";

// ---------------------------------------------------------------------------
// DashboardShell — the Twinverse main dashboard
// ---------------------------------------------------------------------------
// Canvas-inspired layout with our own branding:
//   - a left sidebar with role-specific navigation,
//   - a top bar with the brand and a Professor/Student toggle,
//   - a main area whose content changes with the selected role.
//
// Everything here is client-side: the role toggle is interactive and persists
// in localStorage. We deliberately keep the existing Studio and Encounter
// pages untouched — this just links to them.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRole, type Role } from "./useRole";

// One navigation entry. `href` is null for placeholder items that aren't built
// yet (Student Results, My Feedback) — those render as disabled.
type NavItem = {
  label: string;
  href: string | null;
  emoji: string;
  description: string;
};

// The nav items for each role. Dashboard is always "/".
const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  professor: [
    {
      label: "Dashboard",
      href: "/",
      emoji: "🏠",
      description: "Your teaching overview.",
    },
    {
      label: "Patient Studio",
      href: "/studio",
      emoji: "🧑‍⚕️",
      description: "Build and publish virtual patients.",
    },
    {
      label: "Student Results",
      href: "/professor/results",
      emoji: "📊",
      description: "Review completed student encounters.",
    },
  ],
  student: [
    {
      label: "Dashboard",
      href: "/",
      emoji: "🏠",
      description: "Your practice overview.",
    },
    {
      label: "Available Encounters",
      href: "/encounter",
      emoji: "💬",
      description: "Interview virtual patients.",
    },
    {
      label: "My Feedback",
      href: "/feedback",
      emoji: "📝",
      description: "Review feedback from your past encounters.",
    },
  ],
};

export default function DashboardShell() {
  const { role, setRole } = useRole();
  const navItems = NAV_BY_ROLE[role];

  return (
    <div className="flex min-h-full flex-1 bg-slate-50 font-sans text-slate-900">
      {/* ============================ SIDEBAR ============================ */}
      {/* Hidden on small screens (nav collapses into the main area instead). */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-[#0f2a4a] text-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">
            TV
          </span>
          <span className="text-lg font-semibold">
            Twin<span className="text-teal-300">verse</span>
          </span>
        </div>

        <nav className="flex-1 px-3 py-2">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {role === "professor" ? "Faculty" : "Student"}
          </p>
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.label}>
                <SidebarLink item={item} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="px-5 py-4 text-xs text-slate-400">
          Demo mode · no login required
        </div>
      </aside>

      {/* ============================= MAIN ============================= */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          {/* Brand (shown on small screens where the sidebar is hidden). */}
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
              TV
            </span>
            <span className="text-base font-semibold text-slate-900">
              Twin<span className="text-teal-600">verse</span>
            </span>
          </Link>

          <h1 className="hidden text-lg font-semibold text-slate-900 md:block">
            Dashboard
          </h1>

          {/* Professor / Student toggle */}
          <RoleToggle role={role} onChange={setRole} />
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* On small screens, show the role nav as cards since the sidebar is
              hidden. */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
            {navItems.map((item) => (
              <MobileNavCard key={item.label} item={item} />
            ))}
          </div>

          <DashboardBody role={role} />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar link: a real Link when it has an href, otherwise a disabled
// placeholder with a "Soon" badge.
// ---------------------------------------------------------------------------
function SidebarLink({ item }: { item: NavItem }) {
  if (!item.href) {
    return (
      <span className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400">
        <span className="flex items-center gap-2">
          <span aria-hidden="true">{item.emoji}</span>
          {item.label}
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          Soon
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
    >
      <span aria-hidden="true">{item.emoji}</span>
      {item.label}
    </Link>
  );
}

// A nav card used on small screens where the sidebar is hidden.
function MobileNavCard({ item }: { item: NavItem }) {
  const inner = (
    <>
      <span className="text-xl" aria-hidden="true">
        {item.emoji}
      </span>
      <span className="mt-1 text-sm font-semibold text-slate-900">
        {item.label}
      </span>
      <span className="mt-0.5 text-xs text-slate-500">{item.description}</span>
    </>
  );

  if (!item.href) {
    return (
      <div className="flex flex-col rounded-xl border border-dashed border-slate-200 bg-white p-4 opacity-70">
        {inner}
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Coming soon
        </span>
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
    >
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Role toggle: two segmented buttons. Switching updates everything instantly
// and saves to localStorage (handled by the hook).
// ---------------------------------------------------------------------------
function RoleToggle({
  role,
  onChange,
}: {
  role: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 p-1"
      role="group"
      aria-label="Switch between Professor and Student view"
    >
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
              (active
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-600 hover:text-teal-700")
            }
          >
            {option === "professor" ? "Professor" : "Student"}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard body: role-specific welcome + quick-action cards.
// ---------------------------------------------------------------------------
function DashboardBody({ role }: { role: Role }) {
  const isProfessor = role === "professor";

  return (
    <div>
      {/* Welcome banner */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-800">
          {isProfessor ? "Professor view" : "Student view"}
        </span>
        <h2 className="mt-3 text-2xl font-bold text-slate-900">
          {isProfessor
            ? "Welcome back, Professor"
            : "Welcome back, Student"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          {isProfessor
            ? "Design virtual patient cases, publish them for your students, and review how learners perform."
            : "Practice clinical interviews with virtual patients in a safe space, then review your feedback."}
        </p>
      </section>

      {/* Quick actions */}
      <section className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Quick actions
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(isProfessor ? PROFESSOR_ACTIONS : STUDENT_ACTIONS).map((action) => (
            <ActionCard key={action.title} action={action} />
          ))}
        </div>
      </section>
    </div>
  );
}

// A quick-action card. `href` null = placeholder (not yet built).
type QuickAction = {
  title: string;
  description: string;
  emoji: string;
  href: string | null;
  cta: string;
};

const PROFESSOR_ACTIONS: QuickAction[] = [
  {
    title: "Open Patient Studio",
    description: "Create a new virtual patient or edit an existing case.",
    emoji: "🧑‍⚕️",
    href: "/studio",
    cta: "Go to Studio",
  },
  {
    title: "Student Results",
    description: "See how your students performed on each encounter.",
    emoji: "📊",
    href: "/professor/results",
    cta: "View Results",
  },
  {
    title: "Preview an encounter",
    description: "Try a published patient the way a student would.",
    emoji: "💬",
    href: "/encounter",
    cta: "Open Encounter",
  },
];

const STUDENT_ACTIONS: QuickAction[] = [
  {
    title: "Start an encounter",
    description: "Interview a virtual patient and practice your reasoning.",
    emoji: "💬",
    href: "/encounter",
    cta: "Go to Encounters",
  },
  {
    title: "My Feedback",
    description: "Review strengths and areas to improve after each session.",
    emoji: "📝",
    href: "/feedback",
    cta: "View Feedback",
  },
  {
    title: "Practice tips",
    description: "Ask about onset, radiation, history, meds, and tests.",
    emoji: "💡",
    href: null,
    cta: "Coming soon",
  },
];

function ActionCard({ action }: { action: QuickAction }) {
  const body = (
    <>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-2xl">
        <span aria-hidden="true">{action.emoji}</span>
      </div>
      <h4 className="mt-3 text-base font-semibold text-slate-900">
        {action.title}
      </h4>
      <p className="mt-1 flex-1 text-sm leading-6 text-slate-600">
        {action.description}
      </p>
      <span
        className={
          "mt-4 text-sm font-medium " +
          (action.href ? "text-teal-600" : "text-slate-400")
        }
      >
        {action.cta} {action.href ? "→" : ""}
      </span>
    </>
  );

  if (!action.href) {
    return (
      <div className="flex flex-col rounded-2xl border border-dashed border-slate-200 bg-white p-5 opacity-80">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={action.href}
      className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
    >
      {body}
    </Link>
  );
}
