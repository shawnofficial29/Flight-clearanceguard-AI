"""HTTP API tests via FastAPI TestClient (fixture mode, no network)."""

import io
import wave

from fastapi.testclient import TestClient

from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.main import app

client = TestClient(app)


def _demo_wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * 2400)
    return buffer.getvalue()


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"] == "muse-spark-1.3"
    assert body["voice_model"] == "muse-voice-transcribe-1.0"


def test_parse_routes():
    atc = client.post("/api/atc/parse", json={"transcript": DEMO_ATC_TRANSCRIPT}).json()
    assert atc["actions"][0]["trigger_value"] == "MERIT"
    pilot = client.post("/api/pilot/parse", json={"transcript": DEMO_PILOT_TRANSCRIPT}).json()
    climb = next(a for a in pilot["actions"] if a["action_type"] == "CLIMB")
    assert climb["trigger_type"] == "IMMEDIATE"
    assert climb["trigger_value"] is None


def test_scenarios_endpoint():
    body = client.get("/api/scenarios").json()
    assert {s["id"] for s in body["scenarios"]} == {"early-climb", "altitude-value", "wrong-direct"}


def test_voice_transcribe_fixture_file():
    response = client.post(
        "/api/voice/transcribe",
        files={"file": ("meta452_readback.wav", _demo_wav_bytes(), "audio/wav")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == DEMO_PILOT_TRANSCRIPT
    assert body["provenance"] == "fixture_fallback"


def test_demo_run_and_correct_endpoints():
    client.post("/api/session/reset")
    demo = client.post("/api/demo/run", json={"use_live": False}).json()
    assert demo["comparison"]["overall"] == "mismatch"
    assert demo["conflict"]["conflict"] is True
    assert demo["conflict"]["first_conflict_time_s"] is not None
    corrected = client.post("/api/demo/correct", json={"use_live": False}).json()
    assert corrected["resolved"] is True
    assert corrected["conflict"]["conflict"] is False
    assert corrected["comparison"]["overall"] == "agree"
