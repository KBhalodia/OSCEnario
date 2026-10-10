// ---------------------------------------------------------------------------
// One typed client for the Twinverse backend (FastAPI, app/main.py).
// Every page talks to the backend through this file, so there is exactly one
// place to change the URL or an endpoint.
//
// The browser calls the backend directly (CORS is enabled there for :3000).
// Set NEXT_PUBLIC_API_URL in frontend/.env.local if the backend isn't on :8000.
// No secrets live in the frontend: AWS and ElevenLabs keys stay in backend/.env.
// ---------------------------------------------------------------------------

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function readable(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d))).join("; ");
  return "Request failed";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, `Can't reach the backend at ${API_BASE}. Is uvicorn running?`);
  }
  const text = await r.text();
  const body = text ? safeJson(text) : null;
  if (!r.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : body ?? text;
    throw new ApiError(r.status, readable(detail), detail);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const fileUrl = (path?: string | null) => (path ? `${API_BASE}/${path.replace(/^\//, "")}` : null);

// ------------------------------- types --------------------------------------

export type Issue = { severity: "error" | "warning" | "info"; code: string; message: string; refs: string[] };

export type PatientSummary = {
  id: string;
  name: string;
  age: number | null;
  sex: string | null;
  status?: "draft" | "published";
  version?: number;
  primary_diagnosis?: string;
  description?: string;
  portrait: string | null;
  student_role?: string;
  has_voice: boolean;
};

export type Disclosure = "initial" | "discoverable" | "reluctant" | "hidden" | "chart";
export type Origin = "faculty" | "dataset" | "generated";

export type Fact = {
  id: string;
  category: string;
  topic: string;
  content: string;
  disclosure: Disclosure;
  min_trust: number;
  show_in_chart: boolean;
  origin: Origin;
  source_path?: string | null;
};

export type Artifact = {
  id: string;
  type: string;
  title: string;
  items: { label: string; value: string; flag?: string | null }[];
  text?: string | null;
  file_path?: string | null;
  release: { trigger: "at_start" | "on_request" | "after_fact" | "manual"; request_keywords: string[]; after_fact_id?: string | null };
  origin: Origin;
};

export type VoiceProfile = {
  provider: string;
  voice_id: string;
  model_id: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  fallback_polly_voice: string;
  preset: string;
  origin: string;
};

export type Persona = {
  name: string;
  age?: number | null;
  sex?: string | null;
  description: string;
  personality: string;
  communication_style: string;
  occupation: string;
  language: string;
  portrait_path?: string | null;
  voice?: VoiceProfile | null;
  [k: string]: unknown;
};

export type Objective = {
  id: string;
  objective: string;
  expected_discoveries: { id: string; text: string; linked_fact_ids: string[]; link_method: string }[];
  points?: number | null;
  min_level?: string | null;
};

export type PatientProfile = {
  id: string;
  status: "draft" | "published";
  version: number;
  persona: Persona;
  settings: {
    student_role: string;
    encounter_goal: string;
    setting: string;
    rubric_id: string;
    checklist_rubric_ids: string[];
    opening_trust: number;
    difficulty_notes: string;
  };
  primary_diagnosis: string;
  secondary_diagnoses: string[];
  facts: Fact[];
  artifacts: Artifact[];
  objectives: Objective[];
  documents: { id: string; name: string; kind: string; file_path?: string | null; summary: string }[];
  assumptions: string[];
  [k: string]: unknown;
};

export type Level = {
  key: string;
  label: string;
  expectations: string;
  patient_difficulty: string;
  domains: { key: string; name: string; mode: string; mode_label: string }[];
  [k: string]: unknown;
};

export type GradingConfig = { levels: Level[]; [k: string]: unknown };

export type Rubric = { id: string; title: string; type: string; max_points?: number | null };

export type Assignment = {
  id: string;
  patient_id: string;
  patient_name: string;
  title: string;
  level: string;
  level_label: string;
  student_ids: string[];
  checklist_rubric_ids: string[];
  due_date?: string | null;
  max_attempts?: number | null;
  created_by?: string | null;
  instructions: string;
  created_at: string;
};

export type ChartView = {
  patient: { name: string; age: number | null; sex: string | null; portrait: string | null };
  trust: number;
  facts_by_category: Record<string, { id: string; text: string; topic: string }[]>;
  artifacts: Artifact[];
  locked_artifacts: { id: string; title: string; type: string }[];
  progress: { disclosed: number; total: number };
};

export type EncounterStart = {
  encounter_id: string;
  level: string;
  level_label: string;
  patient: PatientSummary;
  chart: ChartView;
};

export type TurnResponse = {
  reply: string;
  turn: number;
  trust: number;
  deflected: boolean;
  tags: string[];
  new_facts: { id: string; text: string; category: string }[];
  new_artifacts: Artifact[];
  chart: ChartView;
};

export type EncounterRow = {
  id: string;
  patient_id: string;
  patient_name: string;
  student_id: string | null;
  assignment_id: string | null;
  level: string;
  status: "active" | "completed" | "grading_failed";
  created_at: string;
  ended_at?: string | null;
  preview?: boolean;
  total: number | null;
  max_total: number | null;
};

export type TranscriptTurn = { n: number; speaker: "student" | "patient"; text: string; at: string };

export type Evidence = { turn: number; quote: string };

export type Feedback = {
  encounter_id: string;
  patient_name: string;
  student_id: string | null;
  level: string;
  level_label: string;
  total: number;
  max_total: number;
  domains: {
    key: string;
    id: number;
    name: string;
    mode: string;
    score: string;
    rationale: string;
    evidence: Evidence[];
    strength_demonstrated: string;
    important_gap_or_missed_opportunity: string;
    safety_or_accuracy_concern: string;
  }[];
  objectives: {
    id: string;
    objective: string;
    found: number;
    total: number;
    items: { id: string; text: string; status: string; turn: number | null; comment?: string }[];
  }[];
  checklists: {
    id: string;
    title: string;
    score: number;
    max_points: number;
    original_max_points: number;
    percent: number;
    excluded: { section: string; item: string; missing: string; points_removed: number }[];
    sections: {
      id: string;
      name: string;
      points: number;
      earned: number;
      applicable: boolean;
      items: { id: string; text: string; status: string; points: number; max_points: number; evidence?: Evidence[] }[];
    }[];
  }[];
  epas: {
    id: string;
    title: string;
    simulation_note?: string;
    target_level: number;
    target_label: string;
    estimated_level: number | null;
    estimated_label: string | null;
    meets_target: boolean | null;
    rationale: string;
    evidence: Evidence[];
    faculty_confirmed_level?: number | null;
  }[];
  epas_not_assessed: { id: string; title?: string; reason: string }[];
  communication: Record<string, unknown>;
  strengths: string[];
  areas_for_improvement: string[];
  next_attempt_suggestions: string[];
  summary: string;
  needs_review: boolean;
  review_reasons: string[];
  faculty_notes: string;
  faculty_review?: { notes: string; reviewed_by: string | null; reviewed_at: string | null };
};

export type EncounterDetail = {
  id: string;
  patient_id: string;
  student_id: string | null;
  assignment_id: string | null;
  level: string;
  status: string;
  created_at: string;
  ended_at?: string | null;
  patient: PatientSummary;
  transcript: TranscriptTurn[];
  chart: ChartView;
  feedback: Feedback | null;
};

export type AssignmentResults = {
  assignment: Assignment;
  attempts: {
    encounter_id: string;
    student_id: string | null;
    status: string;
    started_at: string;
    ended_at?: string | null;
    total: number | null;
    max_total: number | null;
    needs_review: boolean | null;
    domain_scores: Record<string, string> | null;
    epas: { id: string; estimated_label: string | null; meets_target: boolean | null }[] | null;
    checklists: { id: string; score: number; max_points: number }[] | null;
  }[];
};

export type FacultyInput = {
  name: string;
  age?: number | null;
  gender?: string;
  ethnicity?: string;
  background?: string;
  personality?: string;
  notes?: string;
  summary?: string;
  student_role?: string;
  encounter_goal?: string;
  setting?: string;
};

export type DocKind = "patient_record" | "reference";

// ------------------------------- calls --------------------------------------

export const api = {
  health: () => request<{ ok: boolean; voice: boolean; levels: string[] }>("/health"),
  gradingConfig: () => request<GradingConfig>("/config/grading"),
  rubrics: () => request<Rubric[]>("/rubrics"),

  // Studio
  patients: (status?: string) => request<PatientSummary[]>(`/patients${status ? `?status=${status}` : ""}`),
  patient: (id: string) => request<PatientProfile>(`/patients/${encodeURIComponent(id)}`),
  savePatient: (p: PatientProfile) =>
    request<{ patient: PatientProfile; issues: Issue[] }>(`/patients/${encodeURIComponent(p.id)}`, json("PUT", p)),
  importSamples: () => request<{ imported_count: number }>("/patients/import", { method: "POST" }),
  generate: (brief: FacultyInput, files: { file: File; kind: DocKind }[], checklistIds: string[]) => {
    const fd = new FormData();
    fd.append("brief", JSON.stringify(brief));
    fd.append("kinds", JSON.stringify(files.map((f) => f.kind)));
    fd.append("checklist_rubric_ids", JSON.stringify(checklistIds));
    for (const f of files) fd.append("files", f.file, f.file.name);
    return request<{ patient: PatientProfile; issues: Issue[] }>("/patients/generate", { method: "POST", body: fd });
  },
  addDocument: (id: string, file: File, kind: DocKind) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("kind", kind);
    return request<{ patient: PatientProfile; issues: Issue[] }>(`/patients/${encodeURIComponent(id)}/documents`, {
      method: "POST",
      body: fd,
    });
  },
  uploadPortrait: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("patient_id", id);
    return request<{ portrait: string }>("/portraits", { method: "POST", body: fd });
  },
  validate: (id: string) =>
    request<{ valid: boolean; issues: Issue[] }>(`/patients/${encodeURIComponent(id)}/validate`, { method: "POST" }),
  relink: (id: string) =>
    request<{ patient: PatientProfile; issues: Issue[] }>(`/patients/${encodeURIComponent(id)}/link`, { method: "POST" }),
  publish: (id: string, force = false) =>
    request<{ patient: PatientSummary; issues: Issue[] }>(
      `/patients/${encodeURIComponent(id)}/publish${force ? "?force=true" : ""}`,
      { method: "POST" },
    ),

  // Assignments
  createAssignment: (a: {
    patient_id: string;
    level: string;
    student_ids: string[];
    title?: string;
    checklist_rubric_ids?: string[];
    due_date?: string | null;
    max_attempts?: number | null;
    created_by?: string | null;
    instructions?: string;
  }) => request<Assignment>("/assignments", json("POST", a)),
  assignments: (q: { student_id?: string; created_by?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return request<Assignment[]>(`/assignments${p.toString() ? `?${p}` : ""}`);
  },
  assignment: (id: string) => request<Assignment>(`/assignments/${encodeURIComponent(id)}`),
  results: (id: string) => request<AssignmentResults>(`/assignments/${encodeURIComponent(id)}/results`),

  // Encounters
  startEncounter: (b: { assignment_id?: string; patient_id?: string; student_id?: string; level?: string; preview?: boolean }) =>
    request<EncounterStart>("/encounters", json("POST", b)),
  send: (id: string, message: string) =>
    request<TurnResponse>(`/encounters/${encodeURIComponent(id)}/message`, json("POST", { message })),
  end: (id: string) => request<Feedback>(`/encounters/${encodeURIComponent(id)}/end`, { method: "POST" }),
  encounters: (q: { student_id?: string; assignment_id?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return request<EncounterRow[]>(`/encounters${p.toString() ? `?${p}` : ""}`);
  },
  encounter: (id: string) => request<EncounterDetail>(`/encounters/${encodeURIComponent(id)}`),
  facultyReview: (
    id: string,
    r: { notes: string; reviewed_by?: string | null; epa_confirmed_levels?: Record<string, number>; clear_review_flag?: boolean },
  ) => request<Feedback>(`/encounters/${encodeURIComponent(id)}/feedback/faculty`, json("PUT", r)),
};
