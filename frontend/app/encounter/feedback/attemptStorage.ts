// ---------------------------------------------------------------------------
// Attempt storage
// ---------------------------------------------------------------------------
// Saves completed encounter attempts to localStorage for the frontend demo.
// Each attempt has a unique id. The same records power the student's "My
// Feedback" page today and can be read by a future Professor Results
// dashboard (same key, same shape).
//
// All reads/writes are guarded so they're safe during server rendering.
// ---------------------------------------------------------------------------

import type { EncounterAttempt } from "./feedbackTypes";

// The agreed localStorage key. Shared with any future Professor dashboard.
export const ATTEMPTS_STORAGE_KEY = "twinverse.encounterAttempts";

// Generate a unique-enough id for a demo (timestamp + random suffix).
export function newAttemptId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `att-${Date.now().toString(36)}-${random}`;
}

// Read all saved attempts (newest first). Returns [] if none/unavailable.
export function loadAttempts(): EncounterAttempt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ATTEMPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Sort newest first by endedAt.
    return (parsed as EncounterAttempt[])
      .slice()
      .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1));
  } catch {
    return [];
  }
}

// Save one attempt (appends — never overwrites previous results).
export function saveAttempt(attempt: EncounterAttempt): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadAttempts();
    existing.push(attempt);
    window.localStorage.setItem(
      ATTEMPTS_STORAGE_KEY,
      JSON.stringify(existing),
    );
  } catch {
    /* storage unavailable: nothing we can do in a prototype */
  }
}

// Look up one attempt by id, or null.
export function getAttempt(attemptId: string): EncounterAttempt | null {
  if (!attemptId) return null;
  return loadAttempts().find((a) => a.attemptId === attemptId) ?? null;
}
