"""Fixed offline fixtures for tests and the deterministic demo."""

from __future__ import annotations

DEMO_ATC_TRANSCRIPT = (
    "META 452, after passing MERIT, climb to flight level 230 and proceed direct PONCT."
)
DEMO_PILOT_TRANSCRIPT = "META 452, climb to flight level 230 and proceed direct PONCT."
MISSING_PHRASE = "after passing MERIT"

FIXTURE_ATC_PAYLOAD: dict = {
    "callsign": "META 452",
    "climb_to_fl": 230,
    "climb_condition_type": "after_passing",
    "climb_condition_fix": "MERIT",
    "direct_to": "PONCT",
    "evidence": {
        "callsign": "META 452",
        "climb_to_fl": "flight level 230",
        "climb_condition_type": "after passing MERIT",
        "climb_condition_fix": "MERIT",
        "direct_to": "direct PONCT",
    },
    "confidence": 0.97,
}

FIXTURE_PILOT_PAYLOAD: dict = {
    "callsign": "META 452",
    "climb_to_fl": 230,
    # No condition stated by the pilot: all condition fields stay null.
    "climb_condition_type": None,
    "climb_condition_fix": None,
    "direct_to": "PONCT",
    "evidence": {
        "callsign": "META 452",
        "climb_to_fl": "flight level 230",
        "climb_condition_type": None,
        "climb_condition_fix": None,
        "direct_to": "direct PONCT",
    },
    "confidence": 0.95,
}
