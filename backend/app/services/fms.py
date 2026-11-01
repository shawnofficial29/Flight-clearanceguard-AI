"""Simulated FMS: programs a clearance interpretation into route/level state.

Pure deterministic mapping — no language understanding here. Actions below
the confidence gate are held for verification instead of loaded, which the
comparison reports as PARTIAL_FMS_LOAD.
"""

from __future__ import annotations

from typing import Literal

from ..models import CONFIDENCE_GATE, Clearance, ClearanceAction, FMSProgram

_ALT_UNITS = ("FL", "FT")


def _alt_ft(action: ClearanceAction) -> int | None:
    if action.numeric_value is None:
        return None
    if action.unit == "FL":
        return action.numeric_value * 100
    if action.unit == "FT":
        return action.numeric_value
    return None


def _action_label(action: ClearanceAction) -> str:
    parts = [action.action_type]
    if action.target_fix:
        parts.append(action.target_fix)
    if action.numeric_value is not None:
        parts.append(f"{action.numeric_value}{action.unit}")
    if action.trigger_type != "IMMEDIATE" and action.trigger_value:
        parts.append(f"{action.trigger_type} {action.trigger_value}")
    elif action.trigger_type != "IMMEDIATE":
        parts.append(action.trigger_type)
    return " ".join(parts)


def program_from_intent(intent: Clearance, source: Literal["atc", "pilot"] = "pilot") -> FMSProgram:
    loaded_actions = [a for a in intent.actions if a.confidence >= CONFIDENCE_GATE]
    held_actions = [a for a in intent.actions if a.confidence < CONFIDENCE_GATE]

    vertical = next(
        (
            a
            for a in loaded_actions
            if a.action_type in ("CLIMB", "DESCEND", "MAINTAIN") and a.unit in _ALT_UNITS
        ),
        None,
    )
    cleared_fl = vertical.numeric_value if vertical and vertical.unit == "FL" else None
    cleared_alt_ft = _alt_ft(vertical) if vertical else None
    climb_start_fix = None
    if vertical and vertical.trigger_type == "AFTER_WAYPOINT":
        climb_start_fix = vertical.trigger_value

    direct = next((a for a in loaded_actions if a.action_type == "DIRECT_TO"), None)
    lateral_direct_to = direct.target_fix if direct else None

    route: list[str] = []
    if climb_start_fix and climb_start_fix not in route:
        route.append(climb_start_fix)
    for action in loaded_actions:
        if action.action_type == "DIRECT_TO" and action.target_fix not in route:
            route.append(action.target_fix)  # type: ignore[arg-type]
        if action.action_type == "HOLD" and action.target_fix not in route:
            route.append(action.target_fix)  # type: ignore[arg-type]

    if vertical and cleared_alt_ft:
        if climb_start_fix:
            summary = f"Climb FL{cleared_fl} after {climb_start_fix}" if cleared_fl else (
                f"Climb {cleared_alt_ft:,} ft after {climb_start_fix}"
            )
        else:
            verb = "Descend to" if vertical.action_type == "DESCEND" else "Climb"
            summary = f"{verb} {cleared_alt_ft:,} ft immediate"
        if lateral_direct_to:
            summary += f", direct {lateral_direct_to}"
    elif lateral_direct_to:
        summary = f"Direct {lateral_direct_to}, no vertical change"
    elif route:
        summary = "Route " + " → ".join(route)
    else:
        summary = "Nothing programmed"

    return FMSProgram(
        callsign=intent.callsign,
        cleared_fl=cleared_fl,
        cleared_alt_ft=cleared_alt_ft,
        climb_start_fix=climb_start_fix,
        lateral_direct_to=lateral_direct_to,
        route=route,
        loaded=[_action_label(a) for a in loaded_actions],
        held=[_action_label(a) for a in held_actions],
        source=source,
        provenance=intent.provenance,
        summary=summary,
    )


def program_corrected(atc: Clearance) -> FMSProgram:
    """Simulated pilot correction: reprogram the FMS from the ATC clearance."""
    program = program_from_intent(atc, source="atc")
    program.source = "corrected"
    return program
