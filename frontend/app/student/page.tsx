"use client";

// Student: assigned patients. Only the patient's name, portrait and year level
// show here; students find out everything else by talking to the patient.

import { useEffect, useState } from "react";
import { Camera, Mic, ShieldCheck } from "lucide-react";
import AppShell, { Empty, ErrorNote, Spinner, btn } from "../components/AppShell";
import AssignmentGrid from "../components/AssignmentGrid";
import NetIdGate from "../components/NetIdGate";
import { api, type Assignment, type EncounterRow } from "@/lib/api";
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
        setAttempts(e.filter((x) => !x.preview));
      })
      .catch((e) => setError(e.message));
  }, [netId]);

  if (!netId)
    return (
      <AppShell crumb="Assignments">
        <div className="mx-auto max-w-md pt-10">
          <NetIdGate />
        </div>
      </AppShell>
    );

  return (
    <AppShell
      title="To do"
      crumb="To do"
      actions={
        <span className="text-sm text-ink-2">
          Signed in as <span className="font-mono text-ink">{netId}</span>
          <button className={btn.text + " ml-1 h-8"} type="button" onClick={() => setActiveNetId("")}>
            Switch
          </button>
        </span>
      }
    >
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
        <ErrorNote error={error} />
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-shell p-5 text-sm text-ink-2 md:grid-cols-3">
          <p className="flex gap-3">
            <Mic size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-primary" />
            Hold the talk button or the space bar while you speak. The patient answers out loud, with no captions.
          </p>
          <p className="flex gap-3">
            <Camera size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-primary" />
            Use Chrome or Edge and allow the camera and microphone. Your camera is only a mirror for you.
          </p>
          <p className="flex gap-3">
            <ShieldCheck size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-primary" />
            Nothing is recorded. Only the words of the conversation are saved, for your feedback.
          </p>
        </div>
        {items === null ? (
          <Spinner label="Loading your assignments" />
        ) : items.length === 0 ? (
          <Empty title="No patients assigned yet">Your instructor will assign you a patient. It will show up here.</Empty>
        ) : (
          <AssignmentGrid items={items} attempts={attempts} />
        )}
      </div>
    </AppShell>
  );
}
