"""Parsing fallback + strict structured-output validation tests."""

import pytest

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, FIXTURE_ATC_PAYLOAD
from app.services.model_client import MetaAPIError, ModelNotConfiguredError
from tests.conftest import choices_transport


def test_atc_fallback_extracts_full_clearance(offline_settings: Settings):
    intent = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    assert intent.callsign == "META 452"
    assert intent.climb_to_fl == 230
    assert intent.climb_condition_type == "after_passing"
    assert intent.climb_condition_fix == "MERIT"
    assert intent.direct_to == "PONCT"
    assert intent.provenance == "fixture_fallback"
    assert intent.raw_text == DEMO_ATC_TRANSCRIPT


def test_pilot_fallback_never_infers_condition(offline_settings: Settings):
    intent = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    assert intent.callsign == "META 452"
    assert intent.climb_to_fl == 230
    assert intent.direct_to == "PONCT"
    assert intent.climb_condition_type is None
    assert intent.climb_condition_fix is None
    assert intent.evidence["climb_condition_type"] is None
    assert intent.provenance == "fixture_fallback"


def test_unstated_values_stay_null(offline_settings: Settings):
    intent = pilot_intent.parse_pilot("META 452, say again.", offline_settings, force_fixture=True)
    assert intent.callsign == "META 452"
    assert intent.climb_to_fl is None
    assert intent.climb_condition_fix is None
    assert intent.direct_to is None


def test_live_path_marks_provenance(live_settings: Settings):
    intent = atc_intent.parse_atc(
        DEMO_ATC_TRANSCRIPT, live_settings, choices_transport(FIXTURE_ATC_PAYLOAD)
    )
    assert intent.provenance == "live_meta_api"
    assert intent.model == "muse-spark-1.3"
    assert intent.climb_condition_fix == "MERIT"


def test_invalid_model_output_falls_back(live_settings: Settings):
    bad = dict(FIXTURE_ATC_PAYLOAD)
    bad["invented_field"] = "MERIT"  # extra key: strict schema must reject
    intent = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, live_settings, choices_transport(bad))
    assert intent.provenance == "fixture_fallback"
    assert intent.climb_condition_fix is None  # fallback still never infers


def test_model_error_falls_back(live_settings: Settings):
    def _boom(url, headers, body, timeout):
        raise MetaAPIError("stub outage")

    intent = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, live_settings, _boom)
    assert intent.provenance == "fixture_fallback"
    assert intent.callsign == "META 452"


def test_fallback_note_explains_reason(offline_settings: Settings, live_settings: Settings):
    not_requested = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    assert "live mode not requested" in (not_requested.note or "")

    unconfigured = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings)
    assert "no MODEL_API_KEY configured" in (unconfigured.note or "")

    def _boom(url, headers, body, timeout):
        raise MetaAPIError("stub outage", status_code=503, body="overloaded")

    failed = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, live_settings, _boom)
    assert failed.provenance == "fixture_fallback"
    assert "live call failed (HTTP 503)" in (failed.note or "")


def test_strict_live_raises_instead_of_fallback(live_settings: Settings):
    def _boom(url, headers, body, timeout):
        raise MetaAPIError("stub outage", status_code=500, body="err")

    with pytest.raises(MetaAPIError):
        atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, live_settings, _boom, strict_live=True)
    with pytest.raises(MetaAPIError):
        pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, live_settings, _boom, strict_live=True)


def test_strict_live_unconfigured_raises(offline_settings: Settings):
    with pytest.raises(ModelNotConfiguredError):
        atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, strict_live=True)


def test_error_text_never_contains_key(live_settings: Settings):
    def _boom(url, headers, body, timeout):
        raise MetaAPIError("stub outage", status_code=500, body="err")

    try:
        pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, live_settings, _boom, strict_live=True)
    except MetaAPIError as exc:
        assert "test-key" not in str(exc)
        assert "test-key" not in (exc.body or "")
    else:  # pragma: no cover - strict mode must raise here
        raise AssertionError("strict_live did not raise")

    fallback = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, live_settings, _boom)
    assert "test-key" not in (fallback.note or "")
