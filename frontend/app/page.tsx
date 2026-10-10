"use client";

// Dashboard: role-specific welcome + quick actions (Professor/Student toggle in the top bar).
import Link from "next/link";
import AppShell, { NAV_BY_ROLE } from "./components/AppShell";
import { useRole } from "@/lib/useRole";

export default function Home() {
  const { role } = useRole();
  const isProfessor = role === "professor";
  const actions = NAV_BY_ROLE[role].filter((n) => n.href !== "/");

  return (
    <AppShell title="Dashboard">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-800">
          {isProfessor ? "Professor view" : "Student view"}
        </span>
        <h2 className="mt-3 text-2xl font-bold text-slate-900">
          {isProfessor ? "Welcome back, Professor" : "Welcome back"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          {isProfessor
            ? "Describe a patient in a few lines, review what the AI builds, publish it, and assign it to a year level. Every student attempt is graded against the encounter rubric and your learning objectives."
            : "Talk to your assigned patient out loud, the way you would in clinic. Nothing about the case is shown up front: you find it out by asking. When you finish, you get rubric feedback with quotes from your own interview."}
        </p>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-2xl">
              <span aria-hidden="true">{a.emoji}</span>
            </div>
            <h3 className="mt-3 text-base font-semibold text-slate-900">{a.label}</h3>
            <p className="mt-1 flex-1 text-sm leading-6 text-slate-600">{a.description}</p>
            <span className="mt-4 text-sm font-medium text-teal-600">Open →</span>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
