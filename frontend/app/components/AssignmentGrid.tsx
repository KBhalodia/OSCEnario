"use client";

import Link from "next/link";
import { PatientCard } from "./Banner";
import { btn } from "./AppShell";
import type { Assignment, EncounterRow } from "@/lib/api";

// Student assignment cards (patient name, year level, due date; nothing clinical).
export default function AssignmentGrid({ items, attempts }: { items: Assignment[]; attempts: EncounterRow[] }) {
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((a) => {
        const mine = attempts.filter((e) => e.assignment_id === a.id);
        const best = mine.filter((e) => e.total != null).sort((x, y) => (y.total ?? 0) - (x.total ?? 0))[0];
        const left = a.max_attempts ? Math.max(0, a.max_attempts - mine.length) : null;
        return (
          <li key={a.id}>
            <PatientCard
              id={a.patient_id}
              href={`/encounter?assignment=${encodeURIComponent(a.id)}`}
              title={a.patient_name}
              subtitle={a.level_label}
              portrait={a.patient_portrait ?? null}
              name={a.patient_name}
              body={
                <>
                  {a.class_name && <p className="text-ink-2">{a.class_name}</p>}
                  {a.due_date && <p className="text-ink">Due {a.due_date}</p>}
                  {a.instructions && <p className="mt-1 line-clamp-2">{a.instructions}</p>}
                  {best && (
                    <p className="mt-1">
                      Best score {best.total}/{best.max_total}
                    </p>
                  )}
                </>
              }
              footer={
                <>
                  <span className="pl-1 text-[13px] text-ink-2">
                    {left === null ? "Unlimited attempts" : `${left} attempt${left === 1 ? "" : "s"} left`}
                  </span>
                  <span className="ml-auto">
                    {left === 0 ? null : (
                      <Link className={btn.text} href={`/encounter?assignment=${encodeURIComponent(a.id)}`}>
                        {mine.length ? "Try again" : "Start"}
                      </Link>
                    )}
                  </span>
                </>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
