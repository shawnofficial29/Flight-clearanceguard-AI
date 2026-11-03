"""Two-aircraft 4D trajectory conflict prediction (deterministic).

Arrival geometry (nautical miles, flat plane — prototype simplification):
  META 452: starts (0, 0) at FL230, flies east toward MERIT (20, 0), PONCT (60, 0),
    slowing from 290 kt to 250 kt at 1 kt/s from the start of the scenario.
  Intruder: starts (18, -11.11), flies north at a constant 250 kt, level 15,000 ft,
    crossing MERIT's latitude at t=160 s, well before META 452 arrives.
  META 452 descends at 2100 fpm when cleared to 15,000 ft.

An immediate descent reaches 15,000 ft before MERIT while the intruder is
nearby — a predicted loss of separation. Waiting until after MERIT keeps
META 452 at FL230 through the encounter — no conflict, 8,000 ft above the
intruder, which is already well clear. Alternative scenario geometries
(parametric altitudes) reuse the same propagation.

min_vertical_ft is the vertical separation at the closest lateral approach,
never a whole-horizon minimum: a level-off far past the crossing must not
read as zero separation next to a cleared conflict.
"""

from __future__ import annotations

import math
from typing import NamedTuple

from ..models import ConflictPrediction, FMSProgram, ProfilePoint, ScenarioGeometry

DEFAULT_GEOMETRY = ScenarioGeometry()
PROFILE_DIVISOR_S = 15.0
_KTS_TO_NM_S = 1.0 / 3600.0


class SpeedSchedule(NamedTuple):
    """Ownship speed program: cruise slewing toward the target."""

    cruise_nm_s: float
    target_nm_s: float | None
    change_start_s: float
    merit_t_s: float
    target_kts: float | None
    immediate: bool
    decel_kt_s: float


# Gradual slowdown rate toward a speed target (kt per second).
DECEL_KT_S = 1.0


def _cruise_merit_time(cruise_nm_s: float, geometry: ScenarioGeometry) -> float:
    if cruise_nm_s <= 0:
        return math.inf
    return (geometry.merit_nm[0] - geometry.own_start_nm[0]) / cruise_nm_s


def _slew_duration_s(cruise_kt: float, target_kt: float, decel_kt_s: float = DECEL_KT_S) -> float:
    return abs(target_kt - cruise_kt) / decel_kt_s


def _position_with_slew(
    t_s: float,
    cruise_nm_s: float,
    target_nm_s: float,
    change_start_s: float,
    slew_dur_s: float,
    x0: float,
    decel_kt_s: float = DECEL_KT_S,
) -> float:
    if t_s <= change_start_s or slew_dur_s <= 0:
        return x0 + cruise_nm_s * t_s
    dirn = 1.0 if target_nm_s >= cruise_nm_s else -1.0
    dt = min(t_s - change_start_s, slew_dur_s)
    x = x0 + cruise_nm_s * change_start_s
    x += cruise_nm_s * dt + dirn * (decel_kt_s * _KTS_TO_NM_S) * dt * dt / 2.0
    if t_s > change_start_s + slew_dur_s:
        x += target_nm_s * (t_s - change_start_s - slew_dur_s)
    return x


def _solve_merit_time(
    cruise_nm_s: float,
    target_nm_s: float | None,
    change_start_s: float,
    slew_dur_s: float,
    geometry: ScenarioGeometry,
    decel_kt_s: float = DECEL_KT_S,
) -> float:
    """MERIT crossing under the schedule; bisection on monotone position."""
    x0 = geometry.own_start_nm[0]
    merit_x = geometry.merit_nm[0]
    if merit_x <= x0:
        return 0.0
    if cruise_nm_s <= 0 and (target_nm_s is None or target_nm_s <= 0):
        return math.inf

    def pos(t: float) -> float:
        if target_nm_s is None:
            return x0 + cruise_nm_s * t
        return _position_with_slew(
            t, cruise_nm_s, target_nm_s, change_start_s, slew_dur_s, x0, decel_kt_s
        )

    hi = max(change_start_s + slew_dur_s, 1.0)
    while pos(hi) < merit_x:
        hi *= 2.0
        if hi > 1e7:
            return math.inf
    lo = 0.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if pos(mid) < merit_x:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _schedule_for(
    cruise_kt: float,
    target_kt: float | None,
    constrained: bool,
    geometry: ScenarioGeometry,
    decel_kt_s: float = DECEL_KT_S,
) -> SpeedSchedule:
    cruise_nm_s = cruise_kt * _KTS_TO_NM_S
    if target_kt is None:
        return SpeedSchedule(
            cruise_nm_s, None, 0.0, _cruise_merit_time(cruise_nm_s, geometry), None, True,
            decel_kt_s,
        )
    change_start = _cruise_merit_time(cruise_nm_s, geometry) if constrained else 0.0
    slew_dur = _slew_duration_s(cruise_kt, target_kt, decel_kt_s)
    merit_t = _solve_merit_time(
        cruise_nm_s, target_kt * _KTS_TO_NM_S, change_start, slew_dur, geometry, decel_kt_s
    )
    return SpeedSchedule(
        cruise_nm_s, target_kt * _KTS_TO_NM_S, change_start, merit_t, target_kt,
        not constrained, decel_kt_s,
    )


def speed_schedule(program: FMSProgram, geometry: ScenarioGeometry) -> SpeedSchedule:
    """Speed program from the programmed target and its gate.

    No SPEED entry: constant cruise (scenarios without a speed clearance
    behave exactly as before). Immediate target: slew from t=0 at 1 kt/s.
    Constrained target: cruise holds to MERIT, then the target slews in.
    """
    cruise_kt = geometry.own_speed_kt
    target = float(program.target_speed_kts) if program.target_speed_kts else None
    if target is None:
        return _schedule_for(cruise_kt, None, False, geometry)
    speed_action = next(
        (a for a in program.loaded_actions if a.action_type == "SPEED"), None
    )
    constrained = (
        speed_action is not None
        and speed_action.trigger_type == "AFTER_WAYPOINT"
        and speed_action.trigger_value == "MERIT"
    )
    return _schedule_for(cruise_kt, target, constrained, geometry)


def position_x_nm(t_s: float, sched: SpeedSchedule, geometry: ScenarioGeometry) -> float:
    """Ownship along-track position under the gradual speed schedule."""
    if sched.target_nm_s is None or sched.target_kts is None:
        return geometry.own_start_nm[0] + sched.cruise_nm_s * t_s
    cruise_kt = sched.cruise_nm_s / _KTS_TO_NM_S
    return _position_with_slew(
        t_s,
        sched.cruise_nm_s,
        sched.target_nm_s,
        sched.change_start_s,
        _slew_duration_s(cruise_kt, sched.target_kts, sched.decel_kt_s),
        geometry.own_start_nm[0],
        sched.decel_kt_s,
    )


def speed_kt_at(t_s: float, sched: SpeedSchedule, geometry: ScenarioGeometry) -> float:
    """Programmed ownship speed at time t (kt)."""
    if sched.target_kts is None:
        return geometry.own_speed_kt
    cruise_kt = sched.cruise_nm_s / _KTS_TO_NM_S
    slew_dur = _slew_duration_s(cruise_kt, sched.target_kts, sched.decel_kt_s)
    if t_s <= sched.change_start_s or slew_dur <= 0:
        return cruise_kt
    if t_s >= sched.change_start_s + slew_dur:
        return sched.target_kts
    grown = sched.target_kts > cruise_kt
    slewed = cruise_kt + (1.0 if grown else -1.0) * sched.decel_kt_s * (t_s - sched.change_start_s)
    return min(slewed, sched.target_kts) if grown else max(slewed, sched.target_kts)


def _altitude_ft(t_s: float, start_s: float, init_ft: float, target_ft: float, geo: ScenarioGeometry) -> float:
    if t_s <= start_s or target_ft == init_ft:
        return init_ft
    if target_ft > init_ft:
        return min(init_ft + (geo.climb_rate_fpm / 60.0) * (t_s - start_s), target_ft)
    return max(init_ft - (geo.descend_rate_fpm / 60.0) * (t_s - start_s), target_ft)


def landing_schedule(sched: SpeedSchedule, geometry: ScenarioGeometry) -> SpeedSchedule:
    """Gentle arrival slowdown after MERIT for geometries with a landing tail.

    Only applies without a programmed speed change. The slowdown starts at
    the MERIT crossing, so the crossing time itself is unchanged, and eases
    down at the landing rate so it lasts alongside the descent.
    """
    geo = geometry
    if geo.landing_speed_kt is None or sched.target_kts is not None:
        return sched
    cruise_kt = sched.cruise_nm_s / _KTS_TO_NM_S
    return _schedule_for(cruise_kt, geo.landing_speed_kt, True, geo, geo.landing_decel_kt_s)


def profile_altitude_ft(
    t_s: float,
    merit_t: float,
    change_start_s: float,
    init_ft: float,
    target_ft: float,
    geo: ScenarioGeometry,
) -> float:
    """Cleared level with the landing descent applied after MERIT.

    The level holds until MERIT: descending any earlier would drop through
    the intruder's level while still within 5 NM laterally and re-enter
    conflict. Past MERIT the aircraft descends to the landing altitude.
    """
    base = _altitude_ft(t_s, change_start_s, init_ft, target_ft, geo)
    if geo.landing_alt_ft is None:
        return base
    if not math.isfinite(merit_t) or t_s <= merit_t:
        return base
    base_at_landing = _altitude_ft(merit_t, change_start_s, init_ft, target_ft, geo)
    if base_at_landing <= geo.landing_alt_ft:
        return base
    return max(
        geo.landing_alt_ft,
        base_at_landing - (geo.descend_rate_fpm / 60.0) * (t_s - merit_t),
    )


def predict(fms: FMSProgram, geometry: ScenarioGeometry | None = None) -> ConflictPrediction:
    geo = geometry or DEFAULT_GEOMETRY
    target_ft = float(fms.cleared_alt_ft) if fms.cleared_alt_ft else geo.own_init_alt_ft
    sched = landing_schedule(speed_schedule(fms, geo), geo)
    merit_t = sched.merit_t_s
    constrained = fms.climb_start_fix is not None
    if constrained and fms.climb_start_fix != "MERIT":
        change_start_s = 0.0
        gate_note = f"start fix {fms.climb_start_fix} outside prototype airspace; treated immediate."
    else:
        change_start_s = merit_t if constrained else 0.0
        gate_note = f"level {geo.own_init_alt_ft:,.0f} ft until MERIT." if constrained else "immediate."
    if sched.target_kts is None:
        speed_note = f"constant {geo.own_speed_kt:.0f} kt."
    elif sched.immediate:
        speed_note = (
            f"{geo.own_speed_kt:.0f} kt slowing to {sched.target_kts:.0f} kt from the start."
        )
    else:
        speed_note = (
            f"{geo.own_speed_kt:.0f} kt to MERIT, then slowing to {sched.target_kts:.0f} kt."
        )

    basis = (
        f"Target {target_ft:,.0f} ft from {geo.own_init_alt_ft:,.0f} ft, "
        f"{gate_note} Speed {speed_note} Lateral path east along the demo axis."
    )

    ivx = geo.intruder_vel_kt[0] / 3600.0
    ivy = geo.intruder_vel_kt[1] / 3600.0
    intruder_kt = math.hypot(geo.intruder_vel_kt[0], geo.intruder_vel_kt[1])

    first_t: float | None = None
    lat_at: float | None = None
    vert_at: float | None = None
    point: dict[str, float] | None = None
    closest_lat = math.inf
    vert_at_closest = math.inf
    profile: list[ProfilePoint] = []

    t = 0.0
    while t <= geo.horizon_s:
        mx = position_x_nm(t, sched, geo)
        ix = geo.intruder_start_nm[0] + ivx * t
        iy = geo.intruder_start_nm[1] + ivy * t
        malt = profile_altitude_ft(
            t, merit_t, change_start_s, geo.own_init_alt_ft, target_ft, geo
        )
        lateral = math.hypot(mx - ix, geo.own_start_nm[1] - iy)
        vertical = abs(malt - geo.intruder_alt_ft)
        if lateral < closest_lat:
            closest_lat, vert_at_closest = lateral, vertical
        if first_t is None and lateral < geo.lateral_threshold_nm and vertical < geo.vertical_threshold_ft:
            first_t, lat_at, vert_at = t, lateral, vertical
            point = {"x_nm": round(mx, 2), "y_nm": round(geo.own_start_nm[1], 2)}
        if abs(t / PROFILE_DIVISOR_S - round(t / PROFILE_DIVISOR_S)) < 1e-9:
            profile.append(
                ProfilePoint(
                    t_s=t, meta_x_nm=mx, meta_ft=malt, meta_kt=speed_kt_at(t, sched, geo),
                    intruder_x_nm=ix, intruder_y_nm=iy, intruder_ft=geo.intruder_alt_ft,
                    intruder_kt=intruder_kt,
                )
            )
        t += geo.step_s

    merit_reached = math.isfinite(merit_t) and position_x_nm(geo.horizon_s, sched, geo) >= geo.merit_nm[0]
    merit_time = round(merit_t, 2) if merit_reached else None
    plan_sched = _schedule_for(geo.own_speed_kt, sched.target_kts, False, geo)
    plan_merit_t = plan_sched.merit_t_s
    plan_merit_time = round(plan_merit_t, 2) if math.isfinite(plan_merit_t) else None
    intruder_merit_time: float | None = None
    if ivy != 0:
        t_cross = (geo.merit_nm[1] - geo.intruder_start_nm[1]) / ivy
        if t_cross >= 0:
            intruder_merit_time = round(t_cross, 2)
    if merit_reached:
        own_at_merit = profile_altitude_ft(
            merit_t, merit_t, change_start_s, geo.own_init_alt_ft, target_ft, geo
        )
        merit_gap = round(abs(own_at_merit - geo.intruder_alt_ft), 1)
    else:
        merit_gap = None

    return ConflictPrediction(
        conflict=first_t is not None,
        first_conflict_time_s=first_t,
        lateral_nm_at_conflict=round(lat_at, 2) if lat_at is not None else None,
        vertical_ft_at_conflict=round(vert_at, 1) if vert_at is not None else None,
        closest_lateral_nm=round(closest_lat, 2),
        min_vertical_ft=round(vert_at_closest, 1),
        merit_time_s=merit_time,
        merit_vertical_gap_ft=merit_gap,
        plan_merit_time_s=plan_merit_time,
        intruder_merit_time_s=intruder_merit_time,
        conflict_point_nm=point,
        lateral_threshold_nm=geo.lateral_threshold_nm,
        vertical_threshold_ft=geo.vertical_threshold_ft,
        basis=basis,
        profile=profile,
    )
