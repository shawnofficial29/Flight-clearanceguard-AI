"""Fixed offline fixtures for tests and the deterministic demo."""

from __future__ import annotations

DEMO_ATC_TRANSCRIPT = (
    "META 452, after passing MERIT, climb to flight level 230 and proceed direct PONCT."
)
DEMO_PILOT_TRANSCRIPT = "META 452, climb to flight level 230 and proceed direct PONCT."
MISSING_PHRASE = "after passing MERIT"


def _action(
    action_type: str,
    target_fix=None,
    numeric_value=None,
    unit="NONE",
    trigger_type="IMMEDIATE",
    trigger_value=None,
    evidence=None,
    confidence=0.95,
) -> dict:
    return {
        "action_type": action_type,
        "target_fix": target_fix,
        "numeric_value": numeric_value,
        "unit": unit,
        "trigger_type": trigger_type,
        "trigger_value": trigger_value,
        "evidence": evidence,
        "confidence": confidence,
    }


FIXTURE_ATC_PAYLOAD: dict = {
    "callsign": "META 452",
    "callsign_evidence": "META 452",
    "callsign_confidence": 0.97,
    "actions": [
        _action(
            "CLIMB",
            numeric_value=230,
            unit="FL",
            trigger_type="AFTER_WAYPOINT",
            trigger_value="MERIT",
            evidence="after passing MERIT, climb to flight level 230",
            confidence=0.97,
        ),
        _action(
            "DIRECT_TO",
            target_fix="PONCT",
            evidence="proceed direct PONCT",
            confidence=0.97,
        ),
    ],
    "overall_confidence": 0.97,
}

FIXTURE_PILOT_PAYLOAD: dict = {
    "callsign": "META 452",
    "callsign_evidence": "META 452",
    "callsign_confidence": 0.95,
    "actions": [
        # No condition stated by the pilot: the climb stays IMMEDIATE.
        _action(
            "CLIMB",
            numeric_value=230,
            unit="FL",
            evidence="climb to flight level 230",
            confidence=0.95,
        ),
        _action(
            "DIRECT_TO",
            target_fix="PONCT",
            evidence="proceed direct PONCT",
            confidence=0.95,
        ),
    ],
    "overall_confidence": 0.95,
}
