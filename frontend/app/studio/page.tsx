"use client";

// ---------------------------------------------------------------------------
// Patient studio (faculty): the patient library + "Create patient".
// Create = a short description (+ optional files) -> POST /patients/generate
// -> the AI builds a full draft patient -> faculty review it on the next page.
// ---------------------------------------------------------------------------

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import AppShell, { Empty, ErrorNote, Pill, Spinner, btn } from "../components/AppShell";
import CreatePatientDialog from "../components/CreatePatientDialog";
import { PatientCard } from "../components/Banner";
import { api, type PatientSummary } from "@/lib/api";


export default function StudioPage() {
  return (
    <Suspense fallback={<AppShell crumb="Patient library"><Spinner label="Loading" /></AppShell>}>
      <Studio />
    </Suspense>
  );
}

function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(params.get("create") === "1");
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");

  const load = () =>
    api
      .patients()
      .then(setPatients)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const importSamples = async () => {
    setError(null);
    try {
      await api.importSamples();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = (patients ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <AppShell
      title="Patient library"
      crumb="Patient library"
      actions={
        <>
          <button className={btn.text} type="button" onClick={importSamples}>
            Load sample patients
          </button>
          <button className={btn.primary} type="button" onClick={() => setShowForm(true)}>
            <Plus size={18} /> Create patient
          </button>
        </>
      }
      tabs={
        <div className="-mb-px flex gap-1">
          {(["all", "published", "draft"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={"relative h-12 px-5 text-[15px] " + (filter === f ? "font-medium text-primary" : "text-ink-2 hover:text-ink")}
            >
              {f === "all" ? "All patients" : f === "published" ? "Published" : "Drafts"}
              {filter === f && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />}
            </button>
          ))}
        </div>
      }
    >
      <div className="mx-auto max-w-[1180px]">
        <ErrorNote error={error} />
        {patients === null ? (
          <Spinner label="Loading patients" />
        ) : patients.length === 0 ? (
          <Empty
            title="Your library is empty"
            action={
              <div className="flex gap-2">
                <button className={btn.primary} type="button" onClick={() => setShowForm(true)}>
                  Create patient
                </button>
                <button className={btn.ghost} type="button" onClick={importSamples}>
                  Load the 8 sample patients
                </button>
              </div>
            }
          >
            Describe a patient in a few lines. The studio writes the full case, marks what it added, and checks it for contradictions.
          </Empty>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => (
              <li key={p.id}>
                <PatientCard
                  id={p.id}
                  href={`/studio/patient?id=${encodeURIComponent(p.id)}`}
                  title={p.name}
                  subtitle={p.primary_diagnosis || undefined}
                  portrait={p.portrait}
                  name={p.name}
                  body={
                    <>
                      {p.status !== "published" && <Pill tone="amber">Draft</Pill>}
                      <p className={(p.status !== "published" ? "mt-2 " : "") + "line-clamp-3"}>{p.description}</p>
                    </>
                  }
                  footer={
                    <span className="pl-1 text-[13px] text-ink-2">
                      {[p.age && `${p.age} years`, p.sex, p.student_role].filter(Boolean).join(", ")}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {showForm && (
        <CreatePatientDialog
          onClose={() => setShowForm(false)}
          onDone={(pt) => router.push(`/studio/patient?id=${encodeURIComponent(pt.id)}&new=1`)}
        />
      )}
    </AppShell>
  );
}
