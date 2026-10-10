// ---------------------------------------------------------------------------
// useRole — the demo-only Professor/Student role switch
// ---------------------------------------------------------------------------
// This is NOT authentication. It's a lightweight toggle so one person can demo
// both the faculty and student views in the same browser. The chosen role is
// saved in localStorage so it survives a page refresh.
//
// We use `useSyncExternalStore` because the role lives in an EXTERNAL store
// (the browser's localStorage). That hook is designed exactly for this: it
// gives a server snapshot for SSR and a client snapshot after hydration,
// without us manually juggling setState inside an effect.
// ---------------------------------------------------------------------------

import { useCallback, useSyncExternalStore } from "react";

// The two roles the demo supports.
export type Role = "professor" | "student";

// The localStorage key we persist the role under.
const ROLE_STORAGE_KEY = "twinverse.role";

// The role used before the user has chosen one.
const DEFAULT_ROLE: Role = "professor";

// --- External store plumbing ------------------------------------------------

// Components that want to re-render when the role changes subscribe here. We
// also listen to the window "storage" event so switching the role in one tab
// updates any other open tab (handy when demoing Studio + Encounter together).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ROLE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

// The client snapshot: the role currently in localStorage (or the default).
function getClientSnapshot(): Role {
  try {
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    return saved === "student" || saved === "professor" ? saved : DEFAULT_ROLE;
  } catch {
    return DEFAULT_ROLE;
  }
}

// The server snapshot: localStorage doesn't exist during SSR, so use the
// default. This also matches the first client render, avoiding a hydration
// mismatch.
function getServerSnapshot(): Role {
  return DEFAULT_ROLE;
}

// --- Public hook ------------------------------------------------------------

// Returns:
//   - role     the current role ("professor" by default)
//   - setRole  choose a role explicitly (persists + notifies subscribers)
export function useRole() {
  const role = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const setRole = useCallback((next: Role) => {
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the demo keeps working for this tab */
    }
    // Tell every subscriber in THIS tab to re-read the snapshot. (The native
    // "storage" event only fires in OTHER tabs, so we notify ourselves here.)
    notify();
  }, []);

  return { role, setRole };
}
