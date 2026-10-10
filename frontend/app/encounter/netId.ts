// ---------------------------------------------------------------------------
// Demo NetID helper
// ---------------------------------------------------------------------------
// Rutgers-style student identification for the hackathon DEMO ONLY.
//
// This is NOT real Rutgers authentication: we accept any alphanumeric demo
// NetID (like "abc123") without a password or SSO. The active NetID is kept in
// localStorage so the student's "My Feedback" page can filter to their own
// attempts, and so the encounter screen can prefill it next time.
// ---------------------------------------------------------------------------

// localStorage key for the currently active demo NetID.
const ACTIVE_NETID_KEY = "twinverse.activeNetId";

// Shown wherever an attempt has no NetID (older records). We never invent an
// identity — see requirement to label these as unknown.
export const UNKNOWN_STUDENT_LABEL = "Unknown student";

// A NetID is valid for the demo if it's alphanumeric and a sensible length.
// Rutgers NetIDs look like "abc123", so we allow letters and digits only.
export function isValidNetId(value: string): boolean {
  return /^[a-z0-9]{2,20}$/i.test(value.trim());
}

// Normalise a NetID for storage/compare (trim + lowercase).
export function normalizeNetId(value: string): string {
  return value.trim().toLowerCase();
}

// Read the active demo NetID (or empty string if none / not in a browser).
export function getActiveNetId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ACTIVE_NETID_KEY) ?? "";
  } catch {
    return "";
  }
}

// Save the active demo NetID.
export function setActiveNetId(netId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_NETID_KEY, normalizeNetId(netId));
  } catch {
    /* storage unavailable: fine for the demo */
  }
}

// How a NetID should be displayed. Missing/blank -> "Unknown student".
export function displayNetId(netId: string | null | undefined): string {
  if (!netId || netId.trim() === "") return UNKNOWN_STUDENT_LABEL;
  return netId;
}

// --- React hook: read the active NetID from the external store (localStorage).
// Using useSyncExternalStore keeps SSR/hydration clean and avoids reading
// localStorage inside an effect. It also refreshes if another tab changes it.
import { useSyncExternalStore } from "react";

function subscribeActiveNetId(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACTIVE_NETID_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function serverNetId(): string {
  return "";
}

// Returns the active demo NetID (or "" on the server / before one is set).
export function useActiveNetId(): string {
  return useSyncExternalStore(subscribeActiveNetId, getActiveNetId, serverNetId);
}
