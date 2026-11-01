"""Simulated FMS: programs a clearance interpretation into route/level state.

Pure deterministic mapping — no language understanding here. A missing climb
condition programs an immediate climb, which is exactly the demo hazard.
"""

from __future__ import annotations

from typing import Literal

from ..models import AFTER_PASSING, FMSProgram, StructuredIntent


def program_from_intent(
    intent: StructuredIntent, source: Literal["atc", "pilot"] = "pilot"
) -> FMSProgram:
    constrained = (
        intent.climb_condition_type == AFTER_PASSING and intent.climb_condition_fix is not None
    )
    climb_start_fix = intent.climb_condition_fix if constrained else None
    route: list[str] = []
    if climb_start_fix:
        route.append(climb_start_fix)
    if intent.direct_to and intent.direct_to not in route:
        route.append(intent.direct_to)
    if constrained and climb_start_fix:
        summary = (
            f"Climb FL{intent.climb_to_fl} after {climb_start_fix}, "
            f"direct {intent.direct_to or '---'}"
            if intent.climb_to_fl
            else f"Hold level to {climb_start_fix}, direct {intent.direct_to or '---'}"
        )
    else:
        summary = (
            f"Immediate climb FL{intent.climb_to_fl}, direct {intent.direct_to or '---'}"
            if intent.climb_to_fl
            else "No vertical clearance programmed"
        )
    return FMSProgram(
        callsign=intent.callsign,
        cleared_fl=intent.climb_to_fl,
        climb_start_fix=climb_start_fix,
        lateral_direct_to=intent.direct_to,
        route=route,
        source=source,
        provenance=intent.provenance,
        summary=summary,
    )


def program_corrected(atc_intent: StructuredIntent) -> FMSProgram:
    """Simulated pilot correction: reprogram the FMS from the ATC clearance."""
    program = program_from_intent(atc_intent, source="atc")
    program.source = "corrected"
    return program
