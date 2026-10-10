"""
Text -> speech for patient replies. ElevenLabs text-to-speech ONLY (never their agents).

Fallback chain: ElevenLabs (streaming) -> Amazon Polly -> TTSUnavailable, which the API turns
into a 503 so the browser speaks the text with speechSynthesis. Chat never depends on audio.

Audio is cached in process memory for this session (LRU) and is never written to disk or
the database. The ElevenLabs key is read from ELEVENLABS_API_KEY on the server only.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import httpx

from ..schemas import VoiceProfile
from .catalog import API, api_key
from .profiles import DEFAULT_MODEL, LIMITS

log = logging.getLogger("voice.tts")

OUTPUT_FORMAT = "mp3_44100_64"     # small + fast; any plan supports it
MAX_CHARS = 1200                   # one patient reply; protects the credit budget
CACHE_MAX_BYTES = 40 * 1024 * 1024


class TTSUnavailable(Exception):
    pass


# --------------------------------------------------------------------------
# Small, safe adjustments from encounter state
# --------------------------------------------------------------------------

def adjust_for_state(v: VoiceProfile, trust: Optional[int]) -> VoiceProfile:
    """Guarded patient (trust 0): a little slower and steadier. Nothing else changes."""
    if trust is None or trust > 0:
        return v
    lo_s, hi_s = LIMITS["speed"]
    return v.model_copy(update={
        "speed": round(max(lo_s, v.speed - 0.05), 2),
        "stability": round(min(0.9, v.stability + 0.10), 2),
    })


# --------------------------------------------------------------------------
# In-memory audio cache (never persisted)
# --------------------------------------------------------------------------

class AudioCache:
    def __init__(self, max_bytes: int = CACHE_MAX_BYTES):
        self.max_bytes, self.size = max_bytes, 0
        self._d: OrderedDict[str, tuple[bytes, str]] = OrderedDict()

    @staticmethod
    def key(text: str, v: VoiceProfile, provider: str) -> str:
        blob = json.dumps([provider, text, v.voice_id, v.model_id, v.stability,
                           v.similarity_boost, v.style, v.speed, v.fallback_polly_voice])
        return hashlib.sha256(blob.encode()).hexdigest()

    def get(self, k: str) -> Optional[tuple[bytes, str]]:
        hit = self._d.get(k)
        if hit:
            self._d.move_to_end(k)
        return hit

    def put(self, k: str, audio: bytes, provider: str) -> None:
        if not audio or len(audio) > self.max_bytes:
            return
        if k in self._d:
            self.size -= len(self._d.pop(k)[0])
        self._d[k] = (audio, provider)
        self.size += len(audio)
        while self.size > self.max_bytes:
            _, (old, _) = self._d.popitem(last=False)
            self.size -= len(old)


CACHE = AudioCache()


# --------------------------------------------------------------------------
# ElevenLabs credit guard
# --------------------------------------------------------------------------

@dataclass
class Usage:
    tier: str = ""
    used: int = 0
    limit: int = 0
    checked_at: float = 0.0
    error: str = ""

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


_usage = Usage()


async def elevenlabs_usage(client: Optional[httpx.AsyncClient] = None, max_age: float = 60) -> Usage:
    """GET /v1/user/subscription, cached for a minute."""
    global _usage
    key = api_key()
    if not key:
        return Usage(error="ELEVENLABS_API_KEY not set")
    if time.time() - _usage.checked_at < max_age and not _usage.error:
        return _usage
    own = client is None
    client = client or httpx.AsyncClient(timeout=10)
    try:
        r = await client.get(f"{API}/v1/user/subscription", headers={"xi-api-key": key})
        if r.status_code == 200:
            b = r.json()
            _usage = Usage(tier=b.get("tier", ""), used=int(b.get("character_count", 0)),
                           limit=int(b.get("character_limit", 0)), checked_at=time.time())
        else:   # key may lack the user_read permission; don't block TTS on it
            _usage = Usage(error=f"subscription check HTTP {r.status_code}", checked_at=time.time())
    except httpx.HTTPError as e:
        _usage = Usage(error=f"subscription check failed: {type(e).__name__}", checked_at=time.time())
    finally:
        if own:
            await client.aclose()
    return _usage


def _note_spent(chars: int) -> None:
    if _usage.limit:
        _usage.used += chars


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------

def elevenlabs_body(text: str, v: VoiceProfile) -> dict:
    return {
        "text": text,
        "model_id": v.model_id or DEFAULT_MODEL,
        "voice_settings": {"stability": v.stability, "similarity_boost": v.similarity_boost,
                           "style": v.style, "speed": v.speed, "use_speaker_boost": True},
    }


async def _elevenlabs_stream(text: str, v: VoiceProfile, client: httpx.AsyncClient
                             ) -> Optional[AsyncIterator[bytes]]:
    """Returns an async iterator of mp3 chunks, or None if ElevenLabs can't serve this request
    (no key, out of credits, voice missing, HTTP error). Decided BEFORE any audio is sent."""
    key = api_key()
    if not key or not v.voice_id or v.provider != "elevenlabs":
        return None
    usage = await elevenlabs_usage(client)
    if usage.limit and usage.remaining < len(text):
        log.warning("ElevenLabs credits exhausted (%s/%s); falling back", usage.used, usage.limit)
        return None
    req = client.build_request(
        "POST", f"{API}/v1/text-to-speech/{v.voice_id}/stream",
        params={"output_format": OUTPUT_FORMAT},
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        json=elevenlabs_body(text, v))
    try:
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        log.warning("ElevenLabs request failed: %s", type(e).__name__)
        return None
    if resp.status_code != 200:
        detail = (await resp.aread())[:300]
        await resp.aclose()
        log.warning("ElevenLabs HTTP %s: %s", resp.status_code, detail)
        return None

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for c in resp.aiter_bytes():
                if c:
                    yield c
        finally:
            await resp.aclose()
    _note_spent(len(text))
    return chunks()


def _polly_sync(text: str, voice: str) -> bytes:
    import boto3
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
    polly = boto3.client("polly", region_name=region)
    last: Exception | None = None
    for engine in ("neural", "standard"):
        try:
            r = polly.synthesize_speech(Text=text, OutputFormat="mp3", VoiceId=voice, Engine=engine)
            return r["AudioStream"].read()
        except Exception as e:   # voice not available in this engine/region, AccessDenied...
            last = e
    raise TTSUnavailable(f"Polly failed: {type(last).__name__ if last else 'unknown'}")


async def polly_audio(text: str, v: VoiceProfile) -> bytes:
    voice = v.fallback_polly_voice or (v.voice_id if v.provider == "polly" else "") or "Matthew"
    return await asyncio.to_thread(_polly_sync, text, voice)


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

@dataclass
class Speech:
    provider: str                       # "elevenlabs" | "polly" | "cache"
    stream: AsyncIterator[bytes]


async def synthesize(text: str, voice: VoiceProfile, client: httpx.AsyncClient) -> Speech:
    text = " ".join(text.split())[:MAX_CHARS]
    if not text:
        raise TTSUnavailable("empty text")

    for provider in ("elevenlabs", "polly"):
        hit = CACHE.get(AudioCache.key(text, voice, provider))
        if hit:
            async def one(b=hit[0]) -> AsyncIterator[bytes]:
                yield b
            return Speech("cache", one())

    stream = await _elevenlabs_stream(text, voice, client)
    if stream is not None:
        k = AudioCache.key(text, voice, "elevenlabs")

        async def tee() -> AsyncIterator[bytes]:
            buf = bytearray()
            async for c in stream:
                buf += c
                yield c
            CACHE.put(k, bytes(buf), "elevenlabs")
        return Speech("elevenlabs", tee())

    try:
        audio = await polly_audio(text, voice)
    except TTSUnavailable:
        raise
    except Exception as e:
        raise TTSUnavailable(f"Polly failed: {type(e).__name__}") from e
    CACHE.put(AudioCache.key(text, voice, "polly"), audio, "polly")

    async def one_polly() -> AsyncIterator[bytes]:
        yield audio
    return Speech("polly", one_polly())
