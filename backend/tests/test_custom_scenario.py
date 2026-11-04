"""Custom ATC clearance arc (transcribed audio): same story, new altitude."""

import pytest

from app.config import Settings
from app.demo import reset_session, run_correction, run_demo
from app.scenarios import SCENARIOS, get_scenario, register_custom_scenario

ATC_15000 = "META 452, decrease to 15,000 feet."


def test_custom_clearance_keeps_story_shape(offline_settings: Settings):
    reset_session()
    scenario = register_custom_scenario(ATC_15000)
    assert scenario.id == "custom"
    assert scenario.pilot_text == "META 452, decrease to 14,000 feet."
    assert scenario.geometry.own_init_alt_ft == 15000.0
    assert scenario.geometry.intruder_alt_ft == 13400.0
    assert get_scenario("custom") is scenario

    result = run_demo(offline_settings, use_live=False, scenario_id="custom")
    assert result.comparison.overall == "mismatch"
    assert {f.category for f in result.comparison.findings} == {"CHANGED_VALUE"}
    assert result.fms.cleared_alt_ft == 14000
    assert result.conflict.conflict is True
    assert result.conflict.profile[0].meta_ft == 15000.0
    assert result.conflict.profile[0].intruder_ft == 13400.0

    fixed = run_correction(offline_settings, use_live=False)
    assert fixed.resolved is True
    assert fixed.conflict.conflict is False
    assert fixed.fms.cleared_alt_ft == 15000


def test_custom_clearance_validates_altitude():
    with pytest.raises(ValueError, match="No altitude in feet"):
        register_custom_scenario("META 452, say again.")
    with pytest.raises(ValueError, match="outside"):
        register_custom_scenario("META 452, decrease to 9,000 feet.")
    with pytest.raises(ValueError, match="outside"):
        register_custom_scenario("META 452, climb to 50,000 feet.")


def test_custom_scenario_resets_cleanly(offline_settings: Settings):
    register_custom_scenario(ATC_15000)
    reset_session()
    with pytest.raises(ValueError, match="Unknown scenario"):
        get_scenario("custom")
    assert set(SCENARIOS) == {"altitude-sync"}
    # The standard arc is untouched by the custom detour.
    result = run_demo(offline_settings, use_live=False, scenario_id="altitude-sync")
    assert result.fms.cleared_alt_ft == 22000
