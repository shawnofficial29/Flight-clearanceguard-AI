"""Deterministic clearance comparison tests."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.demo import CORRECTED_PILOT_TRANSCRIPT
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, MISSING_PHRASE
from app.services import comparison, fms


def _demo_triple(settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    return atc, pilot, program


def test_demo_pair_flags_missing_condition(offline_settings: Settings):
    atc, pilot, program = _demo_triple(offline_settings)
    matrix = comparison.build_matrix(atc, pilot, program)
    assert matrix.overall == "mismatch"
    assert matrix.missing_condition is True
    assert matrix.missing_phrase == MISSING_PHRASE
    aspects = {row.aspect: row for row in matrix.rows}
    assert aspects["Climb condition"].status == "mismatch"
    assert "MERIT" in aspects["Climb condition"].atc
    assert aspects["Climb condition"].pilot == "Not stated"
    assert aspects["Target level"].status == "match"
    assert aspects["Lateral path"].status == "match"
    assert {row.aspect for row in matrix.rows} == {
        "Callsign",
        "Target level",
        "Climb condition",
        "Lateral path",
    }
    for row in matrix.rows:
        assert row.atc and row.pilot and row.fms and row.predicted


def test_corrected_triple_agrees(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(CORRECTED_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_corrected(atc)
    matrix = comparison.build_matrix(atc, pilot, program)
    assert matrix.overall == "agree"
    assert matrix.missing_condition is False
    assert all(row.status == "match" for row in matrix.rows)
