"""End-to-end demo scenario tests (deterministic fixture mode)."""

from app.config import Settings
from app.demo import reset_session, run_correction, run_demo


def test_demo_run_detects_mismatch_and_conflict(offline_settings: Settings):
    reset_session()
    result = run_demo(offline_settings, use_live=False, scenario_id="altitude-sync")
    assert result.comparison.overall == "mismatch"
    assert {f.category for f in result.comparison.findings} == {"CHANGED_VALUE"}
    assert result.comparison.missing_condition is False
    assert result.conflict.conflict is True
    assert result.conflict.first_conflict_time_s == 165.0
    assert "CHANGED_VALUE" in result.explanation.summary
    assert "Pilot confirms corrected FMS entry" in result.explanation.recommended_action
    assert set(result.badges.values()) == {"Fixture fallback"}
    # The pilot misheard 23,000 as 22,000; the FMS faithfully holds the wrong value.
    assert result.fms.cleared_alt_ft == 22000
    assert result.fms.summary == "Maintain 22,000 ft immediate"
    maintain = next(a for a in result.atc.actions if a.action_type == "MAINTAIN")
    assert maintain.numeric_value == 23000


def test_demo_correction_removes_conflict(offline_settings: Settings):
    reset_session()
    run_demo(offline_settings, use_live=False, scenario_id="altitude-sync")
    corrected = run_correction(offline_settings, use_live=False, scenario_id="altitude-sync")
    assert corrected.resolved is True
    assert corrected.conflict.conflict is False
    assert corrected.comparison.overall == "agree"
    assert corrected.fms.summary == "Maintain 23,000 ft immediate"
