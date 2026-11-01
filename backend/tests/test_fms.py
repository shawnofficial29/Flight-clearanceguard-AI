"""Simulated FMS behavior tests."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.services import fms


def test_fms_preserves_atc_constraint(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(atc, source="atc")
    assert program.climb_start_fix == "MERIT"
    assert program.route == ["MERIT", "PONCT"]
    assert program.cleared_fl == 230
    assert "after MERIT" in program.summary


def test_fms_climbs_early_without_condition(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    assert program.climb_start_fix is None
    assert program.route == ["PONCT"]
    assert "Immediate climb" in program.summary


def test_corrected_program_restores_constraint(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_corrected(atc)
    assert program.source == "corrected"
    assert program.climb_start_fix == "MERIT"
    assert program.route == ["MERIT", "PONCT"]
