"use client";

// Home. Faculty: what needs review, then their classes. Student: join a class, their classes,
// and what's due.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import AppShell, { Card, Empty, Pill, Spinner, btn } from "./components/AppShell";
import AssignmentGrid from "./components/AssignmentGrid";
import { ClassCardView, CreateClassDialog, JoinClassDialog } from "./components/Classes";
import NetIdGate from "./components/NetIdGate";
import { useRole } from "@/lib/useRole";
import { FACULTY_ID, useActiveNetId } from "@/lib/identity";
import { api, type Assignment, type ClassCard, type EncounterRow } from "@/lib/api";

export default function Home() {
  const { role } = useRole();
  return role === "professor" ? <FacultyHome /> : <StudentHome />;
}

type Review = { encounterId: string; student: string | null; patient: string; level: string; klass: string; score: string; flagged: boolean };

function FacultyHome() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassCard[] | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.classes({ created_by: FACULTY_ID }).then(setClasses).catch(() => setClasses([]));
    api
      .assignments()
      .then(async (as) => {
        const all = await Promise.all(as.map((a) => api.results(a.id).catch(() => null)));
        const rows: Review[] = [];
        all.forEach((r) =>
          r?.attempts
            .filter((t) => t.status === "completed")
            .forEach((t) =>
              rows.push({
                encounterId: t.encounter_id,
                student: t.student_id,
                patient: r.assignment.patient_name,
                level: r.assignment.level,
                klass: r.assignment.class_name ?? "",
                score: `${t.total}/${t.max_total}`,
                flagged: !!t.needs_review,
              }),
            ),
        );
        rows.sort((a, b) => Number(b.flagged) - Number(a.flagged));
        setReviews(rows.slice(0, 5));
      })
      .catch(() => setReviews([]));
  }, []);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8">
        <Card title="To review" hint="Completed encounters. Flagged ones scored low on safety or closure.">
          {reviews === null ? (
            <Spinner />
          ) : reviews.length === 0 ? (
            <p className="text-sm text-ink-2">Nothing to review yet. Results appear here as students finish their encounters.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {reviews.map((r) => (
                <li key={r.encounterId}>
                  <Link href={`/professor/results?encounter=${r.encounterId}`} className="flex items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-black/[0.03]">
                    <span className="w-24 font-mono text-sm text-ink">{r.student ?? "unknown"}</span>
                    <span className="flex-1 truncate text-sm text-ink-2">
                      {r.patient}, {r.level}
                      {r.klass && <span className="text-ink-3"> in {r.klass}</span>}
                    </span>
                    {r.flagged && <Pill tone="rose">Needs review</Pill>}
                    <span className="w-14 text-right text-sm font-medium text-ink">{r.score}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[22px] text-ink">Classes</h2>
            <button type="button" className={btn.text} onClick={() => setCreating(true)}>
              <Plus size={18} /> Create class
            </button>
          </div>
          {classes === null ? (
            <Spinner label="Loading classes" />
          ) : classes.length === 0 ? (
            <Empty
              title="Create your first class"
              action={
                <button type="button" className={btn.primary} onClick={() => setCreating(true)}>
                  Create class
                </button>
              }
            >
              A class holds the patients you assign and the students who join with its code.
            </Empty>
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {classes.map((c) => (
                <li key={c.id}>
                  <ClassCardView c={c} href={`/class?id=${c.id}`} faculty />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {creating && <CreateClassDialog onClose={() => setCreating(false)} onDone={(c) => router.push(`/class?id=${c.id}`)} />}
    </AppShell>
  );
}

function StudentHome() {
  const netId = useActiveNetId();
  const [classes, setClasses] = useState<ClassCard[] | null>(null);
  const [items, setItems] = useState<Assignment[]>([]);
  const [attempts, setAttempts] = useState<EncounterRow[]>([]);
  const [joining, setJoining] = useState(false);

  const load = (id: string) =>
    Promise.all([api.classes({ student_id: id }), api.assignments({ student_id: id }), api.encounters({ student_id: id })])
      .then(([c, a, e]) => {
        setClasses(c);
        setItems(a);
        setAttempts(e.filter((x) => !x.preview));
      })
      .catch(() => setClasses([]));

  useEffect(() => {
    if (netId) load(netId);
  }, [netId]);

  if (!netId)
    return (
      <AppShell>
        <div className="mx-auto max-w-md pt-10">
          <NetIdGate />
        </div>
      </AppShell>
    );

  const done = (a: Assignment) => attempts.some((e) => e.assignment_id === a.id && e.status === "completed");
  const todo = items.filter((a) => !done(a));

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[22px] text-ink">Classes</h2>
            <button type="button" className={btn.text} onClick={() => setJoining(true)}>
              <Plus size={18} /> Join class
            </button>
          </div>
          {classes === null ? (
            <Spinner label="Loading" />
          ) : classes.length === 0 ? (
            <Empty
              title="Join your first class"
              action={
                <button type="button" className={btn.primary} onClick={() => setJoining(true)}>
                  Join with a code
                </button>
              }
            >
              Your instructor gives you a class code. Enter it to see the patients assigned to you.
            </Empty>
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {classes.map((c) => (
                <li key={c.id}>
                  <ClassCardView c={c} href={`/class?id=${c.id}`} faculty={false} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {todo.length > 0 && (
          <section>
            <h2 className="mb-4 text-[22px] text-ink">To do</h2>
            <AssignmentGrid items={todo} attempts={attempts} />
          </section>
        )}
      </div>
      {joining && (
        <JoinClassDialog
          netId={netId}
          onClose={() => setJoining(false)}
          onDone={() => {
            setJoining(false);
            load(netId);
          }}
        />
      )}
    </AppShell>
  );
}
