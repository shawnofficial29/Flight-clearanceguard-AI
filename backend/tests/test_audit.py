"""Audit event chain tests (hash links, tamper detection, sanitization)."""

import pytest

from app.config import Settings
from app.scenarios import SCENARIOS, run_scenario
from app.services import audit


@pytest.fixture(autouse=True)
def _clean_chain():
    audit.reset_chain()
    yield
    audit.reset_chain()


def test_scenario_run_appends_linked_chain(offline_settings: Settings):
    run_scenario(SCENARIOS["early-climb"], offline_settings, use_live=False)
    events = audit.events()
    assert [e.type for e in events] == [
        "parse_atc",
        "parse_pilot",
        "fms_program",
        "compare",
        "predict_conflict",
        "correct_fms",
        "verify_resolution",
    ]
    assert [e.seq for e in events] == [1, 2, 3, 4, 5, 6, 7]
    assert events[0].prev_hash == "GENESIS"
    for previous, event in zip(events, events[1:]):
        assert event.prev_hash == previous.hash
    assert events[-1].human_confirmation == "simulated-pilot-confirmed"
    report = audit.verify()
    assert report.valid is True
    assert report.length == 7
    assert report.head == events[-1].hash
    assert report.first_bad_seq is None


def test_chain_tampering_is_detectable():
    audit.append("compare", {"overall": "mismatch"})
    audit.append("predict_conflict", {"conflict": True})
    assert audit.verify().valid is True
    audit.events()[0].result["overall"] = "agree"
    report = audit.verify()
    assert report.valid is False
    assert report.first_bad_seq == 1


def test_secrets_are_redacted():
    event = audit.append("parse_atc", {"api_key": "sekret", "callsign": "META 452"})
    assert event.result == {"api_key": "***", "callsign": "META 452"}
    assert "sekret" not in event.model_dump_json()


def test_no_thought_or_credential_fields():
    run_scenario(SCENARIOS["altitude-value"], Settings(
        meta_api_key=None,
        meta_model_api_url="https://stub.invalid/model",
        meta_voice_api_url="https://stub.invalid/voice",
    ), use_live=False)
    for event in audit.events():
        blob = event.model_dump_json().lower()
        assert "chain-of-thought" not in blob
        assert "thought" not in blob
        assert "api_key" not in event.result
