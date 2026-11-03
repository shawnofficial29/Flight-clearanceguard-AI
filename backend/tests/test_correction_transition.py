"""Correction transition: every derived view must describe the corrected state."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.demo import reset_session, run_correction, run_demo
from app.main import app
from app.scenarios import SCENARIOS
from app.services import audit, comparison, fingerprints, safety

client = TestClient(app)


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS))
def test_corrected_triple_agrees_everywhere(offline_settings: Settings, scenario_id: str):
    """The corrected pilot intent plus corrected FMS must agree on all views."""
    reset_session()
    scenario = SCENARIOS[scenario_id]
    demo = run_demo(offline_settings, use_live=False, scenario_id=scenario_id)
    corrected = run_correction(offline_settings, use_live=False, scenario_id=scenario_id)

    assert corrected.resolved is True
    assert corrected.corrected_pilot.raw_text == scenario.corrected_text

    matrix = comparison.build_matrix(demo.atc, corrected.corrected_pilot, corrected.fms)
    assert matrix.overall == "agree"
    assert matrix.findings == []

    prints = fingerprints.fingerprints(demo.atc, corrected.corrected_pilot, corrected.fms)
    assert prints.all_agree is True
    assert prints.display_id == prints.atc[:8] == prints.pilot[:8] == prints.fms[:8]

    window = safety.calculate(demo.atc, corrected.fms, matrix.findings, scenario.geometry)
    assert window.conflict_time_s is None
    assert window.last_safe_correction_s is None


def test_correction_response_carries_corrected_pilot():
    reset_session()
    client.post("/api/demo/run", json={"use_live": False, "scenario_id": "altitude-sync"})
    body = client.post(
        "/api/demo/correct", json={"use_live": False, "scenario_id": "altitude-sync"}
    ).json()
    pilot = body["corrected_pilot"]
    assert pilot["role"] == "pilot"
    assert pilot["raw_text"] == SCENARIOS["altitude-sync"].corrected_text
    assert body["comparison"]["overall"] == "agree"
    assert body["conflict"]["conflict"] is False


def test_correction_audit_shows_human_confirmation():
    reset_session()
    client.post("/api/demo/run", json={"use_live": False})
    client.post("/api/demo/correct", json={"use_live": False})
    events = client.get("/api/audit/events").json()
    confirmed = [e for e in events if e["human_confirmation"] == "simulated-pilot-confirmed"]
    assert {e["type"] for e in confirmed} == {"correct_fms", "verify_resolution"}
    assert client.get("/api/audit/verify").json()["valid"] is True


def test_reset_starts_clean_session(offline_settings: Settings):
    run_demo(offline_settings, use_live=False)
    assert len(audit.events()) > 0
    assert reset_session() == {"status": "reset"}
    assert audit.events() == []
    report = audit.verify()
    assert report.valid is True
    assert report.length == 0
    assert report.head is None
    assert report.first_bad_seq is None


def test_reset_endpoint_clears_audit_chain():
    client.post("/api/demo/run", json={"use_live": False})
    assert client.post("/api/session/reset").json() == {"status": "reset"}
    assert client.get("/api/audit/events").json() == []
    report = client.get("/api/audit/verify").json()
    assert report == {"valid": True, "length": 0, "head": None, "first_bad_seq": None}
