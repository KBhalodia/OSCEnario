"use client";

import { Pill } from "./AppShell";

// M3/M4 end-of-visit diagnosis result, as a small label.
export default function DiagnosisPill({ verdict }: { verdict?: string | null }) {
  if (!verdict) return <span className="text-ink-3">Not asked</span>;
  const map: Record<string, [string, "green" | "amber" | "rose" | "slate"]> = {
    correct: ["Correct", "green"],
    partially_correct: ["Partly correct", "amber"],
    incorrect: ["Missed", "rose"],
    not_answered: ["No answer", "slate"],
    not_graded: ["Not graded", "slate"],
  };
  const [label, tone] = map[verdict] ?? [verdict, "slate"];
  return <Pill tone={tone}>{label}</Pill>;
}
