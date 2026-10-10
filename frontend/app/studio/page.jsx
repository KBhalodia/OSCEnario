"use client";

import { useEffect, useState } from "react";
import PatientStudio from "./App.jsx";
import "./styles.css";

export default function StudioPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return <div>Loading Patient Studio...</div>;

  return <PatientStudio />;
}git checkout -b feature/voice-avatar origin/feature/voice-avatar