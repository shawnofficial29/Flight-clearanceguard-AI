"""Deterministic clearance comparison → Clearance Integrity Matrix."""

from __future__ import annotations

from ..fixtures import MISSING_PHRASE
from ..models import ComparisonMatrix, FMSProgram, MatrixRow, StructuredIntent

DASH = "—"


def _fl(value: int | None) -> str:
    return f"FL{value}" if value is not None else DASH


def _same(left: str | None, right: str | None) -> bool:
    return (left or "").strip().upper() == (right or "").strip().upper()


def build_matrix(atc: StructuredIntent, pilot: StructuredIntent, fms: FMSProgram) -> ComparisonMatrix:
    predicted_callsign = fms.callsign or DASH
    callsign_ok = _same(atc.callsign, pilot.callsign) and _same(atc.callsign, fms.callsign)

    target_ok = atc.climb_to_fl is not None and (
        atc.climb_to_fl == pilot.climb_to_fl == fms.cleared_fl
    )
    predicted_level = _fl(fms.cleared_fl) + (" (FMS commanded)" if fms.cleared_fl else "")

    atc_cond = (
        f"After passing {atc.climb_condition_fix}"
        if atc.climb_condition_fix
        else ("After-passing condition" if atc.climb_condition_type else DASH)
    )
    pilot_cond = (
        f"After passing {pilot.climb_condition_fix}"
        if pilot.climb_condition_fix
        else "Not stated"
    )
    fms_cond = f"Climb after {fms.climb_start_fix}" if fms.climb_start_fix else "Immediate climb"
    predicted_cond = (
        f"Level to {fms.climb_start_fix}, then climb"
        if fms.climb_start_fix
        else "Early climb to " + _fl(fms.cleared_fl)
    )
    cond_ok = (
        _same(atc.climb_condition_fix, pilot.climb_condition_fix)
        and _same(atc.climb_condition_fix, fms.climb_start_fix)
        and atc.climb_condition_type == pilot.climb_condition_type
    ) or (
        atc.climb_condition_fix is None
        and pilot.climb_condition_fix is None
        and fms.climb_start_fix is None
    )

    lateral_ok = (
        _same(atc.direct_to, pilot.direct_to)
        and _same(atc.direct_to, fms.lateral_direct_to)
        and atc.direct_to is not None
    )
    predicted_route = " → ".join(fms.route) if fms.route else DASH

    rows = [
        MatrixRow(
            aspect="Callsign",
            atc=atc.callsign or DASH,
            pilot=pilot.callsign or DASH,
            fms=fms.callsign or DASH,
            predicted=predicted_callsign,
            status="match" if callsign_ok else "mismatch",
            note="All sources agree." if callsign_ok else "Callsign differs between sources.",
        ),
        MatrixRow(
            aspect="Target level",
            atc=_fl(atc.climb_to_fl),
            pilot=_fl(pilot.climb_to_fl),
            fms=_fl(fms.cleared_fl),
            predicted=predicted_level,
            status="match" if target_ok else "mismatch",
            note="Cleared level consistent." if target_ok else "Target level differs.",
        ),
        MatrixRow(
            aspect="Climb condition",
            atc=atc_cond,
            pilot=pilot_cond,
            fms=fms_cond,
            predicted=predicted_cond,
            status="match" if cond_ok else "mismatch",
            note=(
                "Constraint preserved end to end."
                if cond_ok
                else f"Missing condition: '{MISSING_PHRASE}' omitted downstream."
            ),
        ),
        MatrixRow(
            aspect="Lateral path",
            atc=f"Direct {atc.direct_to}" if atc.direct_to else DASH,
            pilot=f"Direct {pilot.direct_to}" if pilot.direct_to else DASH,
            fms=f"Direct {fms.lateral_direct_to}" if fms.lateral_direct_to else DASH,
            predicted=predicted_route,
            status="match" if lateral_ok else "mismatch",
            note="Same direct-to fix." if lateral_ok else "Lateral path differs.",
        ),
    ]
    missing = not cond_ok and atc.climb_condition_fix is not None
    return ComparisonMatrix(
        rows=rows,
        overall="agree" if all(r.status == "match" for r in rows) else "mismatch",
        missing_condition=missing,
        missing_phrase=MISSING_PHRASE if missing else None,
    )
