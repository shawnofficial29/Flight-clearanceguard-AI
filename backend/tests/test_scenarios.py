"""Scenario registry tests: every arc runs parse to resolution offline."""

import pytest

from app.config import Settings
from app.scenarios import SCENARIOS, get_scenario, run_scenario


def test_registry_has_single_sync_scenario():
    assert set(SCENARIOS) == {"altitude-sync"}


def test_altitude_sync_is_default_and_first_listed():
    assert get_scenario(None).id == "altitude-sync"
    assert next(iter(SCENARIOS)) == "altitude-sync"


def test_altitude_sync_numbers_come_from_simulation(offline_settings: Settings):
    """The 23k/22k sync arc: wrong-FMS path descends into traffic, the fix
    holds level until past, then both descend for landing."""
    result = run_scenario(SCENARIOS["altitude-sync"], offline_settings, use_live=False)
    initial = result.initial
    assert initial.fms.cleared_alt_ft == 22000
    assert initial.fms.summary == "Maintain 22,000 ft immediate"
    assert initial.conflict.conflict is True
    assert initial.conflict.first_conflict_time_s == 165.0
    before_alts = [point.meta_ft for point in initial.conflict.profile]
    assert before_alts[0] == 23000.0
    assert 22000.0 in before_alts
    assert min(before_alts) == 10000.0
    assert initial.conflict.profile[0].intruder_ft == 22000.0
    corrected = result.corrected
    corrected_alts = [point.meta_ft for point in corrected.conflict.profile]
    assert corrected_alts[0] == 23000.0
    # Level until safely past MERIT (profile points land every 15 s, so
    # index 16 is T+240 s), then descending and slowing for landing.
    assert all(alt == 23000.0 for alt in corrected_alts[:17])
    assert corrected_alts[17] < 23000.0
    assert corrected.conflict.profile[-1].meta_ft == 10000.0
    assert corrected.conflict.profile[-1].meta_kt == 175.0
    assert corrected.conflict.min_vertical_ft == 1000.0
    assert corrected.conflict.merit_time_s == 248.28
    assert corrected.conflict.merit_vertical_gap_ft == 1000.0
    assert result.resolved is True


def test_unknown_scenario_rejected():
    with pytest.raises(ValueError, match="Unknown scenario"):
        get_scenario("nope")


def test_altitude_sync_descends_and_slows_toward_landing(offline_settings: Settings):
    """Landing descent: level until past the traffic, then down and slow."""
    result = run_scenario(SCENARIOS["altitude-sync"], offline_settings, use_live=False)
    corrected = result.corrected.conflict
    assert corrected.conflict is False
    assert corrected.first_conflict_time_s is None
    alts = [point.meta_ft for point in corrected.profile]
    assert alts[0] == 23000.0
    assert all(alt == 23000.0 for alt in alts[:17])
    assert alts[17] < 23000.0
    assert corrected.profile[0].meta_kt == 290.0
    assert corrected.profile[16].meta_kt == 290.0
    # The slowdown is gradual: still easing down at T+300 s while the
    # descent runs, reaching 175 kt only near the end of the profile.
    assert 175.0 < corrected.profile[20].meta_kt < 290.0
    assert corrected.profile[20].meta_ft < 23000.0
    assert corrected.profile[-1].meta_ft == 10000.0
    assert corrected.profile[-1].meta_kt == 175.0
    assert corrected.min_vertical_ft == 1000.0
    assert corrected.merit_time_s == 248.28
    assert corrected.merit_vertical_gap_ft == 1000.0
    assert result.initial.conflict.conflict is True
    assert result.initial.conflict.first_conflict_time_s == 165.0


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS))
def test_scenario_arc_matches_expectations(offline_settings: Settings, scenario_id: str):
    scenario = SCENARIOS[scenario_id]
    result = run_scenario(scenario, offline_settings, use_live=False)
    initial = result.initial
    assert initial.comparison.overall == scenario.expect_overall
    assert {f.category for f in initial.comparison.findings} == set(scenario.expect_categories)
    assert initial.conflict.conflict is scenario.expect_conflict
    assert result.corrected.comparison.overall == "agree"
    assert result.corrected.conflict.conflict is False
    assert result.resolved is True
