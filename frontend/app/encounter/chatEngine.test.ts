// ---------------------------------------------------------------------------
// Tests for the clinical question matching + progressive disclosure engine.
// ---------------------------------------------------------------------------
// These lock in the fix for the ECG bug ("Can I see your ECG results?" used to
// return the blood-test reply) and the new multi-question behaviour, using
// both the real demo patient and a small synthetic patient (to prove the logic
// is generic, not hardcoded to any one patient).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getPatientResponse } from "./chatEngine";
import { demoPatient } from "./demoPatient";
import type { Patient } from "./demoPatient";

// A minimal synthetic patient with the same KINDS of overlapping keywords that
// caused the bug (a generic word "results" shared with the lab rule). Proves
// the engine works for any newly published patient.
const syntheticPatient: Patient = {
  id: "test-synthetic",
  name: "Test Patient",
  age: 40,
  gender: "Female",
  chiefComplaint: "Testing",
  greeting: "Hello.",
  fallbackReply: "I don't know about that.",
  avatarEmoji: "🧑",
  chart: [
    {
      id: "overview",
      label: "Overview",
      findings: [
        { id: "ov-1", label: "Name", value: "Test Patient", disclosed: true },
      ],
    },
    {
      id: "medications",
      label: "Medications",
      findings: [
        { id: "med-1", label: "Meds", value: "Metformin", disclosed: false },
      ],
    },
    {
      id: "imaging",
      label: "Imaging",
      findings: [
        { id: "img-ecg", label: "ECG", value: "Normal sinus", disclosed: false },
      ],
    },
    {
      id: "labs",
      label: "Labs",
      findings: [
        { id: "lab-1", label: "CBC", value: "Normal", disclosed: false },
      ],
    },
  ],
  responseRules: [
    // Lab rule listed BEFORE the ecg rule and sharing the generic word
    // "results" — this ordering + overlap is exactly what triggered the bug.
    {
      id: "r-labs",
      keywords: ["blood test", "cbc", "results"],
      reply: "They ran some blood work.",
      revealsFindingIds: ["lab-1"],
    },
    {
      id: "r-ecg",
      keywords: ["ecg", "ekg", "electrocardiogram"],
      reply: "They did a heart tracing.",
      revealsFindingIds: ["img-ecg"],
    },
    {
      id: "r-meds",
      keywords: ["medication", "medications", "meds", "pills"],
      reply: "I take metformin.",
      revealsFindingIds: ["med-1"],
    },
  ],
};

describe("ECG questions (the reported bug)", () => {
  it("'Can I see your ECG results?' reveals the ECG, not labs (demo patient)", () => {
    const res = getPatientResponse(demoPatient, "Can I see your ECG results?");
    expect(res.revealedFindingIds).toContain("img-ecg");
    expect(res.revealedFindingIds).not.toContain("lab-troponin");
    expect(res.revealedFindingIds).not.toContain("lab-bmp");
    expect(res.revealedFindingIds).not.toContain("lab-cbc");
  });

  it("'ECG results' reveals the ECG, not labs (synthetic patient)", () => {
    const res = getPatientResponse(syntheticPatient, "Can I see your ECG results?");
    expect(res.revealedFindingIds).toEqual(["img-ecg"]);
    expect(res.reply).toBe("They did a heart tracing.");
  });

  it("plain 'ekg' also matches the ECG rule", () => {
    const res = getPatientResponse(demoPatient, "Did you get an EKG?");
    expect(res.revealedFindingIds).toContain("img-ecg");
  });
});

describe("Medication questions", () => {
  it("'What medications are you taking?' reveals meds (demo patient)", () => {
    const res = getPatientResponse(demoPatient, "What medications are you taking?");
    expect(res.revealedFindingIds).toContain("med-lisinopril");
    expect(res.revealedFindingIds).toContain("med-atorvastatin");
    // Should not leak unrelated areas.
    expect(res.revealedFindingIds).not.toContain("img-ecg");
    expect(res.revealedFindingIds).not.toContain("lab-troponin");
  });

  it("reveals meds for the synthetic patient", () => {
    const res = getPatientResponse(syntheticPatient, "What meds are you on?");
    expect(res.revealedFindingIds).toEqual(["med-1"]);
  });
});

describe("Combined questions in one message", () => {
  it("'What meds are you on and can I see the ECG?' reveals BOTH (synthetic)", () => {
    const res = getPatientResponse(
      syntheticPatient,
      "What meds are you on and can I see the ECG?",
    );
    expect(res.revealedFindingIds).toContain("med-1");
    expect(res.revealedFindingIds).toContain("img-ecg");
    // Must not reveal the unrelated lab finding.
    expect(res.revealedFindingIds).not.toContain("lab-1");
    // Combined reply mentions both topics.
    expect(res.reply).toContain("metformin");
    expect(res.reply).toContain("heart tracing");
  });

  it("combined meds + ECG also works for the demo patient", () => {
    const res = getPatientResponse(
      demoPatient,
      "Can I see the ECG and what medications do you take?",
    );
    expect(res.revealedFindingIds).toContain("img-ecg");
    expect(res.revealedFindingIds).toContain("med-lisinopril");
  });

  it("does not duplicate finding ids when rules overlap", () => {
    const res = getPatientResponse(
      demoPatient,
      "Tell me about the x-ray and the ECG",
    );
    // Both imaging rules reveal img-ecg; it should appear only once.
    const occurrences = res.revealedFindingIds.filter((id) => id === "img-ecg");
    expect(occurrences).toHaveLength(1);
  });
});

describe("Unrelated questions reveal nothing and invent nothing", () => {
  it("'What's your favorite color?' uses the fallback and reveals nothing", () => {
    const res = getPatientResponse(demoPatient, "What's your favorite color?");
    expect(res.revealedFindingIds).toEqual([]);
    expect(res.reply).toBe(demoPatient.fallbackReply);
  });

  it("a generic word alone ('any results?') does not fire the lab rule", () => {
    const res = getPatientResponse(syntheticPatient, "any results?");
    // "results" is generic framing; with no specific topic word, it must not
    // reveal the lab finding on its own.
    expect(res.revealedFindingIds).not.toContain("lab-1");
  });

  it("only discloses ids that exist in the patient profile", () => {
    const res = getPatientResponse(demoPatient, "Can I see your ECG?");
    const validIds = new Set(
      demoPatient.chart.flatMap((s) => s.findings.map((f) => f.id)),
    );
    for (const id of res.revealedFindingIds) {
      expect(validIds.has(id)).toBe(true);
    }
  });
});
