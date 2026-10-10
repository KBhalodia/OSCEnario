// ---------------------------------------------------------------------------
// Demo patient data
// ---------------------------------------------------------------------------
// This file holds ONLY data. It describes a single synthetic (fake) demo
// patient. There is no UI code and no app logic here on purpose:
//
//   - It keeps "what the patient knows" separate from "how the screen looks".
//   - Later, a backend can send a patient in this exact shape and the
//     encounter screen will work without any UI changes.
//
// Everything below is made-up example data. There is no real person and no
// real medical record here.
// ---------------------------------------------------------------------------

// A single tab of the medical chart (Overview, History, etc.).
export type ChartSection = {
  id: ChartTabId;
  label: string;
  // Each "finding" is one row of information in the chart.
  findings: ChartFinding[];
};

// The five chart tabs we support. Using a union of strings (instead of a plain
// string) means TypeScript will warn us if we ever mistype a tab name.
export type ChartTabId =
  | "overview"
  | "history"
  | "medications"
  | "labs"
  | "imaging";

// One line item in the chart.
//
//   - `label`     short title, e.g. "Blood pressure"
//   - `value`     the detail, e.g. "148/92 mmHg"
//   - `disclosed` whether the student has "unlocked" this by asking about it.
//                 Overview facts start visible; most others start hidden so the
//                 student has to interview the patient to reveal them.
export type ChartFinding = {
  id: string;
  label: string;
  value: string;
  disclosed: boolean;
};

// A rule the chat engine uses to answer the student.
//
//   - `keywords`     if the student's message contains ANY of these words,
//                    this rule matches.
//   - `reply`        what the patient says back.
//   - `revealsFindingIds` chart findings to unlock when this rule matches
//                    (progressive disclosure). Optional.
export type PatientResponseRule = {
  id: string;
  keywords: string[];
  reply: string;
  revealsFindingIds?: string[];
};

// The full shape of a patient. A backend could later return exactly this.
export type Patient = {
  id: string;
  name: string;
  age: number;
  gender: string;
  chiefComplaint: string;
  // A short, friendly greeting the patient opens the encounter with.
  greeting: string;
  // What the patient says if no rule matches (they don't make things up).
  fallbackReply: string;
  // Emoji used as a simple stand-in for a patient portrait (no real photos).
  avatarEmoji: string;
  chart: ChartSection[];
  responseRules: PatientResponseRule[];
};

// ---------------------------------------------------------------------------
// The demo patient: "Jordan Avery" — a synthetic case.
// ---------------------------------------------------------------------------
export const demoPatient: Patient = {
  id: "demo-jordan-avery",
  name: "Jordan Avery",
  age: 54,
  gender: "Male",
  chiefComplaint: "Chest discomfort for the past 2 hours",
  avatarEmoji: "🧑🏽",
  greeting:
    "Hi doctor. I've been having some chest discomfort for a couple of hours now and it's got me a bit worried.",
  fallbackReply:
    "Hmm, I'm not sure about that. I don't really know how to answer that one.",

  // --- Chart ---------------------------------------------------------------
  // Overview facts are visible from the start (basic demographics / vitals a
  // student would see on arrival). Most history, meds, labs, and imaging start
  // hidden and are revealed only when the student asks relevant questions.
  chart: [
    {
      id: "overview",
      label: "Overview",
      findings: [
        { id: "ov-name", label: "Name", value: "Jordan Avery", disclosed: true },
        { id: "ov-age", label: "Age", value: "54 years", disclosed: true },
        { id: "ov-sex", label: "Sex", value: "Male", disclosed: true },
        {
          id: "ov-cc",
          label: "Chief complaint",
          value: "Chest discomfort for 2 hours",
          disclosed: true,
        },
        {
          id: "ov-vitals",
          label: "Vitals",
          value: "BP 148/92 · HR 96 · RR 18 · Temp 37.0°C · SpO₂ 97%",
          disclosed: true,
        },
      ],
    },
    {
      id: "history",
      label: "History",
      findings: [
        {
          id: "hx-onset",
          label: "Onset & character",
          value:
            "Pressure-like discomfort started ~2 hours ago while mowing the lawn.",
          disclosed: false,
        },
        {
          id: "hx-radiation",
          label: "Radiation",
          value: "Radiates to the left arm and jaw.",
          disclosed: false,
        },
        {
          id: "hx-associated",
          label: "Associated symptoms",
          value: "Mild shortness of breath and sweating. No nausea.",
          disclosed: false,
        },
        {
          id: "hx-pmh",
          label: "Past medical history",
          value: "High blood pressure and high cholesterol.",
          disclosed: false,
        },
        {
          id: "hx-family",
          label: "Family history",
          value: "Father had a heart attack at age 60.",
          disclosed: false,
        },
        {
          id: "hx-social",
          label: "Social history",
          value: "Former smoker (quit 5 years ago). Drinks socially.",
          disclosed: false,
        },
      ],
    },
    {
      id: "medications",
      label: "Medications",
      findings: [
        {
          id: "med-lisinopril",
          label: "Lisinopril 10 mg",
          value: "Once daily for blood pressure.",
          disclosed: false,
        },
        {
          id: "med-atorvastatin",
          label: "Atorvastatin 20 mg",
          value: "Once daily at night for cholesterol.",
          disclosed: false,
        },
        {
          id: "med-allergy",
          label: "Allergies",
          value: "No known drug allergies.",
          disclosed: false,
        },
      ],
    },
    {
      id: "labs",
      label: "Labs",
      findings: [
        {
          id: "lab-troponin",
          label: "Troponin I",
          value: "0.12 ng/mL (elevated — reference < 0.04).",
          disclosed: false,
        },
        {
          id: "lab-bmp",
          label: "Basic metabolic panel",
          value: "Within normal limits.",
          disclosed: false,
        },
        {
          id: "lab-cbc",
          label: "Complete blood count",
          value: "Within normal limits.",
          disclosed: false,
        },
      ],
    },
    {
      id: "imaging",
      label: "Imaging",
      findings: [
        {
          id: "img-ecg",
          label: "ECG",
          value: "ST-segment depression in the lateral leads.",
          disclosed: false,
        },
        {
          id: "img-cxr",
          label: "Chest X-ray",
          value: "No acute findings. Heart size normal.",
          disclosed: false,
        },
      ],
    },
  ],

  // --- Response rules ------------------------------------------------------
  // The chat engine checks these top-to-bottom. The FIRST rule whose keywords
  // appear in the student's message wins. Keep more specific rules near the
  // top. If nothing matches, the patient uses `fallbackReply` and invents
  // nothing.
  responseRules: [
    {
      id: "r-onset",
      keywords: [
        "when",
        "start",
        "started",
        "begin",
        "began",
        "beginning",
        "onset",
        "how long",
        "since when",
        "come on",
        "came on",
        "first notice",
        "first feel",
        "doing when",
        "what were you doing",
      ],
      reply:
        "It started about two hours ago while I was mowing the lawn. It came on pretty gradually.",
      revealsFindingIds: ["hx-onset"],
    },
    {
      id: "r-character",
      keywords: [
        "describe",
        "description",
        "feel like",
        "feels like",
        "what kind",
        "what type",
        "character",
        "quality",
        "sharp",
        "dull",
        "burning",
        "stabbing",
        "aching",
        "tight",
        "tightness",
        "pressure",
        "squeeze",
        "squeezing",
        "crushing",
        "heavy",
        "heaviness",
      ],
      reply:
        "It feels like a heavy pressure in the middle of my chest, like something is sitting on it.",
      revealsFindingIds: ["hx-onset"],
    },
    {
      id: "r-severity",
      keywords: [
        "severe",
        "severity",
        "how bad",
        "how strong",
        "how intense",
        "intense",
        "worst",
        "scale",
        "rate",
        "rating",
        "out of ten",
        "out of 10",
        "mild or severe",
      ],
      reply:
        "It's a strong, heavy pressure — enough to really worry me — but I couldn't put an exact number on it.",
      revealsFindingIds: ["hx-onset"],
    },
    {
      id: "r-radiation",
      keywords: [
        "radiate",
        "radiates",
        "radiating",
        "radiation",
        "spread",
        "spreads",
        "spreading",
        "travel",
        "move",
        "moves",
        "go anywhere",
        "arm",
        "arms",
        "jaw",
        "shoulder",
        "shoulders",
        "neck",
        "back",
      ],
      reply:
        "Yeah, it kind of spreads into my left arm and up into my jaw.",
      revealsFindingIds: ["hx-radiation"],
    },
    {
      id: "r-associated",
      keywords: [
        "short of breath",
        "shortness",
        "breath",
        "breathing",
        "breathe",
        "sweat",
        "sweating",
        "sweaty",
        "clammy",
        "nausea",
        "nauseous",
        "vomit",
        "dizzy",
        "dizziness",
        "lightheaded",
        "palpitations",
        "other symptom",
        "other symptoms",
        "any other",
        "associated",
      ],
      reply:
        "I've been a little short of breath and sweaty. I don't feel nauseous though.",
      revealsFindingIds: ["hx-associated"],
    },
    {
      id: "r-pmh",
      keywords: [
        "medical history",
        "past medical",
        "medical problems",
        "any conditions",
        "condition",
        "conditions",
        "diagnosed",
        "diagnosis",
        "high blood pressure",
        "blood pressure",
        "hypertension",
        "cholesterol",
        "diabetes",
        "pre-existing",
        "preexisting",
        "health problems",
        "chronic",
        "illness",
        "illnesses",
      ],
      reply:
        "I've got high blood pressure and high cholesterol. Both are managed with pills.",
      revealsFindingIds: ["hx-pmh"],
    },
    {
      id: "r-family",
      keywords: [
        "family",
        "family history",
        "father",
        "dad",
        "mother",
        "mom",
        "parents",
        "siblings",
        "brother",
        "sister",
        "hereditary",
        "genetic",
        "runs in",
        "relatives",
      ],
      reply:
        "My dad had a heart attack when he was 60. That's actually part of why I'm nervous.",
      revealsFindingIds: ["hx-family"],
    },
    {
      id: "r-social",
      keywords: [
        "smoke",
        "smoking",
        "smoker",
        "tobacco",
        "cigarette",
        "cigarettes",
        "vape",
        "drink",
        "drinking",
        "alcohol",
        "exercise",
        "social history",
        "social",
        "lifestyle",
        "occupation",
        "job",
        "work",
      ],
      reply:
        "I used to smoke but quit about five years ago. I only drink socially.",
      revealsFindingIds: ["hx-social"],
    },
    {
      id: "r-meds",
      keywords: [
        "medication",
        "medications",
        "medicine",
        "medicines",
        "meds",
        "pills",
        "pill",
        "taking",
        "take any",
        "prescribed",
        "prescription",
        "drugs",
        "lisinopril",
        "atorvastatin",
        "statin",
      ],
      reply:
        "I take lisinopril for my blood pressure and atorvastatin at night for cholesterol.",
      revealsFindingIds: ["med-lisinopril", "med-atorvastatin"],
    },
    {
      id: "r-allergy",
      keywords: [
        "allergy",
        "allergic",
        "allergies",
        "reaction to",
        "intolerance",
      ],
      reply: "No, I don't have any drug allergies that I know of.",
      revealsFindingIds: ["med-allergy"],
    },
    {
      id: "r-labs",
      keywords: [
        "lab",
        "labs",
        "blood test",
        "blood tests",
        "troponin",
        "bloodwork",
        "blood work",
        "panel",
        "cbc",
        "metabolic",
        "test results",
        "results",
      ],
      reply:
        "The nurse mentioned they ran some blood tests. You'd know more about the results than I would.",
      revealsFindingIds: ["lab-troponin", "lab-bmp", "lab-cbc"],
    },
    {
      id: "r-ecg",
      keywords: [
        "ecg",
        "ekg",
        "heart tracing",
        "electrocardiogram",
        "heart monitor",
        "heart trace",
      ],
      reply:
        "They hooked me up to that heart machine earlier, yeah. The stickers are still on my chest.",
      revealsFindingIds: ["img-ecg"],
    },
    {
      id: "r-imaging",
      keywords: [
        "x-ray",
        "xray",
        "x ray",
        "imaging",
        "scan",
        "chest film",
        "radiograph",
        "ct",
        "picture of your chest",
      ],
      reply:
        "They took a chest X-ray in the other room a little while ago.",
      revealsFindingIds: ["img-cxr", "img-ecg"],
    },
    {
      id: "r-greeting",
      keywords: [
        "hello",
        "hi",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
        "your name",
        "who are you",
        "introduce",
      ],
      reply:
        "Hi doctor, I'm Jordan. Thanks for seeing me — I'm hoping you can figure out what's going on.",
    },
  ],
};
