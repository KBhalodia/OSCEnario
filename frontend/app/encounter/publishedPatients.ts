// ---------------------------------------------------------------------------
// Published patients bridge (Patient Studio -> Student Encounter)
// ---------------------------------------------------------------------------
// For this frontend-only hackathon prototype, Patient Studio and Student
// Encounter run in the SAME browser. When faculty publish a patient in Studio,
// we save that patient's "encounter profile" into localStorage. The Encounter
// screen then reads it back and interviews that patient.
//
// This file owns the bridge:
//   - the shared localStorage key,
//   - the shape Studio writes (its `toEncounterProfile()` output + an id),
//   - an ADAPTER that converts that shape into the Encounter `Patient` type
//     used by the chat engine and chart UI.
//
// Keeping the adapter here (not in studio.js) means Studio stays decoupled: it
// only needs to call its existing `toEncounterProfile()` and drop the result
// in localStorage. The Encounter side knows how to interpret it.
// ---------------------------------------------------------------------------

import type {
  ChartFinding,
  ChartSection,
  ChartTabId,
  Patient,
  PatientResponseRule,
} from "./demoPatient";

// The localStorage key the two apps agree on. Studio writes, Encounter reads.
// It is intentionally separate from Studio's own DB key ("twinverse.studio")
// so we never interfere with Studio's editing/persistence.
export const PUBLISHED_STORAGE_KEY = "twinverse.publishedPatients";

// ---------------------------------------------------------------------------
// The shape Studio writes.
// ---------------------------------------------------------------------------
// This mirrors the object returned by `toEncounterProfile()` in studio.js,
// plus an `id` we stamp on so Encounter can key/route by it. We keep the fields
// loose because Studio owns this shape; the adapter below reads defensively.

type StudioFact = {
  id: string;
  tab: string; // "summary" | "history" | "meds" | "labs" | "artifacts"
  label: string;
  value: string;
  start?: boolean; // visible from the start (demographics line)
  key?: boolean; // key finding (for feedback) — not needed by Encounter
  flag?: string; // e.g. "Abnormal"
  artifact?: string; // e.g. "ecg"
  fileName?: string;
  triggers?: string[]; // release words that unlock this fact
};

export type StudioEncounterProfile = {
  id: string;
  name: string;
  age: number;
  sex: string;
  greeting: string;
  fallback: string;
  facts: StudioFact[];
  objectives?: string[];
  sources?: { title: string; note: string }[];
};

// The stored map: patientId -> profile.
type PublishedMap = Record<string, StudioEncounterProfile>;

// ---------------------------------------------------------------------------
// Storage read/write (browser only — guarded for SSR).
// ---------------------------------------------------------------------------

function readMap(): PublishedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PUBLISHED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Be defensive: only accept a plain object.
    if (parsed && typeof parsed === "object") return parsed as PublishedMap;
    return {};
  } catch {
    // Corrupt or unavailable storage: behave as if nothing is published.
    return {};
  }
}

function writeMap(map: PublishedMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PUBLISHED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: nothing we can do in a prototype */
  }
}

// Save (or update) one published patient. Called from Studio on publish.
// `profile` should be the output of Studio's `toEncounterProfile()` with an
// `id` added. Returns the id used.
export function publishEncounterProfile(profile: StudioEncounterProfile): string {
  const map = readMap();
  map[profile.id] = profile;
  writeMap(map);
  return profile.id;
}

// Read one published profile by id (raw Studio shape), or null.
export function getPublishedProfile(id: string): StudioEncounterProfile | null {
  if (!id) return null;
  const map = readMap();
  return map[id] ?? null;
}

// ---------------------------------------------------------------------------
// Adapter: Studio profile -> Encounter `Patient`.
// ---------------------------------------------------------------------------

// Map Studio's chart "tab" names onto the Encounter chart's tab ids.
// Encounter tabs: overview | history | medications | labs | imaging.
function mapTab(studioTab: string): ChartTabId {
  switch (studioTab) {
    case "summary":
      return "overview";
    case "meds":
      return "medications";
    case "labs":
      return "labs";
    case "artifacts":
      return "imaging";
    case "history":
    default:
      return "history";
  }
}

// Human-friendly labels for each Encounter tab, in display order.
const ENCOUNTER_TABS: { id: ChartTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "medications", label: "Medications" },
  { id: "labs", label: "Labs" },
  { id: "imaging", label: "Imaging" },
];

// Try to find a concise chief complaint from the Studio facts.
function deriveChiefComplaint(facts: StudioFact[]): string {
  const cc = facts.find((f) =>
    /chief complaint|complaint|what brings/i.test(f.label),
  );
  if (cc) return cc.value;
  // Fall back to the first non-demographic summary fact, else a neutral line.
  const firstSummary = facts.find(
    (f) => mapTab(f.tab) === "overview" && !f.start,
  );
  return firstSummary?.value ?? "See history for details.";
}

// Pick a neutral avatar emoji based on recorded sex (no real photos).
function avatarFor(sex: string): string {
  const s = (sex || "").toLowerCase();
  if (s === "male") return "🧑🏽";
  if (s === "female") return "👩🏽";
  return "🧑";
}

// Convert a Studio profile into the Encounter `Patient` type the chat engine
// and chart UI expect.
//
// Mapping rules:
//   - Each Studio fact becomes a chart finding under its mapped tab. A fact's
//     `flag` (e.g. "Abnormal") is appended to the value so students still see
//     it. `start` facts are disclosed from the beginning; everything else is
//     hidden until unlocked.
//   - Each fact that has `triggers` becomes a response rule: when the student's
//     question contains a trigger word, the patient speaks the fact's value and
//     the matching chart finding is revealed. This reuses Studio's own release
//     words, so faculty keep full control and we invent nothing.
//   - Facts without triggers still appear in the chart but can only surface via
//     their tab (they have no spoken rule).
export function studioProfileToPatient(profile: StudioEncounterProfile): Patient {
  const findingsByTab: Record<ChartTabId, ChartFinding[]> = {
    overview: [],
    history: [],
    medications: [],
    labs: [],
    imaging: [],
  };

  const responseRules: PatientResponseRule[] = [];

  // Always-visible demographics line at the top of Overview, so students see
  // who they're meeting even before asking anything.
  findingsByTab.overview.push({
    id: "ov-demographics",
    label: "Patient",
    value: `${profile.name}, ${profile.age}-year-old ${String(
      profile.sex,
    ).toLowerCase()}`,
    disclosed: true,
  });

  for (const fact of profile.facts) {
    // The demographics "demo" fact from Studio duplicates the line above; skip.
    if (fact.id === "demo") continue;

    const tab = mapTab(fact.tab);
    const value = fact.flag ? `${fact.value} (${fact.flag})` : fact.value;

    const finding: ChartFinding = {
      id: fact.id,
      label: fact.label,
      value,
      // Studio marks demographics with `start`; everything else is hidden until
      // the student asks about it (progressive disclosure).
      disclosed: fact.start === true,
    };
    findingsByTab[tab].push(finding);

    // Build a spoken rule from the fact's release words, if any.
    const triggers = (fact.triggers ?? []).filter(
      (t) => typeof t === "string" && t.trim() !== "",
    );
    if (triggers.length > 0) {
      responseRules.push({
        id: `rule-${fact.id}`,
        keywords: triggers,
        // The patient simply states what the chart records. No invented facts.
        reply: fact.value,
        revealsFindingIds: [fact.id],
      });
    }
  }

  // Assemble chart sections in display order, dropping empty tabs so the UI
  // only shows tabs that actually have content (plus Overview always).
  const chart: ChartSection[] = ENCOUNTER_TABS.filter(
    (t) => t.id === "overview" || findingsByTab[t.id].length > 0,
  ).map((t) => ({
    id: t.id,
    label: t.label,
    findings: findingsByTab[t.id],
  }));

  return {
    id: profile.id,
    name: profile.name,
    age: profile.age,
    gender: profile.sex,
    chiefComplaint: deriveChiefComplaint(profile.facts),
    greeting: profile.greeting,
    fallbackReply:
      profile.fallback ||
      "I'm not sure about that — I don't have an answer for you.",
    avatarEmoji: avatarFor(profile.sex),
    chart,
    responseRules,
  };
}

// Convenience: read a published patient straight into the Encounter `Patient`
// type, or null if nothing is published under that id.
export function getPublishedPatient(id: string): Patient | null {
  const profile = getPublishedProfile(id);
  return profile ? studioProfileToPatient(profile) : null;
}
