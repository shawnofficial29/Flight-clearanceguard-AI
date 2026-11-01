"""Scenario registry tests: every arc runs parse to resolution offline."""

import pytest

from app.config import Settings
from app.scenarios import SCENARIOS, get_scenario, run_scenario


def test_registry_has_three_scenarios():
    assert set(SCENARIOS) == {"early-climb", "altitude-value", "wrong-direct"}


def test_unknown_scenario_rejected():
    with pytest.raises(ValueError, match="Unknown scenario"):
        get_scenario("nope")


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
