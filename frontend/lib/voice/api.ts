// Thin client for the backend voice routes. The browser never sees the ElevenLabs key.

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
  origin: "auto" | "faculty" | string;
};

export type Persona = {
  name: string;
  age?: number | null;
  sex?: string | null;
  personality?: string;
  communication_style?: string;
  language?: string;
  portrait_path?: string | null;
  voice?: VoiceProfile | null;
  [k: string]: unknown;
};

export type CatalogVoice = {
  voice_id: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  description: string;
  preview_url?: string | null;
};

export type Preset = {
  key: string;
  label: string;
  example: string;
  voice_id: string;
  voice_name: string;
  speed: number;
  stability: number;
  style: number;
};

export type VoicesResponse = { default_model: string; voices: CatalogVoice[]; presets: Preset[] };

export type SpeakRequest = { text: string; patient_id: string; trust?: number; deflected?: boolean };

/** Result of asking the backend for speech. `audio === null` means "use the browser voice". */
export type TTSResult = { audio: Blob | null; provider: string };

import { API_BASE } from "../api";

let base = API_BASE;
/** Point the client at another origin (default: NEXT_PUBLIC_API_URL / localhost:8000). */
export function setApiBase(url: string) {
  base = url.replace(/\/$/, "");
}

async function fetchAudio(path: string, body: unknown, signal?: AbortSignal): Promise<TTSResult> {
  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) return { audio: null, provider: "browser" };
    return { audio: await r.blob(), provider: r.headers.get("X-TTS-Provider") ?? "unknown" };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { audio: null, provider: "browser" }; // network error -> browser voice
  }
}

export const voiceApi = {
  tts: (req: SpeakRequest, signal?: AbortSignal) => fetchAudio("/tts", req, signal),
  preview: (voice: VoiceProfile, text?: string, signal?: AbortSignal) =>
    fetchAudio("/tts/preview", text ? { voice, text } : { voice }, signal),
  voices: async (): Promise<VoicesResponse> => (await fetch(`${base}/voices`)).json(),
  assign: async (persona: Persona, preset?: string): Promise<VoiceProfile> =>
    (
      await fetch(`${base}/voices/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, preset }),
      })
    ).json(),
  portraitUrl: (portrait_path?: string | null) =>
    portrait_path ? `${base}/${portrait_path.replace(/^\//, "")}` : null,
};
