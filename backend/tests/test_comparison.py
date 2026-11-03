"""Deterministic clearance comparison tests."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.demo import CORRECTED_PILOT_TRANSCRIPT
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, MISSING_PHRASE
from app.models import Clearance
from app.services import comparison, fms


def _demo_triple(settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot", drop_condition=True)
    return atc, pilot, program


def test_demo_pair_flags_missing_condition(offline_settings: Settings):
    atc, pilot, program = _demo_triple(offline_settings)
    matrix = comparison.build_matrix(atc, pilot, program)
    assert matrix.overall == "mismatch"
    assert matrix.missing_condition is True
    assert matrix.missing_phrase == MISSING_PHRASE
    assert {f.category for f in matrix.findings} == {"MISSING_CONDITION"}
    assert {f.scope for f in matrix.findings} == {"pilot_vs_fms"}
    assert {f.action for f in matrix.findings} == {"DESCEND"}
    aspects = {row.aspect: row for row in matrix.rows}
    assert aspects["DESCEND"].status == "mismatch"
    assert aspects["DESCEND"].category == "MISSING_CONDITION"
    assert aspects["SPEED"].status == "match"
    assert aspects["SPEED"].atc == "250 kt now"
    assert aspects["SPEED"].pilot == "250 kt now"
    assert aspects["SPEED"].fms == "250 kt now"
    assert "DIRECT_TO" not in aspects
    assert aspects["Callsign"].status == "match"
    for row in matrix.rows:
        assert row.atc and row.pilot and row.fms and row.predicted


def test_corrected_triple_agrees(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(CORRECTED_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_corrected(atc)
    matrix = comparison.build_matrix(atc, pilot, program)
    assert matrix.overall == "agree"
    assert matrix.missing_condition is False
    assert matrix.findings == []
    assert all(row.status == "match" for row in matrix.rows)


def test_uncertainty_gate_requires_verification(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    dumped = pilot.model_dump()
    dumped["actions"][1]["confidence"] = 0.5
    uncertain = Clearance.model_validate(dumped)
    program = fms.program_from_intent(uncertain, source="pilot")
    matrix = comparison.build_matrix(atc, uncertain, program)
    assert matrix.overall == "verify_required"
    assert matrix.min_confidence < 0.85
    assert "PARTIAL_FMS_LOAD" in {f.category for f in matrix.findings}


def test_changed_value_categorized(offline_settings: Settings):
    atc = atc_intent.parse_atc("META 452, descend to 11,000 feet.", offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot("META 452, descend to 10,000 feet.", offline_settings, force_fixture=True)
    matrix = comparison.build_matrix(atc, pilot, fms.program_from_intent(pilot))
    assert matrix.overall == "mismatch"
    assert {f.category for f in matrix.findings} == {"CHANGED_VALUE"}


def test_callsign_mismatch_categorized(offline_settings: Settings):
    atc = atc_intent.parse_atc("META 452, climb to flight level 230.", offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot("META 425, climb to flight level 230.", offline_settings, force_fixture=True)
    matrix = comparison.build_matrix(atc, pilot, fms.program_from_intent(pilot))
    assert {f.category for f in matrix.findings} == {"CALLSIGN_MISMATCH"}
