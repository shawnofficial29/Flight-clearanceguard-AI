"""Muse Voice transcription wrapper with fixture fallback.

Live path POSTs multipart/form-data to META_VOICE_API_URL with a "request"
JSON part (model, audioEncoding, mode, keywords) and an "audio" WAV part.
Audio must be mono 16-bit PCM WAV at 16 kHz or 24 kHz; anything else raises
a clear error. When unconfigured or on error, known prerecorded demo files
resolve to fixed fixtures; unknown files raise so the caller uses typed input.
"""

from __future__ import annotations

import io
import json
import wave
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..config import Settings, live_voice_available
from ..models import VoiceTranscript

# Transport: (url, headers, filename, audio_bytes, model, timeout_s) -> decoded JSON.
VoiceTransport = Callable[[str, dict[str, str], str, bytes, str, float], dict[str, Any]]

AUDIO_ENCODING = "WAV"
VOICE_MODE = "PUSH_TO_TALK"
VOICE_KEYWORDS = ["META452", "MERIT", "PONCT"]
ALLOWED_RATES = (16000, 24000)


class VoiceNotConfiguredError(Exception):
    pass


class VoiceAPIError(Exception):
    pass


VOICE_FIXTURES: dict[str, str] = {
    "meta452_atc.wav": (
        "META 452, after passing MERIT, climb to flight level 230 and proceed direct PONCT."
    ),
    "meta452_readback.wav": "META 452, climb to flight level 230 and proceed direct PONCT.",
}


def validate_wav(filename: str, audio: bytes) -> tuple[int, int]:
    """Enforce mono 16-bit PCM WAV at 16/24 kHz. Returns (channels, rate)."""
    name = Path(filename).name
    try:
        with wave.open(io.BytesIO(audio), "rb") as handle:
            channels = handle.getnchannels()
            sampwidth = handle.getsampwidth()
            rate = handle.getframerate()
            comptype = handle.getcomptype()
    except (wave.Error, EOFError, ValueError) as exc:
        raise VoiceAPIError(
            f"Invalid WAV '{name}': unreadable audio ({exc}). "
            "Provide mono 16-bit PCM WAV at 16 or 24 kHz, or use typed input."
        ) from exc
    problems: list[str] = []
    if channels != 1:
        problems.append(f"{channels} channels (need mono)")
    if sampwidth != 2 or comptype != "NONE":
        problems.append("not 16-bit PCM")
    if rate not in ALLOWED_RATES:
        problems.append(f"{rate} Hz (need 16000 or 24000)")
    if problems:
        raise VoiceAPIError(
            f"Invalid WAV '{name}': {'; '.join(problems)}. "
            "Provide mono 16-bit PCM WAV at 16 or 24 kHz, or use typed input."
        )
    return channels, rate


def request_payload(model: str) -> dict[str, Any]:
    return {
        "model": model,
        "audioEncoding": AUDIO_ENCODING,
        "mode": VOICE_MODE,
        "keywords": list(VOICE_KEYWORDS),
    }


def httpx_post_audio(
    url: str, headers: dict[str, str], filename: str, audio: bytes, model: str, timeout_s: float
) -> dict[str, Any]:
    import httpx

    files = {
        "request": (None, json.dumps(request_payload(model)), "application/json"),
        "audio": (filename, audio, "audio/wav"),
    }
    try:
        response = httpx.post(url, headers=headers, files=files, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        raise VoiceAPIError(f"Muse Voice request timed out after {timeout_s:g}s.") from exc
    except httpx.RequestError as exc:
        raise VoiceAPIError(f"Muse Voice request failed: {exc}.") from exc
    if response.status_code >= 400:
        snippet = response.text[:300].replace("\n", " ")
        raise VoiceAPIError(f"Muse Voice HTTP {response.status_code}: {snippet}")
    try:
        decoded = response.json()
    except ValueError as exc:
        raise VoiceAPIError("Muse Voice returned a non-JSON response.") from exc
    if not isinstance(decoded, dict):
        raise VoiceAPIError("Muse Voice returned an unexpected response shape.")
    return decoded


def _extract_transcript(body: dict[str, Any]) -> str:
    for key in ("transcript", "text", "transcription"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise VoiceAPIError("Muse Voice response contained no transcript text.")


def transcribe_wav(
    filename: str,
    audio: bytes,
    settings: Settings,
    transport: VoiceTransport | None = None,
    *,
    force_fixture: bool = False,
) -> VoiceTranscript:
    validate_wav(filename, audio)
    base = Path(filename).name.lower()
    if not force_fixture and live_voice_available(settings):
        assert settings.meta_voice_api_url
        assert settings.meta_api_key
        sender = transport or httpx_post_audio
        try:
            raw = sender(
                settings.meta_voice_api_url,
                {"Authorization": f"Bearer {settings.meta_api_key}"},
                Path(filename).name,
                audio,
                settings.meta_voice_model,
                settings.request_timeout_s,
            )
            return VoiceTranscript(
                transcript=_extract_transcript(raw),
                provenance="live_muse_voice",
                model=settings.meta_voice_model,
                source_file=Path(filename).name,
            )
        except VoiceAPIError:
            pass  # fall through to fixture below
    fixture = VOICE_FIXTURES.get(base)
    if fixture is not None:
        return VoiceTranscript(
            transcript=fixture,
            provenance="fixture_fallback",
            model="deterministic-fixture",
            source_file=Path(filename).name,
            note="Live Muse Voice unavailable; used fixed demo fixture.",
        )
    raise VoiceAPIError(
        f"No live Muse Voice and no fixture for '{Path(filename).name}'. Use typed input."
    )
