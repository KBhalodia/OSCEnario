"""
Tiny local backend for the Patient Studio "Fill Other Fields with AI" button.

Why this exists: the Patient Studio UI is a standalone HTML file that runs in the
browser. A browser cannot safely hold AWS credentials. So the browser POSTs the
pasted case text to THIS local server, which holds the credentials (via the
existing .env / app.bedrock) and calls Claude on Bedrock. Keys never reach the
browser.

Run it:
    cd /Users/judithpaulraj/Twinverse_HealthHack
    source .venv/bin/activate            # or your venv
    source .env                          # loads AWS_* and VPE_* (keep this file private!)
    python -m scripts.studio_server      # serves http://127.0.0.1:8000

Endpoints:
    GET  /health   -> {"ok": true}
    POST /extract  -> body {"caseText": "..."}  ->  extracted Patient Studio fields

Uses only the Python standard library, so there is nothing new to pip install.
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bedrock import get_llm  # noqa: E402
from app.extract import extract_case  # noqa: E402

HOST = os.environ.get("STUDIO_HOST", "127.0.0.1")
PORT = int(os.environ.get("STUDIO_PORT", "8000"))

# The browser page may be served from file:// (origin "null") or a local static
# server. Allow those local origins only.
ALLOWED_ORIGINS = {"null", "http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:8080", "http://127.0.0.1:8080"}
MAX_BODY = 200_000  # ~200 KB of pasted text is plenty; reject anything larger


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        allow = origin if origin in ALLOWED_ORIGINS else "null"
        self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # CORS preflight
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/extract":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "Case text is missing or too large."})
            return

        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            case_text = data.get("caseText", "")
        except (ValueError, AttributeError):
            self._json(400, {"error": "Request body must be JSON like {\"caseText\": \"...\"}."})
            return

        try:
            result = extract_case(case_text, get_llm())
        except ValueError as e:
            # empty input / bad request
            self._json(400, {"error": str(e)})
            return
        except Exception as e:  # Bedrock errors, auth, timeouts, etc.
            # Log full detail to the server console; send a safe message to the browser.
            print(f"[extract] AI call failed: {type(e).__name__}: {e}", file=sys.stderr)
            self._json(502, {"error": "AI extraction failed. Check the server terminal for details "
                                       "(often expired AWS credentials or a wrong model id)."})
            return

        self._json(200, {"result": result})

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    # Fail fast with a clear message if the AI env vars are missing.
    missing = [k for k in ("AWS_REGION", "VPE_SMART_MODEL") if not os.environ.get(k)]
    if missing:
        print("WARNING: these env vars are not set: " + ", ".join(missing))
        print("Run `source .env` first, or the /extract call will fail.")
    print(f"Patient Studio AI server on http://{HOST}:{PORT}  (POST /extract, GET /health)")
    print("Press Ctrl+C to stop.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
