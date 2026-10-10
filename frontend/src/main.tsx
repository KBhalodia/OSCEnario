import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VoiceDemo } from "./demo/VoiceDemo";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceDemo />
  </StrictMode>,
);
