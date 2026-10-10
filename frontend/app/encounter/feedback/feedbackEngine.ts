// ---------------------------------------------------------------------------
// Feedback engine
// ---------------------------------------------------------------------------
// Pure functions that turn a completed EncounterAttempt into a FeedbackReport.
//
// Grounding rules (strict, no fabrication):
//   - "Discovered" / "missed" come directly from which findings were revealed.
//   - Objective coverage is inferred ONLY from observable evidence (revealed
//     findings and the student's own questions). Each verdict carries a plain
//     explanation. If faculty gave no objectives, we say so — we never invent
//     objectives.
//   - Strengths/suggestions are derived from real counts and behaviours in the
//     transcript. We only emit a point when its signal is actually present.
//   - Qualitative sections (interview structure, communication, empathy,
//     clarity, professionalism) are marked "Not assessed" unless there is a
//     defensible, evidence-based observation. We do NOT guess scores.
//
// There are NO patient-specific hardcoded judgements here; everything is
// computed from the attempt + the patient's approved snapshot.
// ---------------------------------------------------------------------------

import type {
  EncounterAttempt,
  FeedbackReport,
  FindingSnapshot,
  ObjectiveCoverage,
  QualitativeSection,
  TranscriptTurn,
} from "./feedbackTypes";

// Words too common to be meaningful when matching objective text to evidence.
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on", "at",
  "is", "are", "was", "were", "be", "any", "all", "elicit", "identify",
  "confirm", "complete", "patient", "patients", "student", "ask", "about",
  "before", "after", "that", "this", "their", "them", "they", "you", "your",
  "history", "symptom", "symptoms", // too generic on their own
]);

// Turn free text into a set of meaningful lowercase tokens.
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

// How many tokens of `needle` appear in `haystack`.
function overlapCount(needle: Set<string>, haystack: Set<string>): number {
  let n = 0;
  for (const t of needle) if (haystack.has(t)) n += 1;
  return n;
}

// Collect the student's messages as one lowercase blob + a token set.
function studentTokens(transcript: TranscriptTurn[]): Set<string> {
  const all = new Set<string>();
  for (const turn of transcript) {
    if (turn.sender !== "student") continue;
    for (const t of tokenize(turn.text)) all.add(t);
  }
  return all;
}

// Count how many questions the student asked (turns from the student).
function countStudentTurns(transcript: TranscriptTurn[]): number {
  return transcript.filter((t) => t.sender === "student").length;
}

// --- Objective coverage -----------------------------------------------------

function assessObjectives(
  attempt: EncounterAttempt,
): { coverage: ObjectiveCoverage[] | null; note: string | null } {
  const objectives = attempt.objectivesSnapshot.filter(
    (o) => typeof o === "string" && o.trim() !== "",
  );

  // No faculty objectives available: explain, do not invent.
  if (objectives.length === 0) {
    return {
      coverage: null,
      note:
        "No faculty learning objectives were provided for this patient, so objective coverage can't be assessed. Coverage will appear here when a case is published with objectives in Patient Studio.",
    };
  }

  const revealed = new Set(attempt.revealedFindingIds);
  const askedTokens = studentTokens(attempt.transcript);

  // Tokens from findings the student actually revealed (strong evidence).
  const revealedFindingTokens = new Set<string>();
  for (const f of attempt.findingsSnapshot) {
    if (!revealed.has(f.id)) continue;
    for (const t of tokenize(`${f.label} ${f.value}`)) {
      revealedFindingTokens.add(t);
    }
  }

  const coverage: ObjectiveCoverage[] = objectives.map((objective) => {
    const objTokens = tokenize(objective);

    // Which revealed findings relate to this objective?
    const evidenceFindings = attempt.findingsSnapshot.filter((f) => {
      if (!revealed.has(f.id)) return false;
      const fTokens = tokenize(`${f.label} ${f.value}`);
      return overlapCount(objTokens, fTokens) > 0;
    });

    const revealedOverlap = overlapCount(objTokens, revealedFindingTokens);
    const askedOverlap = overlapCount(objTokens, askedTokens);

    let status: ObjectiveCoverage["status"];
    let explanation: string;

    if (evidenceFindings.length > 0 && revealedOverlap >= 1) {
      status = "covered";
      explanation = `The student uncovered related information (${evidenceFindings
        .map((f) => f.label)
        .join(", ")}).`;
    } else if (askedOverlap >= 1) {
      status = "partial";
      explanation =
        "The student asked about this area, but didn't uncover the related chart findings.";
    } else {
      status = "not-covered";
      explanation =
        "No questions in the transcript clearly addressed this objective.";
    }

    return {
      objective,
      status,
      explanation,
      evidence: evidenceFindings.map((f) => f.label),
    };
  });

  return { coverage, note: null };
}

// --- Strengths & suggestions ------------------------------------------------

function buildStrengthsAndSuggestions(
  attempt: EncounterAttempt,
  discovered: FindingSnapshot[],
  missed: FindingSnapshot[],
): { strengths: string[]; suggestions: string[] } {
  const strengths: string[] = [];
  const suggestions: string[] = [];

  const studentTurns = countStudentTurns(attempt.transcript);
  const totalDiscoverable = discovered.length + missed.length;

  // Strengths — only when the signal is real.
  if (discovered.length > 0) {
    strengths.push(
      `Uncovered ${discovered.length} of ${totalDiscoverable} discoverable finding${
        totalDiscoverable === 1 ? "" : "s"
      }: ${discovered.map((f) => f.label).join(", ")}.`,
    );
  }
  if (studentTurns >= 5) {
    strengths.push(
      `Conducted an active interview with ${studentTurns} questions.`,
    );
  }

  // Suggestions — grounded in what was missed or not done.
  if (missed.length > 0) {
    // Group missed findings by chart section so the advice is specific.
    const bySection = new Map<string, string[]>();
    for (const f of missed) {
      const list = bySection.get(f.section) ?? [];
      list.push(f.label);
      bySection.set(f.section, list);
    }
    for (const [section, labels] of bySection) {
      suggestions.push(
        `Explore the ${section} area — you didn't uncover: ${labels.join(", ")}.`,
      );
    }
  }
  if (studentTurns < 3) {
    suggestions.push(
      "Ask more questions to build a fuller history before concluding.",
    );
  }

  return { strengths, suggestions };
}

// --- Qualitative sections ---------------------------------------------------
// Assessed only when a defensible, evidence-based observation exists. We do not
// score tone, empathy, or professionalism without a rubric — those stay
// "Not assessed" in this first version.

function buildQualitativeSections(
  attempt: EncounterAttempt,
): QualitativeSection[] {
  const studentTurns = countStudentTurns(attempt.transcript);
  const firstStudent = attempt.transcript.find((t) => t.sender === "student");

  const sections: QualitativeSection[] = [];

  // Interview structure: we can observe whether an interview happened and how
  // many distinct questions were asked. That's a defensible, factual note.
  if (studentTurns > 0) {
    sections.push({
      title: "Interview structure",
      assessed: true,
      note: `The student asked ${studentTurns} question${
        studentTurns === 1 ? "" : "s"
      } during the encounter. ${
        firstStudent
          ? `The interview opened with: “${firstStudent.text.trim()}”.`
          : ""
      }`.trim(),
    });
  } else {
    sections.push({
      title: "Interview structure",
      assessed: false,
      note: "Not assessed — no student questions were recorded.",
    });
  }

  // Clarity: we can observe message length as a rough, factual proxy, but we
  // avoid judging quality. Keep it conservative.
  if (studentTurns > 0) {
    const avgWords =
      attempt.transcript
        .filter((t) => t.sender === "student")
        .reduce((sum, t) => sum + t.text.trim().split(/\s+/).length, 0) /
      studentTurns;
    sections.push({
      title: "Clarity",
      assessed: true,
      note: `Questions averaged about ${Math.round(
        avgWords,
      )} words. Short, focused questions are generally easier for patients to answer.`,
    });
  } else {
    sections.push({
      title: "Clarity",
      assessed: false,
      note: "Not assessed — no student questions were recorded.",
    });
  }

  // Communication, empathy, professionalism: assessing these fairly needs a
  // faculty rubric and language analysis we don't have in this first version.
  // Per the requirement, we show "Not assessed" rather than guessing.
  for (const title of ["Communication", "Empathy", "Professionalism"]) {
    sections.push({
      title,
      assessed: false,
      note: "Not assessed — this first version has no rubric to judge this fairly without risking an invented score.",
    });
  }

  return sections;
}

// --- Public entry point -----------------------------------------------------

export function buildFeedbackReport(attempt: EncounterAttempt): FeedbackReport {
  const revealed = new Set(attempt.revealedFindingIds);

  // Discoverable findings exclude ones visible from the start (demographics).
  const discoverable = attempt.findingsSnapshot.filter((f) => !f.startVisible);
  const discovered = discoverable.filter((f) => revealed.has(f.id));
  const missed = discoverable.filter((f) => !revealed.has(f.id));

  const { coverage, note } = assessObjectives(attempt);
  const { strengths, suggestions } = buildStrengthsAndSuggestions(
    attempt,
    discovered,
    missed,
  );
  const qualitative = buildQualitativeSections(attempt);

  return {
    attemptId: attempt.attemptId,
    patientName: attempt.patientName,
    durationSeconds: attempt.durationSeconds,
    discovered,
    missed,
    objectiveCoverage: coverage,
    objectivesNote: note,
    strengths,
    suggestions,
    qualitative,
  };
}
