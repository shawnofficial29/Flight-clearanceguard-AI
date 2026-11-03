"""Intent fingerprint tests (deterministic integrity, not signatures)."""

from app.agents import atc_intent, pilot_intent
from app.config import Settings
from app.demo import CORRECTED_PILOT_TRANSCRIPT
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from app.models import Clearance
from app.services import fingerprints, fms


def test_matching_intent_matches_fingerprint(offline_settings: Settings):
    first = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    second = pilot_intent.parse_pilot(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    assert fingerprints.fingerprint_clearance(first) == fingerprints.fingerprint_clearance(second)


def test_one_changed_field_changes_fingerprint(offline_settings: Settings):
    intent = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    dumped = intent.model_dump()
    dumped["actions"][0]["trigger_value"] = "PONCT"
    changed = Clearance.model_validate(dumped)
    assert fingerprints.fingerprint_clearance(intent) != fingerprints.fingerprint_clearance(changed)


def test_evidence_and_confidence_excluded(offline_settings: Settings):
    intent = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    dumped = intent.model_dump()
    dumped["actions"][0]["evidence"] = "different words, same meaning"
    dumped["actions"][0]["confidence"] = 0.5
    relabeled = Clearance.model_validate(dumped)
    assert fingerprints.fingerprint_clearance(intent) == fingerprints.fingerprint_clearance(relabeled)


def test_three_way_agreement(offline_settings: Settings):
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, offline_settings, force_fixture=True)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, offline_settings, force_fixture=True)
    program = fms.program_from_intent(pilot, source="pilot", drop_condition=True)
    before = fingerprints.fingerprints(atc, pilot, program)
    assert before.all_agree is False
    assert before.atc == before.pilot
    assert before.pilot != before.fms
    assert before.display_id == before.atc[:8] and len(before.display_id) == 8

    corrected_pilot = pilot_intent.parse_pilot(
        CORRECTED_PILOT_TRANSCRIPT, offline_settings, force_fixture=True
    )
    corrected_program = fms.program_corrected(atc)
    after = fingerprints.fingerprints(atc, corrected_pilot, corrected_program)
    assert after.all_agree is True
