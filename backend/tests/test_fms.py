"""Simulated FMS behavior tests."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.models import Clearance
from app.services import fms


def test_fms_preserves_atc_constraint(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(atc, source="atc")
    assert program.climb_start_fix == "MERIT"
    assert program.route == ["MERIT", "PONCT"]
    assert program.cleared_fl == 230
    assert program.cleared_alt_ft == 23000
    assert "after MERIT" in program.summary


def test_fms_climbs_early_without_condition(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    assert program.climb_start_fix is None
    assert program.route == ["PONCT"]
    assert program.cleared_alt_ft == 23000
    assert "immediate" in program.summary


def test_corrected_program_restores_constraint(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_corrected(atc)
    assert program.source == "corrected"
    assert program.climb_start_fix == "MERIT"
    assert program.route == ["MERIT", "PONCT"]


def test_low_confidence_actions_are_held(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    dumped = pilot.model_dump()
    dumped["actions"][0]["confidence"] = 0.5
    uncertain = Clearance.model_validate(dumped)
    program = fms.program_from_intent(uncertain, source="pilot")
    assert program.cleared_alt_ft is None
    assert any("CLIMB" in line for line in program.held)
    assert all("CLIMB" not in line for line in program.loaded)
