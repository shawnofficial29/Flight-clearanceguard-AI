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
    assert program.route == ["MERIT"]
    assert program.cleared_fl is None
    assert program.cleared_alt_ft == 15000
    assert program.target_speed_kts == 250
    assert program.summary == "Descend 15,000 ft after MERIT, 250 kt immediate"


def test_fms_descends_early_without_condition(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot", drop_condition=True)
    assert program.climb_start_fix is None
    assert program.route == []
    assert program.cleared_alt_ft == 15000
    assert program.target_speed_kts == 250
    assert program.summary == "Descend to 15,000 ft immediate, 250 kt immediate"


def test_fms_entry_error_keeps_condition_in_readback(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot", drop_condition=True)
    descend = next(a for a in pilot.actions if a.action_type == "DESCEND")
    assert descend.trigger_type == "AFTER_WAYPOINT"
    loaded_descend = next(a for a in program.loaded_actions if a.action_type == "DESCEND")
    assert loaded_descend.trigger_type == "IMMEDIATE"
    assert loaded_descend.trigger_value is None
    speed = next(a for a in program.loaded_actions if a.action_type == "SPEED")
    assert speed.trigger_type == "IMMEDIATE"
    assert speed.trigger_value is None


def test_corrected_program_restores_constraint(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_corrected(atc)
    assert program.source == "corrected"
    assert program.climb_start_fix == "MERIT"
    assert program.route == ["MERIT"]


def test_low_confidence_actions_are_held(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    dumped = pilot.model_dump()
    dumped["actions"][1]["confidence"] = 0.5
    uncertain = Clearance.model_validate(dumped)
    program = fms.program_from_intent(uncertain, source="pilot")
    assert program.cleared_alt_ft is None
    assert any("DESCEND" in line for line in program.held)
    assert all("DESCEND" not in line for line in program.loaded)
