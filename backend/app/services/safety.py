"""Deterministic counterfactual simulation: the ClearanceGuard Safety Window.

Asks "what if the crew corrects at time T?" for many T and finds the last
safe correction time. Pure trajectory math — no LLM is involved.
Correction maneuver: level off at the current altitude, hold to MERIT, then
climb/descend to the ATC-assigned level.
"""

from __future__ import annotations

import math

from ..models import (
    CausalStep,
    Clearance,
    Finding,
    FMSProgram,
    SafetyWindow,
    ScenarioGeometry,
    SeparationMinima,
)
from . import fms as fms_service

SCAN_STEP_S = 5.0
REFINE_STEP_S = 1.0
REFINE_RADIUS_S = 5.0


def _merit_time(geometry: ScenarioGeometry) -> float:
    vx = geometry.own_speed_kt / 3600.0
    return (geometry.merit_nm[0] - geometry.own_start_nm[0]) / vx


def _base_altitude(t_s: float, start_s: float, init_ft: float, target_ft: float, geo: ScenarioGeometry) -> float:
    if t_s <= start_s or target_ft == init_ft:
        return init_ft
    if target_ft > init_ft:
        return min(init_ft + (geo.climb_rate_fpm / 60.0) * (t_s - start_s), target_ft)
    return max(init_ft - (geo.descend_rate_fpm / 60.0) * (t_s - start_s), target_ft)


def _scan_profile(
    altitudes: list[float],
    geometry: ScenarioGeometry,
    step_s: float,
) -> tuple[bool, float | None, float | None, float | None, SeparationMinima]:
    geo = geometry
    vx = geo.own_speed_kt / 3600.0
    ivx = geo.intruder_vel_kt[0] / 3600.0
    ivy = geo.intruder_vel_kt[1] / 3600.0
    first_t: float | None = None
    lat_at_first: float | None = None
    vert_at_first: float | None = None
    min_lat = math.inf
    vert_at_min_lat = math.inf
    min_vert = math.inf
    lat_at_min_vert = math.inf
    for index, alt in enumerate(altitudes):
        t = index * step_s
        mx = geo.own_start_nm[0] + vx * t
        ix = geo.intruder_start_nm[0] + ivx * t
        iy = geo.intruder_start_nm[1] + ivy * t
        lateral = math.hypot(mx - ix, geo.own_start_nm[1] - iy)
        vertical = abs(alt - geo.intruder_alt_ft)
        if lateral < min_lat:
            min_lat, vert_at_min_lat = lateral, vertical
        if vertical < min_vert:
            min_vert, lat_at_min_vert = vertical, lateral
        if first_t is None and lateral < geo.lateral_threshold_nm and vertical < geo.vertical_threshold_ft:
            first_t, lat_at_first, vert_at_first = t, lateral, vertical
    minima = SeparationMinima(
        min_lateral_nm=round(min_lat, 2),
        vertical_at_min_lateral_ft=round(vert_at_min_lat, 1),
        min_vertical_ft=round(min_vert, 1),
        lateral_at_min_vertical_nm=round(lat_at_min_vert, 2),
    )
    return first_t is not None, first_t, lat_at_first, vert_at_first, minima


def _profile_for(
    kind: str,
    program: FMSProgram,
    geometry: ScenarioGeometry,
    step_s: float = SCAN_STEP_S,
) -> list[float]:
    geo = geometry
    merit_t = _merit_time(geo)
    target = float(program.cleared_alt_ft) if program.cleared_alt_ft else geo.own_init_alt_ft
    if kind == "corrected":
        start_s = merit_t if program.climb_start_fix else 0.0
    else:
        start_s = merit_t if program.climb_start_fix == "MERIT" else 0.0
    altitudes: list[float] = []
    t = 0.0
    while t <= geo.horizon_s:
        altitudes.append(_base_altitude(t, start_s, geo.own_init_alt_ft, target, geo))
        t += step_s
    return altitudes


def _splice_profile(
    uncorrected: list[float],
    tc: float,
    target: float,
    merit_t: float,
    geo: ScenarioGeometry,
    step_s: float,
) -> list[float]:
    """Level-off maneuver: uncorrected until tc, hold level to MERIT, then to target."""
    index_tc = min(int(round(tc / step_s)), len(uncorrected) - 1)
    level_alt = uncorrected[index_tc]
    profile: list[float] = []
    for index, alt in enumerate(uncorrected):
        t = index * step_s
        if t < tc:
            profile.append(alt)
        elif t < merit_t:
            profile.append(level_alt)
        else:
            profile.append(_base_altitude(t, merit_t, level_alt, target, geo))
    return profile


def _causal_chain(
    findings: list[Finding], program: FMSProgram, conflict_t: float | None,
    lateral: float | None, vertical: float | None,
) -> list[CausalStep]:
    if conflict_t is None:
        return [CausalStep(step=1, stage="PREDICTION", detail="No trajectory conflict predicted.")]
    first = findings[0].detail if findings else "clearance divergence"
    return [
        CausalStep(step=1, stage="MISMATCH", detail=f"Pilot readback diverges from ATC: {first}"),
        CausalStep(step=2, stage="FMS", detail=f"FMS programmed from readback: {program.summary}."),
        CausalStep(
            step=3, stage="TRAJECTORY",
            detail=f"Executed profile reaches conflict geometry at T+{conflict_t:,.0f}s.",
        ),
        CausalStep(
            step=4, stage="CONFLICT",
            detail=(
                f"Predicted loss of separation: lateral {lateral:.2f} NM, "
                f"vertical {vertical:,.0f} ft."
            ),
        ),
    ]


def calculate(
    atc: Clearance,
    fms_program: FMSProgram,
    findings: list[Finding],
    geometry: ScenarioGeometry,
    now_s: float = 0.0,
) -> SafetyWindow:
    corrected = fms_service.program_corrected(atc)
    target = float(corrected.cleared_alt_ft) if corrected.cleared_alt_ft else geometry.own_init_alt_ft
    merit_t = _merit_time(geometry)

    uncorrected_profile = _profile_for("uncorrected", fms_program, geometry)
    conflict, conflict_t, conflict_lat, conflict_vert, minima_none = _scan_profile(
        uncorrected_profile, geometry, SCAN_STEP_S
    )

    corrected_profile = _profile_for("corrected", corrected, geometry)
    _, _, _, _, minima_fixed = _scan_profile(corrected_profile, geometry, SCAN_STEP_S)

    if not conflict or conflict_t is None:
        return SafetyWindow(
            conflict_time_s=None,
            first_warning_time_s=0.0,
            last_safe_correction_s=None,
            seconds_remaining_s=None,
            position_at_last_safe=None,
            min_sep_no_correction=minima_none,
            min_sep_after_correction=minima_fixed,
            causal_chain=_causal_chain(findings, fms_program, None, None, None),
            basis="No conflict predicted; correction window is open over the horizon.",
        )

    vx = geometry.own_speed_kt / 3600.0
    last_safe = 0.0
    tc = 0.0
    while tc <= conflict_t:
        trial = _splice_profile(uncorrected_profile, tc, target, merit_t, geometry, SCAN_STEP_S)
        trial_conflict, _, _, _, _ = _scan_profile(trial, geometry, SCAN_STEP_S)
        if not trial_conflict:
            last_safe = tc
        tc += SCAN_STEP_S
    fine_start = max(0.0, last_safe - REFINE_RADIUS_S)
    fine_end = min(conflict_t, last_safe + REFINE_RADIUS_S)
    tc = fine_start
    while tc <= fine_end:
        trial = _splice_profile(uncorrected_profile, tc, target, merit_t, geometry, SCAN_STEP_S)
        trial_conflict, _, _, _, _ = _scan_profile(trial, geometry, SCAN_STEP_S)
        if not trial_conflict:
            last_safe = tc
        tc += REFINE_STEP_S
    last_safe = round(last_safe, 1)

    level_index = min(int(round(last_safe / SCAN_STEP_S)), len(uncorrected_profile) - 1)
    grid_t = level_index * SCAN_STEP_S
    position = {
        "x_nm": round(geometry.own_start_nm[0] + vx * grid_t, 2),
        "alt_ft": round(uncorrected_profile[level_index], 1),
    }
    return SafetyWindow(
        conflict_time_s=conflict_t,
        first_warning_time_s=0.0,
        last_safe_correction_s=last_safe,
        seconds_remaining_s=round(max(0.0, last_safe - now_s), 1),
        position_at_last_safe=position,
        min_sep_no_correction=minima_none,
        min_sep_after_correction=minima_fixed,
        causal_chain=_causal_chain(findings, fms_program, conflict_t, conflict_lat, conflict_vert),
        basis=(
            f"Counterfactual scan over correction times 0–{conflict_t:,.0f}s "
            f"(5s coarse, 1s refine). Level-off maneuver, deterministic."
        ),
    )


def profile_minima(program: FMSProgram, geometry: ScenarioGeometry) -> SeparationMinima:
    """Jointly-meaningful minima for a programmed profile (corrected semantics)."""
    profile = _profile_for("corrected", program, geometry)
    _, _, _, _, minima = _scan_profile(profile, geometry, SCAN_STEP_S)
    return minima


def simulate_correction_at(
    fms_program: FMSProgram,
    atc: Clearance,
    geometry: ScenarioGeometry,
    tc: float,
) -> tuple[bool, SeparationMinima]:
    """Re-run the level-off correction applied at tc. Returns (conflict, minima)."""
    corrected = fms_service.program_corrected(atc)
    target = float(corrected.cleared_alt_ft) if corrected.cleared_alt_ft else geometry.own_init_alt_ft
    uncorrected_profile = _profile_for("uncorrected", fms_program, geometry)
    trial = _splice_profile(uncorrected_profile, tc, target, _merit_time(geometry), geometry, SCAN_STEP_S)
    conflict, _, _, _, minima = _scan_profile(trial, geometry, SCAN_STEP_S)
    return conflict, minima
