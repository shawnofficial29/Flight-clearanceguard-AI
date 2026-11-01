"""Two-aircraft 4D trajectory conflict prediction (deterministic).

Default geometry (nautical miles, flat plane — prototype simplification):
  META 452: starts (0, 0), flies east at 300 kt toward MERIT (20, 0), PONCT (60, 0).
  Intruder: starts (18, -18), flies north at 300 kt, level FL230.
  META 452 starts at FL150, climbs at 2000 fpm when cleared.

An immediate climb reaches FL230 near x=18 while the intruder crosses — a
predicted loss of separation. Waiting until after MERIT keeps META 452 at
FL150 through the crossing — no conflict. Alternative scenario geometries
(parametric altitudes) reuse the same propagation.
"""

from __future__ import annotations

import math

from ..models import ConflictPrediction, FMSProgram, ProfilePoint, ScenarioGeometry

DEFAULT_GEOMETRY = ScenarioGeometry()
PROFILE_DIVISOR_S = 15.0


def _axis_time_to_x(geometry: ScenarioGeometry, x_nm: float) -> float:
    vx = geometry.own_speed_kt / 3600.0
    return (x_nm - geometry.own_start_nm[0]) / vx


def _altitude_ft(t_s: float, start_s: float, init_ft: float, target_ft: float, geo: ScenarioGeometry) -> float:
    if t_s <= start_s or target_ft == init_ft:
        return init_ft
    if target_ft > init_ft:
        return min(init_ft + (geo.climb_rate_fpm / 60.0) * (t_s - start_s), target_ft)
    return max(init_ft - (geo.descend_rate_fpm / 60.0) * (t_s - start_s), target_ft)


def predict(fms: FMSProgram, geometry: ScenarioGeometry | None = None) -> ConflictPrediction:
    geo = geometry or DEFAULT_GEOMETRY
    merit_x = geo.merit_nm[0]
    merit_t = _axis_time_to_x(geo, merit_x)
    constrained = fms.climb_start_fix is not None
    if constrained and fms.climb_start_fix != "MERIT":
        climb_start_s = 0.0
        gate_note = f"start fix {fms.climb_start_fix} outside prototype airspace; treated immediate."
    else:
        climb_start_s = merit_t if constrained else 0.0
        gate_note = f"level {geo.own_init_alt_ft:,.0f} ft until MERIT." if constrained else "immediate."

    target_ft = float(fms.cleared_alt_ft) if fms.cleared_alt_ft else geo.own_init_alt_ft
    basis = (
        f"Target {target_ft:,.0f} ft from {geo.own_init_alt_ft:,.0f} ft, "
        f"{gate_note} Lateral path east along the demo axis."
    )

    vx = geo.own_speed_kt / 3600.0
    ivx = geo.intruder_vel_kt[0] / 3600.0
    ivy = geo.intruder_vel_kt[1] / 3600.0

    first_t: float | None = None
    lat_at: float | None = None
    vert_at: float | None = None
    point: dict[str, float] | None = None
    closest_lat = math.inf
    min_vert = math.inf
    profile: list[ProfilePoint] = []

    t = 0.0
    while t <= geo.horizon_s:
        mx = geo.own_start_nm[0] + vx * t
        ix = geo.intruder_start_nm[0] + ivx * t
        iy = geo.intruder_start_nm[1] + ivy * t
        malt = _altitude_ft(t, climb_start_s, geo.own_init_alt_ft, target_ft, geo)
        lateral = math.hypot(mx - ix, geo.own_start_nm[1] - iy)
        vertical = abs(malt - geo.intruder_alt_ft)
        closest_lat = min(closest_lat, lateral)
        min_vert = min(min_vert, vertical)
        if first_t is None and lateral < geo.lateral_threshold_nm and vertical < geo.vertical_threshold_ft:
            first_t, lat_at, vert_at = t, lateral, vertical
            point = {"x_nm": round(mx, 2), "y_nm": round(geo.own_start_nm[1], 2)}
        if abs(t / PROFILE_DIVISOR_S - round(t / PROFILE_DIVISOR_S)) < 1e-9:
            profile.append(
                ProfilePoint(
                    t_s=t, meta_x_nm=mx, meta_ft=malt,
                    intruder_x_nm=ix, intruder_y_nm=iy, intruder_ft=geo.intruder_alt_ft,
                )
            )
        t += geo.step_s

    return ConflictPrediction(
        conflict=first_t is not None,
        first_conflict_time_s=first_t,
        lateral_nm_at_conflict=round(lat_at, 2) if lat_at is not None else None,
        vertical_ft_at_conflict=round(vert_at, 1) if vert_at is not None else None,
        closest_lateral_nm=round(closest_lat, 2),
        min_vertical_ft=round(min_vert, 1),
        conflict_point_nm=point,
        lateral_threshold_nm=geo.lateral_threshold_nm,
        vertical_threshold_ft=geo.vertical_threshold_ft,
        basis=basis,
        profile=profile,
    )
