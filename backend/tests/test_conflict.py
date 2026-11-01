"""4D conflict prediction tests."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.services import conflict, fms


def test_early_climb_predicts_conflict(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    prediction = conflict.predict(program)
    assert prediction.conflict is True
    assert prediction.first_conflict_time_s is not None
    assert 200.0 <= prediction.first_conflict_time_s <= 240.0
    assert prediction.lateral_nm_at_conflict is not None
    assert prediction.lateral_nm_at_conflict < prediction.lateral_threshold_nm
    assert prediction.vertical_ft_at_conflict is not None
    assert prediction.vertical_ft_at_conflict < prediction.vertical_threshold_ft
    assert prediction.lateral_threshold_nm == 5.0
    assert prediction.vertical_threshold_ft == 1000.0
    assert prediction.conflict_point_nm is not None
    assert len(prediction.profile) > 10


def test_constrained_climb_has_no_conflict(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_corrected(atc)
    prediction = conflict.predict(program)
    assert prediction.conflict is False
    assert prediction.first_conflict_time_s is None
    assert prediction.conflict_point_nm is None


def test_prediction_is_deterministic(offline_settings: Settings):
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot")
    first = conflict.predict(program)
    second = conflict.predict(program)
    assert first.model_dump() == second.model_dump()
