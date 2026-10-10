"use client";

// Student portal: enter a demo NetID, see assigned patients. Only the patient's
// name and the year level are shown here; nothing clinical. Students find that
// out by talking to the patient.

import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell, { Card, ErrorNote, Pill, Spinner, btn } from "../components/AppShell";
import { api, type Assignment, type EncounterRow } from "@/lib/api";
import NetIdGate from "../components/NetIdGate";
import { setActiveNetId, useActiveNetId } from "@/lib/identity";

export default function StudentPage() {
  const netId = useActiveNetId();
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [attempts, setAttempts] = useState<EncounterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!netId) return;
    Promise.all([api.assignments({ student_id: netId }), api.encounters({ student_id: netId })])
      .then(([a, e]) => {
        setItems(a);
        setAttempts(e);
      })
      .catch((e) => setError(e.message));
  }, [netId]);

  if (!netId)
    return (
      <AppShell title="My Assignments">
        <NetIdGate />
      </AppShell>
    );

  return (
    <AppShell
      title="My Assignments"
      actions={
        <span className="hidden text-sm text-slate-500 sm:inline">
          NetID <b className="font-mono text-slate-800">{netId}</b>{" "}
          <button className="ml-1 text-xs text-teal-700 hover:underline" type="button" onClick={() => setActiveNetId("")}>
            change
          </button>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorNote error={error} />
        <Card title="Before you start" hint="This is a voice encounter, like a real visit.">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Use Chrome or Edge, and allow the microphone and camera when asked.</li>
            <li>Hold the talk button (or the space bar) while you speak, then let go. The patient answers out loud.</li>
            <li>There is no script and no captions. The chart fills in only with what you find out by asking.</li>
            <li>Your camera is only a mirror for you. No audio or video is recorded; only the words of the conversation are saved for feedback.</li>
          </ul>
        </Card>

        {items === null ? (
          <Spinner label="Loading your assignments…" />
        ) : items.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-500">No assignments yet for {netId}. Ask your instructor to assign you a patient.</p>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {items.map((a) => {
              const mine = attempts.filter((e) => e.assignment_id === a.id && !e.preview);
              const left = a.max_attempts ? Math.max(0, a.max_attempts - mine.length) : null;
              return (
                <li key={a.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{a.patient_name}</h3>
                    <Pill tone="teal">{a.level}</Pill>
                  </div>
                  <p className="text-xs text-slate-500">{a.level_label}</p>
                  {a.instructions && <p className="mt-2 text-sm text-slate-700">{a.instructions}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {a.due_date ? `Due ${a.due_date} · ` : ""}
                    {left === null ? "Unlimited attempts" : `${left} attempt${left === 1 ? "" : "s"} left`} · {mine.length} done
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {left === 0 ? (
                      <span className={btn.ghost}>No attempts left</span>
                    ) : (
                      <Link className={btn.primary} href={`/encounter?assignment=${encodeURIComponent(a.id)}`}>
                        Start encounter
                      </Link>
                    )}
                    {mine.some((e) => e.status === "completed") && (
                      <Link className={btn.ghost} href="/feedback">
                        My feedback
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
