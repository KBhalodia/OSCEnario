import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the browser talks to Vite, which proxies API calls to FastAPI on :8000.
// The ElevenLabs key never leaves the backend.
const api = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/tts": api,
      "/voices": api,
      "/patients": api,
      "/encounters": api,
      "/portraits": api,
    },
  },
});
