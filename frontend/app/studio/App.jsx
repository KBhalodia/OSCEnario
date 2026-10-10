import React, { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Editor from "./components/Editor.jsx";
import {
  loadDb,
  saveDb,
  blankPatient,
  runChecks,
  downloadProfile,
  toEncounterProfile,
  uid,
} from "./studio.js";
import { publishEncounterProfile } from "../encounter/publishedPatients";

export default function App() {
  const [db, setDb] = useState(loadDb);
  const [result, setResult] = useState(null);
  const resultsRef = useRef(null);

  // Persist to localStorage whenever the database changes.
  useEffect(() => {
    saveDb(db);
  }, [db]);

  const current = db.patients.find((p) => p.id === db.currentId);

  // Replace the current patient and reset its status to draft (an edit happened).
  const patchCurrent = (next) => {
    setResult(null);
    setDb((d) => ({
      ...d,
      patients: d.patients.map((p) =>
        p.id === d.currentId ? { ...next, status: "draft" } : p
      ),
    }));
  };

  const selectPatient = (id) => {
    setResult(null);
    setDb((d) => ({ ...d, currentId: id }));
  };

  const newPatient = () => {
    const p = blankPatient();
    setResult(null);
    setDb((d) => ({ ...d, patients: [...d.patients, p], currentId: p.id }));
  };

  const check = () => {
    const r = runChecks(current);
    setResult({ ...r, published: false });
  };

  const publish = () => {
    const r = runChecks(current);
    if (!r.errors.length) {
      // Mark the patient published in Studio's own library...
      setDb((d) => ({
        ...d,
        patients: d.patients.map((p) =>
          p.id === d.currentId ? { ...p, status: "published" } : p
        ),
      }));
      // ...and make it available to Student Encounter. We reuse Studio's
      // existing toEncounterProfile() and stamp the patient id on so Encounter
      // can route to it via /encounter?patientId=<id>.
      const profile = { id: current.id, ...toEncounterProfile(current) };
      publishEncounterProfile(profile);
    }
    setResult({ ...r, published: !r.errors.length });
  };

  const download = () => downloadProfile(current);

  const duplicate = () => {
    const copy = JSON.parse(JSON.stringify(current));
    copy.id = uid();
    copy.title = (current.title || "Untitled case") + " (copy)";
    copy.status = "draft";
    setResult(null);
    setDb((d) => ({ ...d, patients: [...d.patients, copy], currentId: copy.id }));
  };

  const remove = () => {
    if (
      !window.confirm(
        'Delete "' + (current.title || "Untitled case") + '"? This cannot be undone.'
      )
    )
      return;
    setResult(null);
    setDb((d) => {
      let patients = d.patients.filter((x) => x.id !== d.currentId);
      if (!patients.length) patients = [blankPatient()];
      return { ...d, patients, currentId: patients[0].id };
    });
  };

  // Scroll results into view when they appear.
  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [result]);

  return (
    <>
      <header className="top">
        <h1>Patient Studio</h1>
        <span>Prototype for faculty</span>
      </header>

      <div className="layout">
        <Sidebar
          patients={db.patients}
          currentId={db.currentId}
          onSelect={selectPatient}
          onNew={newPatient}
        />
        <div ref={resultsRef}>
          <Editor
            key={current.id}
            patient={current}
            result={result}
            onPatch={patchCurrent}
            onCheck={check}
            onPublish={publish}
            onDownload={download}
            onDuplicate={duplicate}
            onDelete={remove}
          />
        </div>
      </div>
    </>
  );
}
