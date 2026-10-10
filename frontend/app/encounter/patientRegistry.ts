// ---------------------------------------------------------------------------
// Patient registry
// ---------------------------------------------------------------------------
// A single place that maps a patient ID -> patient profile. The encounter
// screen looks patients up here by the `patientId` in the URL
// (e.g. /encounter?patientId=patient-001).
//
// This is data + lookup only — no UI. Today it holds our synthetic demo
// patient(s). Later, a backend or Patient Studio export can populate this map
// (or replace `getPatientById` with a fetch) without touching the UI, because
// everything is keyed off the shared `Patient` type.
// ---------------------------------------------------------------------------

import { demoPatient, type Patient } from "./demoPatient";
import { getPublishedPatient } from "./publishedPatients";

// Re-export the shared profile type so other files have one import point for
// "what a patient looks like".
export type { Patient } from "./demoPatient";

// The ID used when no `patientId` is supplied in the URL.
export const DEFAULT_PATIENT_ID = "patient-001";

// The known patients, keyed by ID.
//
// Jordan Avery is our default demo patient. We register the SAME profile under
// two IDs so both work:
//   - "patient-001"       the friendly default/demo ID used in URLs
//   - "demo-jordan-avery" the profile's own id (handy for direct links)
const PATIENTS_BY_ID: Record<string, Patient> = {
  [DEFAULT_PATIENT_ID]: demoPatient,
  [demoPatient.id]: demoPatient,
};

// Look up a patient by ID.
//
//   - No ID given (null/empty)  -> the default demo patient (Jordan Avery).
//   - A built-in demo ID        -> that demo patient.
//   - A patient published by Studio (found in localStorage) -> that patient.
//   - Anything else             -> `null`, so the caller can show
//                                  "Patient not found" and invent nothing.
//
// Demo patients always win over published ones, so the built-in demos keep
// working exactly as before. The published-store lookup only runs in the
// browser (localStorage); on the server it safely returns nothing.
export function getPatientById(patientId: string | null | undefined): Patient | null {
  // Treat a missing or blank id as "use the default".
  if (!patientId || patientId.trim() === "") {
    return PATIENTS_BY_ID[DEFAULT_PATIENT_ID] ?? null;
  }

  const demo = PATIENTS_BY_ID[patientId];
  if (demo) return demo;

  // Not a demo patient — see if Studio published one under this id.
  return getPublishedPatient(patientId);
}
