// ---------------------------------------------------------------------------
// Chat engine
// ---------------------------------------------------------------------------
// A deterministic (rule-based) "brain" for the active patient.
//
// "Deterministic" means: the same question in the same context always gives the
// same answer. There is NO AI, NO network, and NO randomness here — we only
// read the patient's own approved data and match the student's words against
// the rules defined on that patient.
//
// Matching works in a few safe, GENERIC ways (no patient-specific logic, so it
// works for any newly published patient):
//
//   - Normalisation: lowercase + strip punctuation, so "ECG?" and "ecg" match.
//   - Whole-word / phrase matching: "arm" doesn't match inside "alarm", while
//     multi-word phrases like "short of breath" still work.
//   - SPECIFICITY WEIGHTING: a keyword shared by many rules (e.g. a generic
//     word like "results") is worth less than a keyword that's unique to one
//     rule (e.g. "ecg"). We compute this per patient from the rules themselves
//     — nothing is hardcoded. This is what stops "Can I see your ECG results?"
//     from matching the lab rule just because both mention "results".
//   - MULTIPLE QUESTIONS: a single message can trigger several rules (e.g.
//     "what meds are you on and can I see the ECG?"). Every rule with a
//     genuinely specific hit is answered, and all its approved findings are
//     revealed. Rules matched only by a shared generic word are NOT fired on
//     their own, so unrelated findings aren't disclosed.
//   - Vague follow-ups ("anything else?") reuse the last real topic from
//     history, never inventing new facts.
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

// A keyword must carry at least this much specificity weight to be allowed to
// fire a rule ON ITS OWN. A keyword unique to one rule has weight 1.0; a
// keyword shared by N rules has weight 1/N. With this threshold, a word shared
// by 3+ rules (weight <= 0.34) cannot by itself trigger a rule — it only adds
// to a rule that already matched on something specific.
const SPECIFIC_WEIGHT_THRESHOLD = 0.5;

// Generic "question framing" words. These describe HOW a student is asking
// ("can I see your results?") rather than WHAT clinical topic they mean. A
// faculty author might still list one as a trigger (e.g. "results" on the lab
// rule), but such a word must never fire a rule on its own — otherwise "ECG
// results" would wrongly trigger the lab rule because both mention "results".
// We force these to zero weight so they only ever ADD to a rule that already
// matched a real topic word. This list is generic, not patient-specific.
const GENERIC_KEYWORDS = new Set([
  "result",
  "results",
  "test",
  "tests",
  "testing",
  "report",
  "reports",
  "see",
  "show",
  "look",
  "check",
  "give",
  "get",
  "find",
  "know",
  "tell",
  "share",
  "read",
  "review",
  "information",
  "info",
  "details",
  "anything",
  "something",
]);

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

// Build a specificity weight for every (normalised) keyword used by the
// patient's rules: weight = 1 / (number of rules that use that keyword).
// Keywords unique to one rule weigh 1.0; keywords shared across rules weigh
// less. Computed from the patient's own data — no hardcoding.
function buildKeywordWeights(patient: Patient): Map<string, number> {
  const ruleCountByKeyword = new Map<string, number>();

  for (const rule of patient.responseRules) {
    // Use a Set so a rule listing the same keyword twice counts once.
    const seen = new Set<string>();
    for (const raw of rule.keywords) {
      const kw = normalize(raw);
      if (kw === "" || seen.has(kw)) continue;
      seen.add(kw);
      ruleCountByKeyword.set(kw, (ruleCountByKeyword.get(kw) ?? 0) + 1);
    }
  }

  const weights = new Map<string, number>();
  for (const [kw, count] of ruleCountByKeyword) {
    // Generic framing words carry no weight on their own; everything else is
    // weighted by how unique it is across the patient's rules.
    const generic = kw.split(" ").every((w) => GENERIC_KEYWORDS.has(w));
    weights.set(kw, generic ? 0 : 1 / count);
  }
  return weights;
}

// Score one rule against the message. Returns the total weighted score and the
// single highest keyword weight that matched (used to decide specificity).
function scoreRule(
  rule: PatientResponseRule,
  normalizedMessage: string,
  weights: Map<string, number>,
): { weighted: number; topKeywordWeight: number; hits: number } {
  let weighted = 0;
  let topKeywordWeight = 0;
  let hits = 0;

  const seen = new Set<string>();
  for (const raw of rule.keywords) {
    const kw = normalize(raw);
    if (kw === "" || seen.has(kw)) continue;
    seen.add(kw);
    if (containsWholeWord(normalizedMessage, kw)) {
      const w = weights.get(kw) ?? 1;
      weighted += w;
      hits += 1;
      if (w > topKeywordWeight) topKeywordWeight = w;
    }
  }

  return { weighted, topKeywordWeight, hits };
}

// A rule that matched the message, with its scores.
type RuleMatch = {
  rule: PatientResponseRule;
  weighted: number;
  topKeywordWeight: number;
  index: number; // position in the rule list (for stable tie-breaking)
};

// Find every rule that matched at least one keyword, best first. "Best" means
// higher weighted score, then earlier in the list.
function findMatches(
  patient: Patient,
  normalizedMessage: string,
  weights: Map<string, number>,
): RuleMatch[] {
  const matches: RuleMatch[] = [];

  patient.responseRules.forEach((rule, index) => {
    const { weighted, topKeywordWeight, hits } = scoreRule(
      rule,
      normalizedMessage,
      weights,
    );
    if (hits > 0) {
      matches.push({ rule, weighted, topKeywordWeight, index });
    }
  });

  matches.sort((a, b) =>
    b.weighted !== a.weighted ? b.weighted - a.weighted : a.index - b.index,
  );
  return matches;
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
// that produced a specific match, and return that rule. Used to answer vague
// follow-ups in context without inventing anything.
function lastSpecificRuleFromHistory(
  patient: Patient,
  history: ConversationTurn[],
  weights: Map<string, number>,
): PatientResponseRule | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.sender !== "student") continue;
    const matches = findMatches(patient, normalize(turn.text), weights);
    const specific = matches.find(
      (m) => m.topKeywordWeight >= SPECIFIC_WEIGHT_THRESHOLD,
    );
    if (specific) return specific.rule;
  }
  return null;
}

// Join several patient replies into one natural-sounding turn.
function combineReplies(replies: string[]): string {
  return replies.join(" ");
}

// Given a patient, the student's message, and (optionally) the conversation so
// far, decide what the patient says and which chart findings get unlocked.
//
//   1. Normalise the message and compute keyword specificity weights.
//   2. Find all matching rules, best first.
//   3. Keep every rule that matched a SPECIFIC keyword (so combined questions
//      each get answered, but a generic shared word can't fire a rule alone).
//   4. If none is specific, fall back to the single best match (so a lone
//      generic question still gets a sensible answer).
//   5. If still nothing, try a vague-follow-up reuse from history.
//   6. Otherwise use the patient's fallbackReply and reveal nothing.
//
// `history` is optional so existing callers keep working unchanged.
export function getPatientResponse(
  patient: Patient,
  studentMessage: string,
  history: ConversationTurn[] = [],
): EngineResult {
  const normalizedMessage = normalize(studentMessage);
  const weights = buildKeywordWeights(patient);

  const matches = findMatches(patient, normalizedMessage, weights);

  if (matches.length > 0) {
    // Rules that matched on a genuinely specific keyword. These are the ones we
    // trust enough to fire (and to combine for multi-part questions).
    const specificMatches = matches.filter(
      (m) => m.topKeywordWeight >= SPECIFIC_WEIGHT_THRESHOLD,
    );

    // Prefer rules with a specific hit. If none is specific, fall back to the
    // single best match ONLY when it carries some real (non-zero) weight — a
    // message that matched purely on generic framing words ("any results?")
    // must not disclose findings, so it drops through to the fallback below.
    let chosen: RuleMatch[] = [];
    if (specificMatches.length > 0) {
      chosen = specificMatches;
    } else if (matches[0].weighted > 0) {
      chosen = [matches[0]];
    }

    if (chosen.length > 0) {
      // Preserve rule order for a stable, readable combined reply.
      chosen.sort((a, b) => a.index - b.index);

      const replies: string[] = [];
      const revealedFindingIds: string[] = [];
      const seenFindingIds = new Set<string>();

      for (const match of chosen) {
        replies.push(match.rule.reply);
        for (const id of match.rule.revealsFindingIds ?? []) {
          if (!seenFindingIds.has(id)) {
            seenFindingIds.add(id);
            revealedFindingIds.push(id);
          }
        }
      }

      return {
        reply: combineReplies(replies),
        revealedFindingIds,
      };
    }
  }

  // Follow-up path: a vague "anything else?" reuses the previous topic so the
  // conversation flows, but still only returns that patient's approved reply.
  if (isVagueFollowUp(normalizedMessage)) {
    const rule = lastSpecificRuleFromHistory(patient, history, weights);
    if (rule) {
      return {
        reply: rule.reply,
        revealedFindingIds: rule.revealsFindingIds ?? [],
      };
    }
  }

  // Nothing matched — the patient honestly says the information isn't available
  // instead of guessing.
  return {
    reply: patient.fallbackReply,
    revealedFindingIds: [],
  };
}
