"use client";

import { useState } from "react";
import { Card, btn, input } from "./AppShell";
import { isValidNetId, normalizeNetId, setActiveNetId } from "@/lib/identity";

export default function NetIdGate() {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = () => {
    if (!isValidNetId(draft)) {
      setErr("Letters and numbers only, e.g. abc123.");
      return;
    }
    setActiveNetId(normalizeNetId(draft));
  };
  return (
    <Card title="Who are you?" hint="Demo sign-in: type your NetID. This is not real Rutgers authentication.">
      <div className="flex max-w-sm gap-2">
        <input className={input} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="abc123" />
        <button className={btn.primary} type="button" onClick={go}>
          Continue
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
    </Card>
  );
}
