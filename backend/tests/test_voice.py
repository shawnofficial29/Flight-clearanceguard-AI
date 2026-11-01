"""Muse Voice wrapper tests (fixture + stubbed live path, no network)."""

import io
import wave

import pytest

from app.config import Settings
from app.fixtures import DEMO_PILOT_TRANSCRIPT
from app.services.voice import (
    VoiceAPIError,
    VoiceNotConfiguredError,
    request_payload,
    transcribe_wav,
)


def make_wav(*, channels: int = 1, sampwidth: int = 2, rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(sampwidth)
        handle.setframerate(rate)
        handle.writeframes(b"\x00" * (sampwidth * channels * rate // 10))
    return buffer.getvalue()


def test_known_demo_file_uses_fixture(offline_settings: Settings):
    result = transcribe_wav(
        "meta452_readback.wav", make_wav(), offline_settings, force_fixture=True
    )
    assert result.transcript == DEMO_PILOT_TRANSCRIPT
    assert result.provenance == "fixture_fallback"


def test_unknown_file_without_api_asks_for_typed_input(offline_settings: Settings):
    with pytest.raises(VoiceAPIError, match="typed input"):
        transcribe_wav("unknown.wav", make_wav(), offline_settings, force_fixture=True)


def test_live_voice_stub_marks_provenance(live_settings: Settings):
    def _send(url, headers, filename, audio, model, timeout):
        assert model == "muse-voice-transcribe-1.0"
        return {"transcript": DEMO_PILOT_TRANSCRIPT}

    result = transcribe_wav("cockpit.wav", make_wav(), live_settings, _send)
    assert result.provenance == "live_muse_voice"
    assert result.transcript == DEMO_PILOT_TRANSCRIPT


def test_live_voice_error_falls_back_to_fixture(live_settings: Settings):
    from app.services.voice import VoiceAPIError as VoiceErr

    def _boom(url, headers, filename, audio, model, timeout):
        raise VoiceErr("stub outage")

    result = transcribe_wav("meta452_readback.wav", make_wav(), live_settings, _boom)
    assert result.provenance == "fixture_fallback"
    assert result.transcript == DEMO_PILOT_TRANSCRIPT


def test_request_payload_shape():
    assert request_payload("muse-voice-transcribe-1.0") == {
        "model": "muse-voice-transcribe-1.0",
        "audioEncoding": "WAV",
        "mode": "PUSH_TO_TALK",
        "keywords": ["META452", "MERIT", "PONCT"],
    }


@pytest.mark.parametrize(
    "audio",
    [
        b"not-a-wav-file",
        make_wav(channels=2),
        make_wav(sampwidth=1),
        make_wav(rate=8000),
    ],
)
def test_invalid_wav_rejected(offline_settings: Settings, audio: bytes):
    with pytest.raises(VoiceAPIError, match="mono 16-bit PCM"):
        transcribe_wav("bad.wav", audio, offline_settings, force_fixture=True)


def test_16khz_accepted(offline_settings: Settings):
    result = transcribe_wav(
        "meta452_readback.wav", make_wav(rate=16000), offline_settings, force_fixture=True
    )
    assert result.provenance == "fixture_fallback"


def test_strict_live_unconfigured_raises(offline_settings: Settings):
    with pytest.raises(VoiceNotConfiguredError):
        transcribe_wav("cockpit.wav", make_wav(), offline_settings, strict_live=True)


def test_strict_live_stub_returns_live(live_settings: Settings):
    def _send(url, headers, filename, audio, model, timeout):
        return {"transcript": DEMO_PILOT_TRANSCRIPT}

    result = transcribe_wav("cockpit.wav", make_wav(), live_settings, _send, strict_live=True)
    assert result.provenance == "live_muse_voice"


def test_strict_live_error_propagates(live_settings: Settings):
    def _boom(url, headers, filename, audio, model, timeout):
        raise VoiceAPIError("stub outage", status_code=500, body="err")

    with pytest.raises(VoiceAPIError):
        transcribe_wav("cockpit.wav", make_wav(), live_settings, _boom, strict_live=True)
