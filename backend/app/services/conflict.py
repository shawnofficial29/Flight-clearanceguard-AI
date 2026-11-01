"""Two-aircraft 4D trajectory conflict prediction (deterministic).

Demo geometry (nautical miles, flat plane — prototype simplification):
  META 452: starts (0, 0), flies east at 300 kt toward MERIT (20, 0), PONCT (60, 0).
  Intruder: starts (18, -18), flies north at 300 kt, level FL230.
  META 452 starts at FL150, climbs at 2000 fpm when cleared.

An immediate climb reaches FL230 near x=18 while the intruder crosses — a
predicted loss of separation. Waiting until after MERIT keeps META 452 at
FL150 through the crossing — no conflict.
"""

from __future__ import annotations

import math

from ..models import ConflictPrediction, FMSProgram, ProfilePoint

META_START = (0.0, 0.0)
META_SPEED_NM_PER_S = 300.0 / 3600.0
MERIT = (20.0, 0.0)
PONCT = (60.0, 0.0)

INTRUDER_START = (18.0, -18.0)
INTRUDER_VEL_NM_PER_S = (0.0, 300.0 / 3600.0)
INTRUDER_ALT_FT = 23000.0

META_INIT_ALT_FT = 15000.0
CLIMB_RATE_FT_PER_S = 2000.0 / 60.0

LATERAL_THRESHOLD_NM = 5.0
VERTICAL_THRESHOLD_FT = 1000.0
HORIZON_S = 12 * 60.0
STEP_S = 5.0
PROFILE_STEP_S = 15.0


def _merit_crossing_time_s() -> float:
    return (MERIT[0] - META_START[0]) / META_SPEED_NM_PER_S


def _meta_altitude_ft(t_s: float, climb_start_s: float, cleared_fl: int | None) -> float:
    target = float(cleared_fl * 100) if cleared_fl else META_INIT_ALT_FT
    if t_s <= climb_start_s:
        return META_INIT_ALT_FT
    climbed = META_INIT_ALT_FT + CLIMB_RATE_FT_PER_S * (t_s - climb_start_s)
    return min(climbed, target)


def predict(fms: FMSProgram) -> ConflictPrediction:
    constrained = fms.climb_start_fix is not None
    climb_start_s = _merit_crossing_time_s() if constrained else 0.0
    basis = (
        f"Constrained climb after {fms.climb_start_fix}; level FL150 until MERIT."
        if constrained
        else "Immediate climb from FL150 to commanded level (no start condition)."
    )

    first_t: float | None = None
    lat_at: float | None = None
    vert_at: float | None = None
    point: dict[str, float] | None = None
    closest_lat = math.inf
    min_vert = math.inf
    profile: list[ProfilePoint] = []

    t = 0.0
    while t <= HORIZON_S:
        mx = META_START[0] + META_SPEED_NM_PER_S * t
        ix = INTRUDER_START[0] + INTRUDER_VEL_NM_PER_S[0] * t
        iy = INTRUDER_START[1] + INTRUDER_VEL_NM_PER_S[1] * t
        malt = _meta_altitude_ft(t, climb_start_s, fms.cleared_fl)
        lateral = math.hypot(mx - ix, 0.0 - iy)
        vertical = abs(malt - INTRUDER_ALT_FT)
        closest_lat = min(closest_lat, lateral)
        min_vert = min(min_vert, vertical)
        if first_t is None and lateral < LATERAL_THRESHOLD_NM and vertical < VERTICAL_THRESHOLD_FT:
            first_t, lat_at, vert_at = t, lateral, vertical
            point = {"x_nm": round(mx, 2), "y_nm": 0.0}
        if abs(t / PROFILE_STEP_S - round(t / PROFILE_STEP_S)) < 1e-9:
            profile.append(
                ProfilePoint(
                    t_s=t, meta_x_nm=mx, meta_ft=malt,
                    intruder_x_nm=ix, intruder_y_nm=iy, intruder_ft=INTRUDER_ALT_FT,
                )
            )
        t += STEP_S

    return ConflictPrediction(
        conflict=first_t is not None,
        first_conflict_time_s=first_t,
        lateral_nm_at_conflict=round(lat_at, 2) if lat_at is not None else None,
        vertical_ft_at_conflict=round(vert_at, 1) if vert_at is not None else None,
        closest_lateral_nm=round(closest_lat, 2),
        min_vertical_ft=round(min_vert, 1),
        conflict_point_nm=point,
        lateral_threshold_nm=LATERAL_THRESHOLD_NM,
        vertical_threshold_ft=VERTICAL_THRESHOLD_FT,
        basis=basis,
        profile=profile,
    )
