"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

type Props = {
  name: string;
  portraitUrl?: string | null; // never substitute another patient's photo
  state: AvatarState;
  levelRef?: MutableRefObject<number>; // 0..1 loudness from useVoicePlayer
  trust?: number; // optional, purely visual mood hint
  size?: number;
  color?: string; // solid circle behind initials when there is no photo (call style)
};

const MOOD = ["Guarded", "Wary", "Opening up", "At ease"];
const STATE_LABEL: Record<AvatarState, string> = {
  idle: "",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * The patient's portrait with a subtle, audio-driven sound ring while speaking.
 * No cartoon mouth on a real photo; animation is a glow around it.
 */
export function PatientAvatar({ name, portraitUrl, state, levelRef, trust, size = 168, color }: Props) {
  const ringRef = useRef<HTMLDivElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imgOk = failedUrl !== portraitUrl;

  useEffect(() => {
    if (state !== "speaking" || !levelRef) {
      ringRef.current?.style.setProperty("--level", "0");
      return;
    }
    let raf = 0;
    const tick = () => {
      ringRef.current?.style.setProperty("--level", levelRef.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, levelRef]);

  return (
    <figure className={`pa pa--${state}`} style={{ ["--size" as string]: `${size}px` }} aria-label={`${name}, ${state}`}>
      <div className="pa__ring" ref={ringRef}>
        {portraitUrl && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pa__img" src={portraitUrl} alt={name} onError={() => setFailedUrl(portraitUrl ?? null)} />
        ) : (
          <div className="pa__placeholder" aria-hidden style={color ? { background: color } : undefined}>
            {!color && (
              <svg viewBox="0 0 64 64" className="pa__silhouette">
                <circle cx="32" cy="24" r="12" />
                <path d="M10 60c0-12 10-20 22-20s22 8 22 20z" />
              </svg>
            )}
            <span className="pa__initials" style={color ? { color: "#fff", fontWeight: 400 } : undefined}>
              {initials(name)}
            </span>
          </div>
        )}
        {state === "thinking" && (
          <span className="pa__dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <figcaption className="pa__caption">
        <strong>{name}</strong>
        <span className="pa__status">{STATE_LABEL[state]}</span>
        {trust !== undefined && (
          <span className={`pa__mood pa__mood--${trust}`} title="How comfortable the patient feels">
            {MOOD[Math.max(0, Math.min(3, trust))]}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
