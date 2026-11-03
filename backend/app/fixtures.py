"""Fixed offline fixtures for tests and the deterministic demo."""

from __future__ import annotations

DEMO_ATC_TRANSCRIPT = (
    "META 452, reduce speed to 250 knots now. "
    "After MERIT, descend and maintain 15,000 feet."
)
DEMO_PILOT_TRANSCRIPT = (
    "META 452, reduce speed to 250 knots now. "
    "After MERIT, descend and maintain 15,000 feet."
)
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
            "SPEED",
            numeric_value=250,
            unit="KTS",
            evidence="reduce speed to 250 knots now",
            confidence=0.97,
        ),
        _action(
            "DESCEND",
            numeric_value=15000,
            unit="FT",
            trigger_type="AFTER_WAYPOINT",
            trigger_value="MERIT",
            evidence="After MERIT, descend to 15,000 feet",
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
        # Correct readback: the condition is stated; the FMS entry drops it.
        _action(
            "SPEED",
            numeric_value=250,
            unit="KTS",
            evidence="reduce speed to 250 knots now",
            confidence=0.95,
        ),
        _action(
            "DESCEND",
            numeric_value=15000,
            unit="FT",
            trigger_type="AFTER_WAYPOINT",
            trigger_value="MERIT",
            evidence="After MERIT, descend to 15,000 feet",
            confidence=0.95,
        ),
    ],
    "overall_confidence": 0.95,
}
