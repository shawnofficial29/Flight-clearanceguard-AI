"""Safety window counterfactual tests (deterministic, offline)."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.scenarios import SCENARIOS
from app.services import comparison, conflict, fms, safety


def _s1_triple(settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    return atc, pilot, program


def test_last_safe_correction_precedes_conflict(offline_settings: Settings):
    atc, _, program = _s1_triple(offline_settings)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    matrix = comparison.build_matrix(atc, pilot, program)
    geometry = SCENARIOS["early-climb"].geometry
    window = safety.calculate(atc, program, matrix.findings, geometry)
    expected_t = conflict.predict(program, geometry).first_conflict_time_s
    assert window.conflict_time_s == expected_t
    assert window.last_safe_correction_s is not None
    assert 0.0 < window.last_safe_correction_s < window.conflict_time_s
    assert window.seconds_remaining_s == window.last_safe_correction_s
    assert window.position_at_last_safe is not None
    assert window.position_at_last_safe["alt_ft"] > 15000.0
    assert [step.stage for step in window.causal_chain] == ["MISMATCH", "FMS", "TRAJECTORY", "CONFLICT"]
    assert window.min_sep_no_correction.min_vertical_ft < 1000.0


def test_correction_before_boundary_removes_conflict(offline_settings: Settings):
    atc, _, program = _s1_triple(offline_settings)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    matrix = comparison.build_matrix(atc, pilot, program)
    geometry = SCENARIOS["early-climb"].geometry
    window = safety.calculate(atc, program, matrix.findings, geometry)
    assert window.last_safe_correction_s is not None
    early_conflict, _ = safety.simulate_correction_at(program, atc, geometry, 0.0)
    assert early_conflict is False
    boundary_conflict, _ = safety.simulate_correction_at(
        program, atc, geometry, window.last_safe_correction_s
    )
    assert boundary_conflict is False


def test_correction_after_boundary_violates_threshold(offline_settings: Settings):
    atc, _, program = _s1_triple(offline_settings)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    matrix = comparison.build_matrix(atc, pilot, program)
    geometry = SCENARIOS["early-climb"].geometry
    window = safety.calculate(atc, program, matrix.findings, geometry)
    assert window.last_safe_correction_s is not None
    late_conflict, _ = safety.simulate_correction_at(
        program, atc, geometry, window.last_safe_correction_s + 30.0
    )
    assert late_conflict is True


def test_no_conflict_window_stays_open(offline_settings: Settings):
    scenario = SCENARIOS["wrong-direct"]
    atc = atc_intent.parse_atc(scenario.atc_text, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(scenario.pilot_text, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    window = safety.calculate(atc, program, matrix.findings, scenario.geometry)
    assert window.conflict_time_s is None
    assert window.last_safe_correction_s is None
    assert window.min_sep_after_correction.min_vertical_ft >= 1000.0
