"use client";

// ---------------------------------------------------------------------------
// TranscriptView — read-only chat transcript
// ---------------------------------------------------------------------------
// Renders the saved conversation from an attempt (student questions + patient
// responses) so professors can review exactly what was asked and answered.
// Pure UI: it shows only what's stored on the attempt and invents nothing.
// ---------------------------------------------------------------------------

import type { TranscriptTurn } from "./feedbackTypes";

export default function TranscriptView({
  transcript,
}: {
  transcript: TranscriptTurn[];
}) {
  if (!transcript || transcript.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
        No messages were recorded for this encounter.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {transcript.map((turn, i) => {
        const isStudent = turn.sender === "student";
        return (
          <div
            key={i}
            className={isStudent ? "flex justify-end" : "flex justify-start"}
          >
            <div className="max-w-[80%]">
              <span
                className={
                  "mb-1 block text-[10px] font-semibold uppercase tracking-wide " +
                  (isStudent ? "text-right text-teal-600" : "text-slate-400")
                }
              >
                {isStudent ? "Student" : "Patient"}
              </span>
              <div
                className={
                  "rounded-2xl px-4 py-2.5 text-sm leading-relaxed " +
                  (isStudent
                    ? "rounded-br-sm bg-teal-600 text-white"
                    : "rounded-bl-sm bg-slate-100 text-slate-800")
                }
              >
                {turn.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
