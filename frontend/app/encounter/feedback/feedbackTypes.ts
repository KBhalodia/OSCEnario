// ---------------------------------------------------------------------------
// Feedback types
// ---------------------------------------------------------------------------
// Shared shapes for a completed encounter attempt and the feedback report
// generated from it.
//
// IMPORTANT (anti-fabrication): every value in a report is DERIVED from the
// saved attempt (the real transcript, the real revealed findings, the real
// duration) and the patient's own approved profile. Nothing here invents
// clinical facts, scores, or evidence. Where evidence is insufficient, fields
// are explicitly marked "Not assessed".
// ---------------------------------------------------------------------------

// One line of the saved transcript.
export type TranscriptTurn = {
  sender: "student" | "patient";
  text: string;
};

// A completed encounter attempt. This is the record saved to localStorage and
// the SAME shape a future Professor Results dashboard can read.
export type EncounterAttempt = {
  // Unique id for this attempt (not the patient id).
  attemptId: string;
  // The student's demo NetID (e.g. "abc123"), entered at the start of the
  // encounter. Optional so attempts saved before this feature keep working —
  // older records have no netId and are shown as "Unknown student". This is a
  // demo identifier only, NOT verified Rutgers authentication.
  netId?: string;
  // The patient interviewed.
  patientId: string;
  patientName: string;
  // ISO timestamp when the encounter ended.
  endedAt: string;
  // Encounter length in seconds.
  durationSeconds: number;
  // The full conversation.
  transcript: TranscriptTurn[];
  // IDs of chart findings the student revealed during the encounter.
  revealedFindingIds: string[];
  // A lightweight snapshot of the patient's findings and objectives at the
  // time of the attempt, so a report can be rebuilt later even if the patient
  // profile changes or is removed. All of this comes from the approved profile.
  findingsSnapshot: FindingSnapshot[];
  objectivesSnapshot: string[];
};

// A minimal copy of a chart finding, captured with the attempt.
export type FindingSnapshot = {
  id: string;
  label: string;
  value: string;
  section: string; // chart tab id (history, medications, ...)
  // Overview/demographic findings are visible from the start, so they don't
  // count as something the student had to "discover".
  startVisible: boolean;
};

// --- Report shapes ----------------------------------------------------------

// Coverage verdict for one learning objective.
export type ObjectiveCoverage = {
  objective: string;
  status: "covered" | "partial" | "not-covered";
  // Plain-language explanation grounded in what actually happened.
  explanation: string;
  // Finding labels that provided the evidence (may be empty).
  evidence: string[];
};

// A qualitative section (interview structure, communication, etc.).
export type QualitativeSection = {
  title: string;
  // "Not assessed" when evidence/rubric don't support a judgement.
  assessed: boolean;
  // Shown when assessed; a short, evidence-based note.
  note: string;
};

// The full feedback report derived from an attempt.
export type FeedbackReport = {
  attemptId: string;
  patientName: string;
  durationSeconds: number;
  // Findings the student discovered vs. missed (excludes start-visible items).
  discovered: FindingSnapshot[];
  missed: FindingSnapshot[];
  // Objective coverage, or null when no faculty objectives were provided.
  objectiveCoverage: ObjectiveCoverage[] | null;
  // Why objectives couldn't be assessed, when objectiveCoverage is null.
  objectivesNote: string | null;
  // Evidence-based strengths and suggestions (each may be empty).
  strengths: string[];
  suggestions: string[];
  // Qualitative sections (always present; each may be "Not assessed").
  qualitative: QualitativeSection[];
};
