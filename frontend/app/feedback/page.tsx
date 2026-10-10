"use client";

// Student: every past encounter for this NetID, and the full report for one.
//   /feedback                 list
//   /feedback?encounter=<id>  one report + transcript

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AppShell, { Card, ErrorNote, Pill, Spinner } from "../components/AppShell";
import FeedbackReport from "../components/FeedbackReport";
import NetIdGate from "../components/NetIdGate";
import { api, type EncounterDetail, type EncounterRow } from "@/lib/api";
import { useActiveNetId } from "@/lib/identity";

export default function FeedbackPage() {
  return (
    <Suspense fallback={<AppShell title="My Feedback"><Spinner label="Loading…" /></AppShell>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const netId = useActiveNetId();
  const encounterId = useSearchParams().get("encounter");
  if (!netId)
    return (
      <AppShell title="My Feedback">
        <NetIdGate />
      </AppShell>
    );
  return encounterId ? <One id={encounterId} /> : <List netId={netId} />;
}

function List({ netId }: { netId: string }) {
  const [rows, setRows] = useState<EncounterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .encounters({ student_id: netId })
      .then((r) => setRows(r.filter((x) => !x.preview)))
      .catch((e) => setError(e.message));
  }, [netId]);

  return (
    <AppShell title="My Feedback">
      <ErrorNote error={error} />
      {rows === null ? (
        <Spinner label="Loading…" />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No encounters yet. <Link className="text-teal-700 underline" href="/student">Start one from your assignments.</Link>
          </p>
        </Card>
      ) : (
        <Card title={`Encounters for ${netId}`}>
          <ul className="flex flex-col divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-medium text-slate-900">{r.patient_name || "Patient"}</span>
                <Pill tone="teal">{r.level}</Pill>
                <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span>
                <span className="ml-auto flex items-center gap-3">
                  {r.status === "completed" ? (
                    <>
                      <span className="text-sm font-semibold text-slate-800">
                        {r.total}/{r.max_total}
                      </span>
                      <Link className="text-sm text-teal-700 hover:underline" href={`/feedback?encounter=${r.id}`}>
                        View feedback
                      </Link>
                    </>
                  ) : (
                    <Pill tone={r.status === "grading_failed" ? "rose" : "amber"}>{r.status === "grading_failed" ? "Grading failed" : "Not finished"}</Pill>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}

function One({ id }: { id: string }) {
  const [d, setD] = useState<EncounterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .encounter(id)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <AppShell title="My Feedback">
      <Link href="/feedback" className="text-sm text-teal-700 hover:underline">
        ← All encounters
      </Link>
      <div className="mt-4">
        <ErrorNote error={error} />
        {!d ? (
          !error && <Spinner label="Loading…" />
        ) : d.feedback ? (
          <FeedbackReport fb={d.feedback} transcript={d.transcript} />
        ) : (
          <Card>
            <p className="text-sm text-slate-500">This encounter hasn&apos;t been graded yet.</p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
