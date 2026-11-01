"""End-to-end demo scenario tests (deterministic fixture mode)."""

from app.config import Settings
from app.demo import reset_session, run_correction, run_demo


def test_demo_run_detects_mismatch_and_conflict(offline_settings: Settings):
    reset_session()
    result = run_demo(offline_settings, use_live=False)
    assert result.comparison.overall == "mismatch"
    assert result.comparison.missing_condition is True
    assert result.conflict.conflict is True
    assert result.conflict.first_conflict_time_s is not None
    assert "MERIT" in result.explanation.summary or "MERIT" in result.explanation.cause
    assert "Pilot confirms corrected FMS entry" in result.explanation.recommended_action
    assert set(result.badges.values()) == {"Fixture fallback"}
    # The pilot program climbs early while ATC required waiting for MERIT.
    assert result.fms.climb_start_fix is None
    assert result.atc_intent.climb_condition_fix == "MERIT"


def test_demo_correction_removes_conflict(offline_settings: Settings):
    reset_session()
    run_demo(offline_settings, use_live=False)
    corrected = run_correction(offline_settings, use_live=False)
    assert corrected.resolved is True
    assert corrected.conflict.conflict is False
    assert corrected.comparison.overall == "agree"
    assert corrected.fms.climb_start_fix == "MERIT"
