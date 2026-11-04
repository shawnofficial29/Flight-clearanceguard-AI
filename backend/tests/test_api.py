"""HTTP API tests via FastAPI TestClient (fixture mode, no network)."""

import io
import wave

from fastapi.testclient import TestClient

from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.main import app
from app.scenarios import SCENARIOS

client = TestClient(app)

SYNC = SCENARIOS["altitude-sync"]


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
    descend = next(a for a in atc["actions"] if a["action_type"] == "DESCEND")
    assert descend["trigger_value"] == "MERIT"
    pilot = client.post("/api/pilot/parse", json={"transcript": DEMO_PILOT_TRANSCRIPT}).json()
    descend = next(a for a in pilot["actions"] if a["action_type"] == "DESCEND")
    assert descend["trigger_type"] == "AFTER_WAYPOINT"
    assert descend["trigger_value"] == "MERIT"


def test_scenarios_endpoint():
    body = client.get("/api/scenarios").json()
    assert [s["id"] for s in body["scenarios"]] == ["altitude-sync"]


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


def _triple() -> dict:
    atc = client.post("/api/atc/parse", json={"transcript": SYNC.atc_text}).json()
    pilot = client.post("/api/pilot/parse", json={"transcript": SYNC.pilot_text}).json()
    fms = client.post(
        "/api/fms/program",
        json={"intent": pilot, "source": "pilot", "scenario_id": "altitude-sync"},
    ).json()
    return {"atc": atc, "pilot": pilot, "fms": fms}


def test_safety_window_endpoint():
    window = client.post(
        "/api/safety/window", json={**_triple(), "scenario_id": "altitude-sync"}
    ).json()
    assert window["conflict_time_s"] is None
    assert window["last_safe_correction_s"] is None
    assert len(window["causal_chain"]) == 1


def test_resolutions_endpoints():
    triple = {**_triple(), "scenario_id": "altitude-sync"}
    candidates = client.post("/api/resolutions/enumerate", json=triple).json()
    assert [c["id"] for c in candidates] == ["changed-value-maintain-0"]
    assert candidates[0]["verification"] == "VERIFIED"
    verification = client.post(
        "/api/resolutions/verify", json={**triple, "candidate_id": candidates[0]["id"]}
    ).json()
    assert verification["verified"] is True


def test_fingerprints_and_audit_endpoints():
    triple = _triple()
    prints = client.post("/api/fingerprints", json=triple).json()
    assert prints["all_agree"] is False
    assert prints["display_id"] == prints["atc"][:8]
    client.post("/api/demo/run", json={"use_live": False})
    events = client.get("/api/audit/events").json()
    assert len(events) >= 7
    assert client.get("/api/audit/verify").json()["valid"] is True


def test_coordinate_endpoint_offline():
    result = client.post(
        "/api/coordinate",
        json={
            "atc_text": SYNC.atc_text,
            "pilot_text": SYNC.pilot_text,
            "scenario_id": "altitude-sync",
        },
    ).json()
    assert result["recommended_candidate_id"] == "changed-value-maintain-0"
    assert result["overridden"] is False
