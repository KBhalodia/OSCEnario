"""
Retrieval over faculty documents (the "R" in RAG).

Documents are split into overlapping chunks and searched with BM25, a classic
keyword-ranking method. It needs no extra AWS service, works offline, and is
plenty for a handful of guidelines or a syllabus. The interface (`search`) is
the same one an embeddings index would have, so it can be swapped for Bedrock
embeddings later without touching the generator or feedback code.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from ..importers import tokens
from ..schemas import SourceDocument


@dataclass
class Chunk:
    doc_id: str
    doc_name: str
    n: int
    text: str

    @property
    def ref(self) -> str:
        return f"{self.doc_name} §{self.n}"


def chunk_text(text: str, size: int = 1100, overlap: int = 200) -> list[str]:
    """Paragraph-aware chunks of ~`size` characters with `overlap` carried forward."""
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=[A-Z0-9][^\n]{0,80}:)", text) if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        while len(p) > size:                       # very long paragraph: hard split
            head, p = p[:size], p[size - overlap:]
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(head)
        if len(cur) + len(p) + 1 > size and cur:
            chunks.append(cur)
            cur = cur[-overlap:] + "\n" + p
        else:
            cur = (cur + "\n" + p).strip()
    if cur:
        chunks.append(cur)
    return chunks


class KnowledgeIndex:
    def __init__(self, docs: list[SourceDocument], k1: float = 1.5, b: float = 0.75):
        self.chunks: list[Chunk] = []
        for d in docs:
            for i, c in enumerate(chunk_text(d.text), start=1):
                self.chunks.append(Chunk(d.id, d.name, i, c))
        self._tf = [Counter(_toks(c.text)) for c in self.chunks]
        self._len = [sum(tf.values()) for tf in self._tf]
        self._avg = (sum(self._len) / len(self._len)) if self._len else 0.0
        df: Counter = Counter()
        for tf in self._tf:
            df.update(tf.keys())
        n = len(self.chunks)
        self._idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.k1, self.b = k1, b

    def __len__(self) -> int:
        return len(self.chunks)

    def search(self, query: str, k: int = 5) -> list[tuple[float, Chunk]]:
        q = _toks(query)
        if not q or not self.chunks:
            return []
        scores = []
        for i, tf in enumerate(self._tf):
            s = 0.0
            for t in set(q):
                f = tf.get(t)
                if f:
                    norm = f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self._len[i] / (self._avg or 1)))
                    s += self._idf.get(t, 0.0) * norm
            if s > 0:
                scores.append((s, self.chunks[i]))
        scores.sort(key=lambda x: -x[0])
        return scores[:k]

    def context(self, query: str, k: int = 5, max_chars: int = 6000) -> str:
        """Retrieved chunks formatted for a prompt, each labelled so the model can cite it."""
        out, used = [], 0
        for _, c in self.search(query, k):
            block = f"[{c.ref}]\n{c.text}"
            if used + len(block) > max_chars:
                break
            out.append(block)
            used += len(block)
        return "\n\n".join(out)


def _toks(text: str) -> list[str]:
    # reuse the importer's stemming tokenizer, keeping duplicates for term frequency
    return [t for w in re.findall(r"[A-Za-z0-9]+", text) for t in tokens(w)]
