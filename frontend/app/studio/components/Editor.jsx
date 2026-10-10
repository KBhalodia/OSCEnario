import React from "react";
import { TABS, ARTIFACT_TYPES, uid } from "../studio.js";
import {
  Field,
  TextInput,
  TextArea,
  WordsInput,
  SelectInput,
  Checkbox,
} from "./Fields.jsx";
import Results from "./Results.jsx";

export default function Editor({
  patient,
  result,
  onPatch,
  onCheck,
  onPublish,
  onDownload,
  onDuplicate,
  onDelete,
}) {
  const p = patient;

  // Patch the whole patient with a shallow merge.
  const set = (changes) => onPatch({ ...p, ...changes });

  // ---- Objectives ----
  const setObjective = (i, v) => {
    const objectives = p.objectives.slice();
    objectives[i] = v;
    set({ objectives });
  };
  const removeObjective = (i) =>
    set({ objectives: p.objectives.filter((_, idx) => idx !== i) });
  const addObjective = () => set({ objectives: [...p.objectives, ""] });

  // ---- Facts ----
  const patchFact = (i, changes) =>
    set({ facts: p.facts.map((f, idx) => (idx === i ? { ...f, ...changes } : f)) });
  const removeFact = (i) => set({ facts: p.facts.filter((_, idx) => idx !== i) });
  const addFact = () =>
    set({
      facts: [
        ...p.facts,
        { id: uid(), tab: "history", label: "", value: "", triggers: [], key: false },
      ],
    });

  // ---- Sources ----
  const patchSource = (i, changes) =>
    set({ sources: p.sources.map((s, idx) => (idx === i ? { ...s, ...changes } : s)) });
  const removeSource = (i) =>
    set({ sources: p.sources.filter((_, idx) => idx !== i) });
  const addSource = () =>
    set({ sources: [...p.sources, { id: uid(), title: "", note: "", fileName: "" }] });

  // ---- Artifacts ----
  const patchArtifact = (i, changes) =>
    set({
      artifacts: p.artifacts.map((a, idx) => (idx === i ? { ...a, ...changes } : a)),
    });
  const removeArtifact = (i) =>
    set({ artifacts: p.artifacts.filter((_, idx) => idx !== i) });
  const addArtifact = () =>
    set({
      artifacts: [
        ...p.artifacts,
        {
          id: uid(),
          name: "",
          type: "Lab report",
          fileName: "",
          finding: "",
          abnormal: false,
          triggers: [],
        },
      ],
    });

  const pillClass = "pill " + (p.status === "published" ? "pub" : "draft");

  return (
    <main id="editor">
      <div className="bar">
        <span className="title">{p.title || "Untitled case"}</span>
        <span className={pillClass}>
          {p.status === "published" ? "Published" : "Draft"}
        </span>
        <button className="btn ghost" type="button" onClick={onCheck}>
          Check consistency
        </button>
        <button className="btn" type="button" onClick={onPublish}>
          Publish
        </button>
        <button className="btn ghost" type="button" onClick={onDownload}>
          Download for encounter
        </button>
        {p.status === "published" && (
          // Opens the Student Encounter for THIS published patient. Opens in a
          // new tab so faculty keep the editor open while demonstrating.
          <a
            className="btn ghost"
            href={`/encounter?patientId=${encodeURIComponent(p.id)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Encounter
          </a>
        )}
      </div>

      <Results result={result} />

      {/* 1. Basics */}
      <section className="card">
        <h2>Patient basics</h2>
        <p className="hint">Who the student is about to meet.</p>
        <div className="grid2">
          <Field label="Case title (for your library)">
            <TextInput value={p.title} onChange={(v) => set({ title: v })} />
          </Field>
          <Field label="Patient name">
            <TextInput value={p.name} onChange={(v) => set({ name: v })} />
          </Field>
        </div>
        <div className="grid3" style={{ marginTop: 12 }}>
          <Field label="Opening line the patient says">
            <TextInput value={p.greeting} onChange={(v) => set({ greeting: v })} />
          </Field>
          <Field label="Age">
            <TextInput type="number" value={p.age} onChange={(v) => set({ age: v })} />
          </Field>
          <Field label="Sex">
            <SelectInput
              value={p.sex}
              options={["Female", "Male", "Other"]}
              onChange={(v) => set({ sex: v })}
            />
          </Field>
        </div>
      </section>

      {/* 2. Learning objectives */}
      <section className="card">
        <h2>Learning objectives</h2>
        <p className="hint">
          What the student should accomplish. Feedback after the encounter is scored
          against these.
        </p>
        <div>
          {p.objectives.map((o, i) => (
            <div className="objrow" key={i}>
              <input
                type="text"
                value={o}
                aria-label={"Learning objective " + (i + 1)}
                onChange={(e) => setObjective(i, e.target.value)}
              />
              <button
                className="btn danger small"
                type="button"
                onClick={() => removeObjective(i)}
              >
                Remove
              </button>
            </div>
          ))}
          <button className="btn ghost small" type="button" onClick={addObjective}>
            Add objective
          </button>
        </div>
      </section>

      {/* 3. Clinical facts */}
      <section className="card">
        <h2>Clinical record and release rules</h2>
        <p className="hint">
          Each fact appears in the student's chart only after they ask about it. The
          patient's reply is generated by the AI from what the chart shows.
        </p>
        <div>
          {p.facts.map((f, i) => (
            <div className="sub" key={f.id}>
              <div className="grid2">
                <Field label="Label">
                  <TextInput
                    value={f.label}
                    onChange={(v) => patchFact(i, { label: v })}
                  />
                </Field>
                <Field label="Chart section">
                  <SelectInput
                    value={f.tab}
                    options={TABS}
                    onChange={(v) => patchFact(i, { tab: v })}
                  />
                </Field>
              </div>
              <Field label="What the chart shows">
                <TextArea
                  value={f.value}
                  rows={2}
                  onChange={(v) => patchFact(i, { value: v })}
                />
              </Field>
              <Field label="Release when the student's question contains (separate with commas)">
                <WordsInput
                  value={f.triggers}
                  onChange={(v) => patchFact(i, { triggers: v })}
                />
              </Field>
              <div className="row-end">
                <Checkbox
                  checked={f.key}
                  label="Key finding for feedback"
                  onChange={(v) => patchFact(i, { key: v })}
                />
                <button
                  className="btn danger small"
                  type="button"
                  onClick={() => removeFact(i)}
                >
                  Remove fact
                </button>
              </div>
            </div>
          ))}
          {!p.facts.length && (
            <p className="hint">
              No facts yet. Add the first thing the student could discover.
            </p>
          )}
          <button className="btn ghost small" type="button" onClick={addFact}>
            Add clinical fact
          </button>
        </div>
      </section>

      {/* 4. Knowledge sources */}
      <section className="card">
        <h2>Knowledge sources</h2>
        <p className="hint">
          Papers, guidelines, or institutional protocols that ground the patient and
          the feedback.
        </p>
        <div>
          {p.sources.map((s, i) => (
            <div className="sub" key={s.id}>
              <Field label="Title">
                <TextInput value={s.title} onChange={(v) => patchSource(i, { title: v })} />
              </Field>
              <Field label="How it should be used">
                <TextArea
                  value={s.note}
                  rows={2}
                  onChange={(v) => patchSource(i, { note: v })}
                />
              </Field>
              <div className="row-end">
                <span>
                  <input
                    type="file"
                    aria-label="Attach source file"
                    onChange={(e) =>
                      patchSource(i, {
                        fileName: e.target.files[0] ? e.target.files[0].name : "",
                      })
                    }
                  />{" "}
                  <span className="filename">
                    {s.fileName ? "Attached: " + s.fileName : "No file attached"}
                  </span>
                </span>
                <button
                  className="btn danger small"
                  type="button"
                  onClick={() => removeSource(i)}
                >
                  Remove source
                </button>
              </div>
            </div>
          ))}
          <button className="btn ghost small" type="button" onClick={addSource}>
            Add knowledge source
          </button>
        </div>
      </section>

      {/* 5. Artifacts */}
      <section className="card">
        <h2>Clinical artifacts</h2>
        <p className="hint">
          Lab reports, ECGs, X-rays, CT scans, or prior notes. Each one appears in the
          chart when the student asks for it.
        </p>
        <div>
          {p.artifacts.map((a, i) => (
            <div className="sub" key={a.id}>
              <div className="grid2">
                <Field label="Name">
                  <TextInput value={a.name} onChange={(v) => patchArtifact(i, { name: v })} />
                </Field>
                <Field label="Type">
                  <SelectInput
                    value={a.type}
                    options={ARTIFACT_TYPES}
                    onChange={(v) => patchArtifact(i, { type: v })}
                  />
                </Field>
              </div>
              <Field label="Finding summary (must match the patient's history)">
                <TextArea
                  value={a.finding}
                  rows={2}
                  onChange={(v) => patchArtifact(i, { finding: v })}
                />
              </Field>
              <Field label="Release when the student's question contains (separate with commas)">
                <WordsInput
                  value={a.triggers}
                  onChange={(v) => patchArtifact(i, { triggers: v })}
                />
              </Field>
              <div className="row-end">
                <Checkbox
                  checked={a.abnormal}
                  label="Abnormal result"
                  onChange={(v) => patchArtifact(i, { abnormal: v })}
                />
                <span>
                  <input
                    type="file"
                    aria-label="Attach artifact file"
                    onChange={(e) =>
                      patchArtifact(i, {
                        fileName: e.target.files[0] ? e.target.files[0].name : "",
                      })
                    }
                  />{" "}
                  <span className="filename">
                    {a.fileName ? "Attached: " + a.fileName : "No file attached"}
                  </span>
                </span>
                <button
                  className="btn danger small"
                  type="button"
                  onClick={() => removeArtifact(i)}
                >
                  Remove artifact
                </button>
              </div>
            </div>
          ))}
          <button className="btn ghost small" type="button" onClick={addArtifact}>
            Add artifact
          </button>
        </div>
      </section>

      {/* 6. Library actions */}
      <section className="card">
        <h2>Manage this patient</h2>
        <p className="hint">Reuse a good case as the starting point for a new one.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn ghost" type="button" onClick={onDuplicate}>
            Duplicate patient
          </button>
          <button className="btn danger" type="button" onClick={onDelete}>
            Delete patient
          </button>
        </div>
      </section>
    </main>
  );
}
