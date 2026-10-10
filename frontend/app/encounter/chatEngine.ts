// ---------------------------------------------------------------------------
// Chat engine
// ---------------------------------------------------------------------------
// A deterministic (rule-based) "brain" for the demo patient.
//
// "Deterministic" means: the same question in the same context always gives the
// same answer. There is NO AI, NO network, and NO randomness here — we only
// read the patient's own approved data and match the student's words against
// the rules defined on that patient.
//
// This file improves on simple substring matching in a few safe ways:
//   - It normalises text (lowercasing + stripping punctuation) so "Pain?" and
//     "pain" match the same way.
//   - It matches keywords on WORD BOUNDARIES, so "arm" doesn't accidentally
//     match inside "alarm", while multi-word phrases like "short of breath"
//     still work.
//   - It SCORES every rule by how many keywords hit and picks the best one,
//     instead of blindly taking the first rule in the list. This makes the
//     patient better at understanding different phrasings.
//   - It uses recent conversation history ONLY to resolve vague follow-ups
//     (e.g. "and anything else?") back to the last topic. It never uses history
//     to invent facts.
//
// Grounding guarantee: every reply comes verbatim from a rule on the selected
// patient, or from that patient's own `fallbackReply`. If nothing matches, the
// patient says the information isn't available rather than guessing.
// ---------------------------------------------------------------------------

import type { Patient, PatientResponseRule } from "./demoPatient";

// What the engine returns for a given student message.
export type EngineResult = {
  // The patient's spoken reply.
  reply: string;
  // IDs of chart findings to reveal because of this message (may be empty).
  revealedFindingIds: string[];
};

// A minimal view of a past turn. We only need who spoke and what they said, so
// this stays compatible with however the UI stores messages.
export type ConversationTurn = {
  sender: "student" | "patient";
  text: string;
};

// Words that carry no topic meaning. We ignore them when deciding whether a
// message is a vague follow-up (see below).
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "do",
  "does", "did", "you", "your", "it", "that", "this", "to", "of", "for",
  "about", "any", "have", "has", "had", "can", "could", "would", "please",
  "tell", "me", "what", "how", "when", "where", "why", "there", "else",
  "also", "ok", "okay", "so", "then", "i", "we", "they", "he", "she",
]);

// Phrases that signal the student is asking "give me more of the same topic"
// without naming it (so we should reuse the previous topic).
const FOLLOW_UP_CUES = [
  "anything else",
  "what else",
  "and else",
  "more",
  "go on",
  "continue",
  "tell me more",
  "elaborate",
  "like what",
  "such as",
];

// Normalise a string for matching: lowercase, replace punctuation with spaces,
// and collapse runs of whitespace. We keep spaces so phrase keywords still work.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Does `haystack` contain `keyword` as a whole word / phrase (not as a
// substring inside another word)? Both inputs are already normalised.
function containsWholeWord(haystack: string, keyword: string): boolean {
  if (keyword === "") return false;
  // Pad with spaces so we can check boundaries by simple inclusion. e.g.
  // haystack " does it hurt " contains " hurt " but not " art ".
  return ` ${haystack} `.includes(` ${keyword} `);
}

// Count how many of a rule's keywords appear (as whole words) in the message.
function scoreRule(rule: PatientResponseRule, normalizedMessage: string): number {
  let score = 0;
  for (const keyword of rule.keywords) {
    if (containsWholeWord(normalizedMessage, normalize(keyword))) {
      score += 1;
    }
  }
  return score;
}

// Find the rule that best matches the message. Returns null if no rule matches.
// Ties are broken by rule order (earlier rules win), which preserves the
// author's "more specific first" intent.
function bestMatchingRule(
  patient: Patient,
  normalizedMessage: string,
): PatientResponseRule | null {
  let best: PatientResponseRule | null = null;
  let bestScore = 0;

  for (const rule of patient.responseRules) {
    const score = scoreRule(rule, normalizedMessage);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

// Is this message a vague follow-up with no real topic words of its own?
// e.g. "anything else?", "and?", "tell me more". If so, we may reuse the last
// topic the student asked about.
function isVagueFollowUp(normalizedMessage: string): boolean {
  if (normalizedMessage === "") return false;

  for (const cue of FOLLOW_UP_CUES) {
    if (containsWholeWord(normalizedMessage, cue)) return true;
  }

  // Also treat very short messages made entirely of stop words as follow-ups
  // (e.g. "and?", "what about that").
  const meaningfulWords = normalizedMessage
    .split(" ")
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
  return meaningfulWords.length === 0;
}

// Look back through history (most recent first) for the last STUDENT message
// that actually matched a rule, and return that rule. Used to answer vague
// follow-ups in context without inventing anything.
function lastMatchedRuleFromHistory(
  patient: Patient,
  history: ConversationTurn[],
): PatientResponseRule | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.sender !== "student") continue;
    const rule = bestMatchingRule(patient, normalize(turn.text));
    if (rule) return rule;
  }
  return null;
}

// Given a patient, the student's message, and (optionally) the conversation so
// far, decide what the patient says and which chart findings get unlocked.
//
//   1. Normalise the message.
//   2. Find the best-matching rule by keyword score.
//   3. If none matches but the message is a vague follow-up, reuse the last
//      topic from history.
//   4. If still nothing, use the patient's fallbackReply and reveal nothing.
//
// `history` is optional so existing callers keep working unchanged.
export function getPatientResponse(
  patient: Patient,
  studentMessage: string,
  history: ConversationTurn[] = [],
): EngineResult {
  const normalizedMessage = normalize(studentMessage);

  // Primary path: does the message itself match a rule?
  let rule = bestMatchingRule(patient, normalizedMessage);

  // Follow-up path: a vague "anything else?" reuses the previous topic so the
  // conversation flows, but still only returns that patient's approved reply.
  if (!rule && isVagueFollowUp(normalizedMessage)) {
    rule = lastMatchedRuleFromHistory(patient, history);
  }

  if (rule) {
    return {
      reply: rule.reply,
      revealedFindingIds: rule.revealsFindingIds ?? [],
    };
  }

  // Nothing matched — the patient honestly says the information isn't available
  // instead of guessing.
  return {
    reply: patient.fallbackReply,
    revealedFindingIds: [],
  };
}
