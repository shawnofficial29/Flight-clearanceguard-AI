"""Strict live Muse Voice smoke test for one WAV file.

Usage: .\\.venv\\Scripts\\python backend\\scripts\\voice_smoke.py <path-to-wav>
Requires live_muse_voice provenance; any fixture fallback is a hard failure.
Exit codes: 0 pass, 1 verification failure, 2 not configured / bad input.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings, live_voice_available, load_settings  # noqa: E402
from app.services.voice import (  # noqa: E402
    VoiceAPIError,
    VoiceNotConfiguredError,
    transcribe_wav,
    validate_wav,
)


def _redact(text: str, settings: Settings) -> str:
    key = settings.meta_api_key
    return text.replace(key, "***") if key else text


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("VOICE-SMOKE-ERROR: usage: voice_smoke.py <path-to-wav>")
        return 2
    wav_path = Path(argv[1])
    if not wav_path.is_file():
        print(f"VOICE-SMOKE-ERROR: not a file: {wav_path}")
        return 2
    audio = wav_path.read_bytes()
    try:
        channels, rate = validate_wav(wav_path.name, audio)
    except VoiceAPIError as exc:
        print(f"VOICE-SMOKE-ERROR: {exc}")
        return 2
    print(f"audio: {wav_path.name} ({channels}ch, {rate} Hz, {len(audio)} bytes)")

    settings = load_settings()
    print(f"voice: {settings.meta_voice_model} @ {settings.meta_voice_api_url}")
    if not live_voice_available(settings):
        print("VOICE-SMOKE-ERROR: no API key. Set MODEL_API_KEY in .env.")
        return 2
    try:
        result = transcribe_wav(wav_path.name, audio, settings, strict_live=True)
    except VoiceNotConfiguredError:
        print("VOICE-SMOKE-ERROR: no API key. Set MODEL_API_KEY in .env.")
        return 2
    except VoiceAPIError as exc:
        print("VOICE-SMOKE-FAIL: live Muse Voice call failed (no fixture fallback).")
        print(f"HTTP status: {exc.status_code}")
        print(f"response body: {_redact(exc.body or str(exc), settings)}")
        return 1
    if result.provenance != "live_muse_voice":
        print(f"VOICE-SMOKE-FAIL: provenance is {result.provenance}; fixture refused.")
        return 1
    print(f"transcript: {result.transcript}")
    print("VOICE-SMOKE-PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
