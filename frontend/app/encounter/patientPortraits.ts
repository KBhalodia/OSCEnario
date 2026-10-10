// ---------------------------------------------------------------------------
// Patient portraits
// ---------------------------------------------------------------------------
// This module maps a patient's NAME to a portrait image in
// `frontend/public/patients/`. It is intentionally UI-free so it can be reused
// anywhere (the encounter screen today, Patient-Studio-created patients later).
//
// Why a resolver instead of hard-coding one image path on the patient?
//   - Portrait files have messy, inconsistent names (commas, a "Patient"
//     suffix, mixed casing, ".PNG" vs ".png"). We normalise around that.
//   - Matching is by the patient's EXACT name (after normalising punctuation
//     and casing). We never guess or fall back to "some other person's" photo.
//   - If no file matches, callers get `null` and show a clean default avatar.
// ---------------------------------------------------------------------------

// The folder (under /public) that holds the portrait files.
// NOTE: the folder name contains a space; that's fine — we URL-encode paths
// before using them in <img src>.
const PORTRAIT_DIR = "/patients/patient-images 2";

// The exact portrait filenames currently present in that folder.
//
// If you add or rename files in `frontend/public/patients/patient-images 2`,
// update this list to match. Keeping it explicit (rather than scanning the
// disk) means the browser bundle stays simple and there is no server call.
const PORTRAIT_FILES = [
  "Dominic Rivera, Patient.PNG",
  "Marcus Ramirez, Patient.png",
  "Nisha Patel, Patient.png",
  "Omar Sinclair, Patient.png",
  "Vadko Bareche patient.png",
  "Walter Greene Patient.png",
  "Wyatt Nelson, Patient.png",
  "Yvette Armstrong, Patient.png",
];

// Turn a name or filename into a comparable key:
//   - drop the file extension
//   - remove a trailing "patient" label (the files are named "... Patient")
//   - lowercase, strip punctuation, and collapse spaces
//
// Examples:
//   "Dominic Rivera, Patient.PNG" -> "dominic rivera"
//   "Vadko Bareche patient.png"   -> "vadko bareche"
//   "Jordan Avery"                -> "jordan avery"
function normalizeName(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/i, "") // remove file extension
    .replace(/[,]/g, " ") // commas -> spaces
    .replace(/\bpatient\b/gi, "") // drop the word "patient"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // any other punctuation -> space
    .trim()
    .replace(/\s+/g, " "); // collapse runs of spaces
}

// Pre-compute a lookup from normalised name -> original filename, so each
// resolve is a quick map read.
const PORTRAIT_BY_NAME: Record<string, string> = Object.fromEntries(
  PORTRAIT_FILES.map((file) => [normalizeName(file), file]),
);

// Resolve a patient's name to a usable <img src>, or null if there's no
// exact match. The returned path is URL-encoded so spaces/commas work.
export function resolvePortraitSrc(patientName: string): string | null {
  const key = normalizeName(patientName);
  const file = PORTRAIT_BY_NAME[key];
  if (!file) return null;

  // Encode each path segment individually so "/" separators are preserved
  // while spaces and commas inside names/folders are escaped.
  const encodedDir = PORTRAIT_DIR.split("/").map(encodeURIComponent).join("/");
  return `${encodedDir}/${encodeURIComponent(file)}`;
}
