import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API types aren't in lib.dom for every TS version; keep them minimal.
type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type PushToTalk = {
  supported: boolean;
  listening: boolean;
  transcript: string; // live text while holding the button
  error: string;
  start: () => void;
  stop: () => void; // releases: onFinal(text) fires once recognition settles
};

/**
 * Hold-to-talk speech recognition in the browser (best in Chrome). Speech becomes text locally
 * via the browser; we never record or upload audio ourselves. `onFinal` receives the text,
 * which the caller sends through the same path as a typed message.
 */
export function usePushToTalk(onFinal: (text: string) => void, lang = "en-US"): PushToTalk {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<SR | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";
    interimRef.current = "";
    setTranscript("");
    setError("");
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      interimRef.current = interim;
      setTranscript((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone blocked — type instead.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Speech recognition: ${e.error}`);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      const text = (finalRef.current + " " + interimRef.current).replace(/\s+/g, " ").trim();
      finalRef.current = interimRef.current = "";
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError("Could not start the microphone — type instead.");
    }
  }, [lang]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, transcript, error, start, stop };
}
