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
from .conflict import (
    SpeedSchedule,
    landing_schedule,
    position_x_nm,
    profile_altitude_ft,
    speed_schedule,
)

SCAN_STEP_S = 5.0
REFINE_STEP_S = 1.0
REFINE_RADIUS_S = 5.0

# A sampled track: (altitude_ft, along-track x NM) per grid point.
Track = list[tuple[float, float]]


def _base_altitude(t_s: float, start_s: float, init_ft: float, target_ft: float, geo: ScenarioGeometry) -> float:
    if t_s <= start_s or target_ft == init_ft:
        return init_ft
    if target_ft > init_ft:
        return min(init_ft + (geo.climb_rate_fpm / 60.0) * (t_s - start_s), target_ft)
    return max(init_ft - (geo.descend_rate_fpm / 60.0) * (t_s - start_s), target_ft)


def _scan_profile(
    track: Track,
    geometry: ScenarioGeometry,
    step_s: float,
) -> tuple[bool, float | None, float | None, float | None, SeparationMinima]:
    geo = geometry
    ivx = geo.intruder_vel_kt[0] / 3600.0
    ivy = geo.intruder_vel_kt[1] / 3600.0
    first_t: float | None = None
    lat_at_first: float | None = None
    vert_at_first: float | None = None
    min_lat = math.inf
    vert_at_min_lat = math.inf
    min_vert = math.inf
    lat_at_min_vert = math.inf
    for index, (alt, mx) in enumerate(track):
        t = index * step_s
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
) -> Track:
    geo = geometry
    target = float(program.cleared_alt_ft) if program.cleared_alt_ft else geo.own_init_alt_ft
    sched = landing_schedule(speed_schedule(program, geo), geo)
    merit_t = sched.merit_t_s
    if kind == "corrected":
        start_s = merit_t if program.climb_start_fix else 0.0
    else:
        start_s = merit_t if program.climb_start_fix == "MERIT" else 0.0
    track: Track = []
    t = 0.0
    while t <= geo.horizon_s:
        track.append(
            (
                profile_altitude_ft(
                    t, merit_t, start_s, geo.own_init_alt_ft, target, geo
                ),
                position_x_nm(t, sched, geo),
            )
        )
        t += step_s
    return track


def _interp_at(track: Track, tc: float, step_s: float) -> tuple[float, float]:
    """Linear (alt, x) interpolation at tc; exact for piecewise-linear tracks."""
    if tc <= 0:
        return track[0]
    pos = tc / step_s
    lo = min(int(math.floor(pos)), len(track) - 1)
    hi = min(lo + 1, len(track) - 1)
    frac = min(max(pos - lo, 0.0), 1.0)
    (a0, x0), (a1, x1) = track[lo], track[hi]
    return (a0 + (a1 - a0) * frac, x0 + (x1 - x0) * frac)


def _splice_track(
    uncorrected: Track,
    tc: float,
    target: float,
    sched_corr: SpeedSchedule,
    geo: ScenarioGeometry,
    step_s: float,
) -> Track:
    """Level-off maneuver on the lagged position: FMS track until tc, then
    the corrected schedule continued from there while holding level to the
    trial's own MERIT crossing, then descending to target."""
    level_alt, x_tc = _interp_at(uncorrected, tc, step_s)
    base_tc = position_x_nm(tc, sched_corr, geo)

    def x_at(t: float) -> float:
        return x_tc + (position_x_nm(t, sched_corr, geo) - base_tc)

    merit_x = geo.merit_nm[0]
    if x_tc >= merit_x:
        t_cross = tc
    elif x_at(geo.horizon_s) < merit_x:
        t_cross = math.inf
    else:
        lo, hi = tc, geo.horizon_s
        for _ in range(60):
            mid = (lo + hi) / 2.0
            if x_at(mid) < merit_x:
                lo = mid
            else:
                hi = mid
        t_cross = (lo + hi) / 2.0
    track: Track = []
    for index, (alt, fx) in enumerate(uncorrected):
        t = index * step_s
        if t < tc:
            track.append((alt, fx))
        elif t <= t_cross:
            track.append((level_alt, x_at(t)))
        else:
            track.append((_base_altitude(t, t_cross, level_alt, target, geo), x_at(t)))
    return track


def _causal_chain(
    findings: list[Finding], program: FMSProgram, conflict_t: float | None,
    lateral: float | None, vertical: float | None,
) -> list[CausalStep]:
    if conflict_t is None:
        return [CausalStep(step=1, stage="PREDICTION", detail="No trajectory conflict predicted.")]
    first = findings[0] if findings else None
    if first is not None and first.scope == "pilot_vs_fms":
        mismatch = f"FMS entry diverges from readback: {first.detail}"
    else:
        mismatch = f"Pilot readback diverges from ATC: {first.detail if first else 'clearance divergence'}"
    return [
        CausalStep(step=1, stage="MISMATCH", detail=mismatch),
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
    sched_corr = speed_schedule(corrected, geometry)

    uncorrected_track = _profile_for("uncorrected", fms_program, geometry)
    conflict, conflict_t, conflict_lat, conflict_vert, minima_none = _scan_profile(
        uncorrected_track, geometry, SCAN_STEP_S
    )

    corrected_track = _profile_for("corrected", corrected, geometry)
    _, _, _, _, minima_fixed = _scan_profile(corrected_track, geometry, SCAN_STEP_S)

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

    last_safe = 0.0
    tc = 0.0
    while tc <= conflict_t:
        trial = _splice_track(uncorrected_track, tc, target, sched_corr, geometry, SCAN_STEP_S)
        trial_conflict, _, _, _, _ = _scan_profile(trial, geometry, SCAN_STEP_S)
        if not trial_conflict:
            last_safe = tc
        tc += SCAN_STEP_S
    fine_start = max(0.0, last_safe - REFINE_RADIUS_S)
    fine_end = min(conflict_t, last_safe + REFINE_RADIUS_S)
    tc = fine_start
    while tc <= fine_end:
        trial = _splice_track(uncorrected_track, tc, target, sched_corr, geometry, SCAN_STEP_S)
        trial_conflict, _, _, _, _ = _scan_profile(trial, geometry, SCAN_STEP_S)
        if not trial_conflict:
            last_safe = tc
        tc += REFINE_STEP_S
    last_safe = round(last_safe, 1)

    level_index = min(int(round(last_safe / SCAN_STEP_S)), len(uncorrected_track) - 1)
    level_alt, level_x = uncorrected_track[level_index]
    position = {
        "x_nm": round(level_x, 2),
        "alt_ft": round(level_alt, 1),
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
    sched_corr = speed_schedule(corrected, geometry)
    uncorrected_track = _profile_for("uncorrected", fms_program, geometry)
    trial = _splice_track(uncorrected_track, tc, target, sched_corr, geometry, SCAN_STEP_S)
    conflict, _, _, _, minima = _scan_profile(trial, geometry, SCAN_STEP_S)
    return conflict, minima
