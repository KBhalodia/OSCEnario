import { useCallback, useEffect, useRef, useState } from "react";
import { voiceApi, type Persona } from "./api";

export type PlayerStatus = "idle" | "loading" | "speaking";

export type SpeakArgs = {
  text: string;
  patientId: string;
  persona?: Persona | null; // used only to shape the browser fallback voice
  trust?: number;
  deflected?: boolean;
};

const DEFLECT_PAUSE_MS = 650;

/**
 * Plays a patient reply: backend /tts audio (ElevenLabs or Polly), or the browser's own
 * speechSynthesis if the backend can't. Never records or stores anything.
 *
 * `levelRef.current` (0..1) follows the audio loudness for the avatar animation, updated
 * every animation frame without re-rendering React.
 */
export function useVoicePlayer() {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [provider, setProvider] = useState<string>("");
  const levelRef = useRef(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const fakeLevelRef = useRef(0); // browser TTS has no audio stream; pulse on word boundaries

  /** Call from a click/keypress handler once, so the browser allows audio playback. */
  const unlock = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
    if (!ctxRef.current) {
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaElementSource(audioRef.current);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.7;
        src.connect(an);
        an.connect(ctx.destination);
        ctxRef.current = ctx;
        analyserRef.current = an;
      } catch {
        /* no Web Audio: audio still plays, avatar just won't pulse */
      }
    }
    void ctxRef.current?.resume();
  }, []);

  const meter = useCallback(() => {
    const an = analyserRef.current;
    let lvl = 0;
    if (an && audioRef.current && !audioRef.current.paused) {
      const buf = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    } else {
      fakeLevelRef.current *= 0.9;
      lvl = fakeLevelRef.current;
    }
    levelRef.current = levelRef.current * 0.6 + lvl * 0.4;
    rafRef.current = requestAnimationFrame(meter);
  }, []);

  const finish = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    levelRef.current = 0;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current); // drop the audio from memory
    urlRef.current = null;
    setStatus("idle");
  }, []);

  /** Barge-in: stop whatever the patient is saying right now. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    finish();
  }, [finish]);

  const speakWithBrowser = useCallback(
    (text: string, persona?: Persona | null, speed = 1) =>
      new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = Math.max(0.8, Math.min(1.2, speed));
        const sex = (persona?.sex ?? "").toLowerCase();
        const age = persona?.age ?? 40;
        u.pitch = (sex.startsWith("f") ? 1.1 : sex.startsWith("m") ? 0.9 : 1) - (age > 60 ? 0.1 : 0);
        const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
        const want = sex.startsWith("f") ? /samantha|victoria|karen|zira|jenny|aria|female/i
          : sex.startsWith("m") ? /alex|daniel|fred|david|guy|male/i : /./;
        u.voice = voices.find((v) => want.test(v.name)) ?? voices[0] ?? null;
        u.onstart = () => setStatus("speaking");
        u.onboundary = () => (fakeLevelRef.current = 0.8);
        u.onend = u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      }),
    [],
  );

  const speak = useCallback(
    async ({ text, patientId, persona, trust, deflected }: SpeakArgs) => {
      stop();
      if (!text.trim()) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus("loading");
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(meter);
      try {
        const [res] = await Promise.all([
          voiceApi.tts({ text, patient_id: patientId, trust, deflected }, ac.signal),
          deflected ? new Promise((r) => setTimeout(r, DEFLECT_PAUSE_MS)) : null,
        ]);
        if (ac.signal.aborted) return;
        setProvider(res.provider);
        const a = audioRef.current;
        if (res.audio && a) {
          urlRef.current = URL.createObjectURL(res.audio);
          a.src = urlRef.current;
          try {
            await new Promise<void>((resolve, reject) => {
              a.onended = () => resolve();
              a.onerror = () => reject(new Error("audio error"));
              a.play().then(() => setStatus("speaking"), reject);
            });
          } catch {
            if (!ac.signal.aborted) {
              setProvider("browser");
              await speakWithBrowser(text, persona, persona?.voice?.speed);
            }
          }
        } else {
          setProvider("browser");
          await speakWithBrowser(text, persona, persona?.voice?.speed);
        }
      } catch {
        /* aborted (barge-in) or failed: text is already on screen, nothing else to do */
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          finish();
        }
      }
    },
    [finish, meter, speakWithBrowser, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { status, provider, levelRef, speak, stop, unlock };
}
