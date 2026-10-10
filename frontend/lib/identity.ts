// ---------------------------------------------------------------------------
// Demo identity (no real login in the prototype)
// ---------------------------------------------------------------------------
// Students type a Rutgers-style NetID (e.g. "abc123"). It's kept in
// localStorage so their assignments and feedback load next time. This is NOT
// authentication. Faculty use one fixed demo id.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";

const NETID_KEY = "twinverse.activeNetId";
export const FACULTY_ID = "faculty-demo";

export function isValidNetId(value: string): boolean {
  return /^[a-z0-9]{2,20}$/i.test(value.trim());
}

export function normalizeNetId(value: string): string {
  return value.trim().toLowerCase();
}

const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(NETID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setActiveNetId(netId: string): void {
  try {
    window.localStorage.setItem(NETID_KEY, normalizeNetId(netId));
  } catch {
    /* storage unavailable: fine for the demo */
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key === NETID_KEY && onChange();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The active demo NetID ("" before one is set or during server rendering). */
export function useActiveNetId(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}
