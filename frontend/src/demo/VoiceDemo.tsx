import { useCallback, useEffect, useRef, useState } from "react";
import {
  PatientAvatar,
  VoiceControls,
  usePushToTalk,
  useVoicePlayer,
  voiceApi,
  type AvatarState,
  type Persona,
  type VoiceProfile,
} from "../voice";

// Talks to the dev server (app/dev_server.py). The real Encounter page uses the same hooks.

type PatientSummary = { id: string; name: string; age: number | null; sex: string | null; portrait_path: string | null };
type Msg = { who: "student" | "patient" | "system"; text: string };
type TurnResponse = { reply: string; trust: number; deflected: boolean; tags: string[] };

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export function VoiceDemo() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [pid, setPid] = useState("");
  const [persona, setPersona] = useState<Persona | null>(null);
  const [encounterId, setEncounterId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [trust, setTrust] = useState<number | undefined>(undefined);
  const [voiceOn, setVoiceOn] = useState(true);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const player = useVoicePlayer();

  useEffect(() => {
    fetch("/patients").then(json<PatientSummary[]>).then((ps) => {
      setPatients(ps);
      if (ps[0]) setPid(ps[0].id);
    }).catch((e) => setError(`Backend not reachable: ${e.message}`));
  }, []);

  // load persona + start a fresh encounter whenever the patient changes
  useEffect(() => {
    if (!pid) return;
    player.stop();
    setMessages([]);
    setTrust(undefined);
    setEncounterId("");
    fetch(`/patients/${pid}`).then(json<{ persona: Persona }>).then((p) => setPersona(p.persona));
    fetch("/encounters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: pid }) })
      .then(json<{ encounter_id: string; chart: { trust: number } }>)
      .then((r) => {
        setEncounterId(r.encounter_id);
        setTrust(r.chart.trust);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  useEffect(() => {
    // braces matter: newer Chrome returns a Promise from scrollTo, which React would treat as a cleanup
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  // ONE path for typed and spoken messages
  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || !encounterId || thinking) return;
      setInput("");
      setError("");
      setMessages((m) => [...m, { who: "student", text: t }]);
      setThinking(true);
      try {
        const r = await fetch(`/encounters/${encounterId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: t }),
        }).then(json<TurnResponse>);
        setMessages((m) => [...m, { who: "patient", text: r.reply }]); // text first, always
        setTrust(r.trust);
        if (voiceOn) void player.speak({ text: r.reply, patientId: pid, persona, trust: r.trust, deflected: r.deflected });
      } catch (e) {
        setError(`Patient didn't answer: ${(e as Error).message}`);
      } finally {
        setThinking(false);
      }
    },
    [encounterId, thinking, voiceOn, player, pid, persona],
  );

  const ptt = usePushToTalk((text) => void send(text));

  const pttDown = () => {
    player.unlock();
    player.stop(); // barge-in
    ptt.start();
  };

  const saveVoice = async (voice: VoiceProfile | null) => {
    const v = await fetch(`/patients/${pid}/voice`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
    }).then(json<VoiceProfile>);
    setPersona((p) => (p ? { ...p, voice: v } : p));
  };

  const avatarState: AvatarState = ptt.listening ? "listening" : thinking || player.status === "loading" ? "thinking"
    : player.status === "speaking" ? "speaking" : "idle";

  const current = patients.find((p) => p.id === pid);

  return (
    <div className="demo">
      <header className="demo__bar">
        <h1>Virtual Patient · Voice</h1>
        <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Patient">
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.age ? `, ${p.age}` : ""}
            </option>
          ))}
        </select>
        <label className="demo__toggle">
          <input type="checkbox" checked={voiceOn} onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) player.stop(); }} />
          Patient voice
        </label>
        {player.provider && <span className="demo__provider">audio: {player.provider}</span>}
      </header>

      <main className="demo__main">
        <section className="demo__encounter">
          <PatientAvatar
            name={current?.name ?? "Patient"}
            portraitUrl={voiceApi.portraitUrl(current?.portrait_path)}
            state={avatarState}
            levelRef={player.levelRef}
            trust={trust}
          />

          <div className="chat" ref={logRef}>
            {messages.length === 0 && <p className="chat__empty">Introduce yourself to start the interview.</p>}
            {messages.map((m, i) => (
              <div key={i} className={`chat__msg chat__msg--${m.who}`}>
                {m.text}
              </div>
            ))}
            {thinking && <div className="chat__msg chat__msg--patient chat__msg--typing">…</div>}
          </div>

          {error && <p className="demo__error">{error}</p>}
          {ptt.error && <p className="demo__error">{ptt.error}</p>}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              player.unlock();
              void send(input);
            }}
          >
            <input
              value={ptt.listening ? ptt.transcript : input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ptt.listening ? "Listening…" : "Type your question…"}
              disabled={ptt.listening}
            />
            <button type="submit" disabled={!input.trim() || thinking || !encounterId}>
              Send
            </button>
            {ptt.supported && (
              <button
                type="button"
                className={`ptt ${ptt.listening ? "ptt--on" : ""}`}
                onPointerDown={pttDown}
                onPointerUp={ptt.stop}
                onPointerLeave={() => ptt.listening && ptt.stop()}
                disabled={!encounterId || thinking}
                title="Hold to talk"
              >
                🎙 {ptt.listening ? "Release to send" : "Hold to talk"}
              </button>
            )}
          </form>
          {!ptt.supported && <p className="demo__hint">Voice input needs Chrome or Edge. Typing works everywhere.</p>}
        </section>

        <aside className="demo__studio">
          <h2>Studio preview</h2>
          {persona && <VoiceControls persona={persona} value={persona.voice} onChange={(v) => void saveVoice(v)} />}
          <p className="demo__hint">
            No audio is recorded or stored. Speech is turned into text by the browser; only the transcript is kept.
          </p>
        </aside>
      </main>
    </div>
  );
}
