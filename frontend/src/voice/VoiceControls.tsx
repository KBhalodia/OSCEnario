import { useEffect, useRef, useState } from "react";
import { voiceApi, type CatalogVoice, type Persona, type Preset, type VoiceProfile } from "./api";

type Props = {
  persona: Persona;
  value: VoiceProfile | null | undefined;
  /** Called with the new voice (origin "faculty"), or null for "back to automatic". */
  onChange: (voice: VoiceProfile | null) => void;
};

/**
 * Studio "Voice" section: shows the auto-assigned voice, lets faculty pick another voice or a
 * preset, adjust speed, and preview. Any manual change sets origin = "faculty" so automatic
 * assignment never overwrites it.
 */
export function VoiceControls({ persona, value, onChange }: Props) {
  const [voices, setVoices] = useState<CatalogVoice[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    voiceApi
      .voices()
      .then((r) => {
        setVoices(r.voices);
        setPresets(r.presets);
      })
      .catch(() => setNote("Voice list unavailable — the patient will use the browser voice."));
  }, []);

  const current = voices.find((v) => v.voice_id === value?.voice_id);
  const edit = (patch: Partial<VoiceProfile>) => value && onChange({ ...value, ...patch, origin: "faculty" });

  const applyPreset = async (key: string) => {
    const v = await voiceApi.assign(persona, key);
    onChange({ ...v, origin: "faculty" });
  };

  const preview = async () => {
    if (!value) return;
    setBusy(true);
    setNote("");
    audio.current?.pause();
    const res = await voiceApi.preview(value, `Hi, I'm ${persona.name.split(" ")[0]}. I'm not really sure why I'm here today.`);
    setBusy(false);
    if (!res.audio) {
      setNote("Voice service unavailable; students will hear the browser voice.");
      return;
    }
    const url = URL.createObjectURL(res.audio);
    audio.current = new Audio(url);
    audio.current.onended = () => URL.revokeObjectURL(url);
    void audio.current.play();
    setNote(res.provider === "polly" ? "Played with the backup voice (ElevenLabs unavailable)." : "");
  };

  const label = (v: CatalogVoice) =>
    `${v.name} — ${[v.gender, v.age.replace("_", " "), v.accent].filter(Boolean).join(", ")}`;

  return (
    <section className="vc">
      <header className="vc__head">
        <h3>Voice</h3>
        <span className={`vc__badge vc__badge--${value?.origin ?? "auto"}`}>
          {value?.origin === "faculty" ? "Chosen by faculty" : "Auto-assigned"}
        </span>
      </header>

      <label className="vc__row">
        <span>Voice</span>
        <select
          value={value?.voice_id ?? ""}
          onChange={(e) => edit({ voice_id: e.target.value, provider: "elevenlabs" })}
          disabled={!value || !voices.length}
        >
          {!current && value?.voice_id && <option value={value.voice_id}>{value.voice_id}</option>}
          {voices.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>
              {label(v)}
            </option>
          ))}
        </select>
      </label>

      <label className="vc__row">
        <span>Style preset</span>
        <select value={value?.preset ?? ""} onChange={(e) => void applyPreset(e.target.value)} disabled={!presets.length}>
          {!value?.preset && <option value="">—</option>}
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="vc__row">
        <span>Speed {value ? value.speed.toFixed(2) : ""}</span>
        <input
          type="range"
          min={0.85}
          max={1.12}
          step={0.01}
          value={value?.speed ?? 1}
          onChange={(e) => edit({ speed: Number(e.target.value) })}
          disabled={!value}
        />
      </label>

      <div className="vc__actions">
        <button type="button" onClick={() => void preview()} disabled={!value || busy}>
          {busy ? "Loading…" : "▶ Preview"}
        </button>
        {value?.origin === "faculty" && (
          <button type="button" className="vc__link" onClick={() => onChange(null)}>
            Reset to automatic
          </button>
        )}
      </div>
      {note && <p className="vc__note">{note}</p>}
    </section>
  );
}
