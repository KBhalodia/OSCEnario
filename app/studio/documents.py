"""
Read faculty uploads into text.

    extract_text(path)            -> str        PDF, DOCX, TXT/MD/CSV/JSON
    describe_image(path, llm)     -> str        ECG / X-ray / scanned lab report, via Claude vision
    load_document(path, kind, ..) -> SourceDocument

Faculty choose the kind at upload:
  patient_record : about THIS patient (lab report, prior note, discharge summary).
                   Treated as faculty-provided truth by the generator.
  reference      : guidelines, papers, protocols, syllabus. Searched with RAG for
                   the generator (objectives) and the feedback engine (accuracy).
                   The patient never sees reference material.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from ..schemas import DocumentKind, SourceDocument

TEXT_EXT = {".txt", ".md", ".csv", ".json", ".tsv"}
IMAGE_EXT = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".webp": "webp"}
MAX_CHARS = 200_000


def extract_text(path: str | Path) -> str:
    path = Path(path)
    ext = path.suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
    elif ext == ".docx":
        import docx
        d = docx.Document(str(path))
        parts = [p.text for p in d.paragraphs if p.text.strip()]
        for t in d.tables:
            for row in t.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        text = "\n".join(parts)
    elif ext in TEXT_EXT:
        text = path.read_text(encoding="utf-8", errors="replace")
        if ext == ".json":
            try:
                text = json.dumps(json.loads(text), indent=1)
            except ValueError:
                pass
    else:
        raise ValueError(f"Unsupported document type: {ext}")
    return text.strip()[:MAX_CHARS]


IMAGE_SYSTEM = """You are assisting a faculty member who is building a teaching case.
Describe this clinical image (e.g. ECG, X-ray, CT, photo of a lab report) factually for the patient chart:
- If it is a document or lab report, transcribe every test name, value, unit, reference range and date exactly.
- If it is an ECG or imaging study, describe only what is visibly present, in standard clinical terms,
  and say "uncertain" where you are not sure. Do not invent values or a diagnosis that is not visible.
Plain text, no preamble."""


def describe_image(path: str | Path, llm, model: str) -> str:
    """Uses the Converse API's image block. Returns a factual description/transcription."""
    path = Path(path)
    fmt = IMAGE_EXT[path.suffix.lower()]
    messages = [{"role": "user", "content": [
        {"image": {"format": fmt, "source": {"bytes": path.read_bytes()}}},
        {"text": "Describe or transcribe this for the patient chart."},
    ]}]
    return llm.call_text(model=model, system=IMAGE_SYSTEM, messages=messages,
                         max_tokens=1500, temperature=0.0).strip()


def load_document(path: str | Path, kind: DocumentKind | str, doc_id: str,
                  llm=None, vision_model: Optional[str] = None,
                  stored_path: Optional[str] = None) -> SourceDocument:
    path = Path(path)
    kind = DocumentKind(kind)
    if path.suffix.lower() in IMAGE_EXT:
        # Images (X-ray, ECG, audiogram) are NOT read by the AI: an AI read of an arbitrary image can be
        # wrong and would be treated as ground truth. The only interpretation is what faculty write in the
        # file's summary; students see just the image.
        return SourceDocument(id=doc_id, name=path.name, kind=kind, file_path=stored_path, text="", summary="")
    return SourceDocument(id=doc_id, name=path.name, kind=kind, file_path=stored_path,
                          text=extract_text(path))
