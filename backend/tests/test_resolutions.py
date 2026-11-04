"""Verified resolution candidate tests (deterministic, offline)."""

import pytest

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.models import ClearanceAction
from app.scenarios import ARRIVAL_GEOMETRY, SCENARIOS
from app.services import comparison, fms, resolutions


def _s1_inputs(settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot", drop_condition=True)
    matrix = comparison.build_matrix(atc, pilot, program)
    return atc, pilot, matrix


def _key(action: ClearanceAction) -> tuple:
    return (
        action.action_type,
        action.target_fix,
        action.numeric_value,
        action.unit,
        action.trigger_type,
        action.trigger_value,
    )


def test_merit_candidate_restores_condition(offline_settings: Settings):
    atc, pilot, matrix = _s1_inputs(offline_settings)
    candidates = resolutions.enumerate_candidates(
        atc, pilot, matrix, ARRIVAL_GEOMETRY
    )
    assert [c.id for c in candidates] == ["missing-condition-descend-0"]
    candidate = candidates[0]
    assert candidate.verification == "VERIFIED"
    assert candidate.conflict_after is False
    assert "MERIT" in candidate.action_human
    assert candidate.source_evidence is not None
    assert "after merit" in candidate.source_evidence.lower()
    assert candidate.min_vertical_ft == 8000.0


def test_sync_candidate_restores_atc_altitude(offline_settings: Settings):
    scenario = SCENARIOS["altitude-sync"]
    atc = atc_intent.parse_atc(scenario.atc_text, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(scenario.pilot_text, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    candidates = resolutions.enumerate_candidates(atc, pilot, matrix, scenario.geometry)
    assert [c.id for c in candidates] == ["changed-value-maintain-0"]
    assert candidates[0].verification == "VERIFIED"
    assert candidates[0].conflict_after is False
    assert candidates[0].min_vertical_ft == 7000.0


def test_verify_candidate_recomputes(offline_settings: Settings):
    atc, pilot, matrix = _s1_inputs(offline_settings)
    geometry = ARRIVAL_GEOMETRY
    candidates = resolutions.enumerate_candidates(atc, pilot, matrix, geometry)
    result = resolutions.verify_candidate(candidates[0].id, atc, pilot, matrix, geometry)
    assert result.verified is True
    assert result.matrix_overall == "agree"
    assert result.conflict_after is False


def test_unknown_candidate_rejected(offline_settings: Settings):
    atc, pilot, matrix = _s1_inputs(offline_settings)
    with pytest.raises(ValueError, match="Unknown candidate"):
        resolutions.verify_candidate(
            "nope-0", atc, pilot, matrix, ARRIVAL_GEOMETRY
        )


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS))
def test_candidates_contain_no_invented_commands(offline_settings: Settings, scenario_id: str):
    scenario = SCENARIOS[scenario_id]
    atc = atc_intent.parse_atc(scenario.atc_text, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(scenario.pilot_text, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    allowed = {_key(a) for a in atc.actions} | {_key(a) for a in pilot.actions}
    for candidate in resolutions.enumerate_candidates(atc, pilot, matrix, scenario.geometry):
        applied = resolutions.apply_candidate(pilot, candidate.id, atc, matrix)
        assert applied.callsign in {atc.callsign, pilot.callsign}
        for action in applied.actions:
            assert _key(action) in allowed, f"{candidate.id} invents {_key(action)}"
