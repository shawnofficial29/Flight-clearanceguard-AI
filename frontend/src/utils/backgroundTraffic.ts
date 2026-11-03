import { trackAngleDeg } from './playbackMath';

/**
 * Deterministic background air traffic for the Route View map.
 *
 * Visual context only: positions are a pure function of playback time, so
 * pause freezes the sky, the slider scrubs it, and reset restarts it. A
 * fixed seed makes every demo run identical. Nothing here feeds the
 * scenario, the charts, or any computed value.
 *
 * META 452's route runs along y=0 (x 0..60 NM). Background routes stay
 * inside terminal-area bands with |y| >= 12 NM, so they keep at least 10 NM
 * sideways clearance and can never cross the route.
 *
 * Three slots are sequenced SFO airport traffic instead: two arrivals on a
 * shared west-final stream into runway 28L and one climbing westbound
 * departure. They fly fixed geometry with fixed phase offsets chosen
 * offline so that, over the whole playback, each stays clear of both live
 * scenario aircraft (verified by test, never eyeballed).
 */

export const BG_TRAFFIC_COUNT = 10;
export const BG_SEED = 452;
/** Required sideways clearance from META 452's route (NM). */
export const BG_ROUTE_CLEARANCE_NM = 10;
/** Minimum pairwise spacing between background aircraft (NM). */
export const BG_MIN_SEP_NM = 3;
/** Slots flying the fixed SFO airport stream (exempt from the band rule). */
export const SFO_AIRPORT_SLOTS: readonly number[] = [6, 7, 8];
/** Required live clearance from airport slots to scenario aircraft (NM). */
export const AIRPORT_LIVE_CLEARANCE_NM = 8;

export type BgKind = 'arrival' | 'departure' | 'cruise';

export interface BgAircraft {
  slot: number;
  /** Route generation: each slot flies a fresh route per cycle. */
  cycle: number;
  callsign: string;
  kind: BgKind;
  xNm: number;
  yNm: number;
  altFt: number;
  /** Instantaneous ground speed (kt) from the slot's speed profile. */
  speedKt: number;
  /** Screen rotation for the glyph (trackAngleDeg convention). */
  headingDeg: number;
}

interface Band {
  yMin: number;
  yMax: number;
}

const X_MIN = -25;
const X_MAX = 85;
const NORTH: Band = { yMin: 12, yMax: 38 };
const SOUTH: Band = { yMin: -20, yMax: -12 };
/** Spacing-clamp corridors containing the fixed airport geometry. */
const SFO_ARRIVAL_BAND: Band = { yMin: -9, yMax: -1 };
const SFO_DEPARTURE_BAND: Band = { yMin: 2, yMax: 23 };

interface RoutePoint {
  x: number;
  y: number;
}

/**
 * Fixed SFO stream geometry (NM, scenario frame: PONCT/SFO at x=60, y=0).
 * Arrivals join a west final and vanish onto runway 28L; the departure
 * rotates off 28L climbing to the northwest. Touchdown/rotation points sit
 * just off the strip so the stream visibly connects to the runway.
 */
const SFO_ARRIVAL_P0: RoutePoint = { x: -25, y: -8 };
const SFO_ARRIVAL_PC: RoutePoint = { x: 16, y: -6.5 };
const SFO_ARRIVAL_P1: RoutePoint = { x: 58, y: -1.5 };
const SFO_DEPARTURE_P0: RoutePoint = { x: 56, y: 2.5 };
const SFO_DEPARTURE_PC: RoutePoint = { x: 30, y: 10 };
const SFO_DEPARTURE_P1: RoutePoint = { x: -25, y: 22 };

/**
 * Sequenced phase offsets (s) from the offline search: over t in [0,720]
 * each airport slot holds >= 9 NM from META 452 live and >= 7 NM from the
 * intruder live, with >= 3.5 NM mutual spacing. Slot 7 trails slot 6 by
 * half a period for an in-trail arrival stream.
 */
const SFO_ARRIVAL_OFFSET_S = 980;
const SFO_DEPARTURE_OFFSET_S = 150;

/**
 * Gate stands (NM): parked aircraft beside the runway, clear of the live
 * track, the touchdown/rotation points, and each other (pinned by test).
 */
const SFO_GATES: RoutePoint[] = [
  { x: 59.5, y: 3.2 },
  { x: 63, y: 3.2 },
  { x: 61, y: -3.5 },
];

/** Parked gate traffic: static, always rendered, never in the moving sky. */
export const PARKED_AIRCRAFT: BgAircraft[] = SFO_GATES.map((gate, index) => ({
  slot: BG_TRAFFIC_COUNT + index,
  cycle: 0,
  callsign: `SIM 3${index + 1}0`,
  kind: 'cruise',
  xNm: gate.x,
  yNm: gate.y,
  altFt: 100,
  speedKt: 0,
  headingDeg: index === 2 ? 180 : 0,
}));
const MIN_LEG_NM = 50;
const MAX_CURVE_NM = 6;

function hash32(values: number[]): number {
  let h = 0x9e3779b9;
  for (const n of values) {
    h = Math.imul(h ^ (n | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AirportRole = 'sfoArrival' | 'sfoDeparture' | null;

interface SlotSetup {
  offsetS: number;
  band: Band;
  kind: BgKind;
  airport: AirportRole;
}

/** Mean leg speed per kind (kt); arrivals decelerate around the mean. */
const KIND_SPEED_KT: Record<BgKind, number> = {
  arrival: 190,
  departure: 250,
  cruise: 350,
};

const SLOT_KINDS: BgKind[] = [
  'arrival',
  'departure',
  'arrival',
  'cruise',
  'arrival',
  'departure',
  'arrival',
  'cruise',
  'departure',
  'arrival',
];

function slotSetup(slot: number): SlotSetup {
  const rng = mulberry32(hash32([BG_SEED, slot]));
  if (slot === 6 || slot === 7) {
    const period =
      (routeLengthNm({
        p0: SFO_ARRIVAL_P0,
        pc: SFO_ARRIVAL_PC,
        p1: SFO_ARRIVAL_P1,
      }) /
        KIND_SPEED_KT.arrival) *
      3600;
    const stagger = slot === 7 ? period / 2 : 0;
    return {
      offsetS: (SFO_ARRIVAL_OFFSET_S + stagger) % period,
      band: SFO_ARRIVAL_BAND,
      kind: 'arrival',
      airport: 'sfoArrival',
    };
  }
  if (slot === 8) {
    return {
      offsetS: SFO_DEPARTURE_OFFSET_S,
      band: SFO_DEPARTURE_BAND,
      kind: 'departure',
      airport: 'sfoDeparture',
    };
  }
  return {
    offsetS: rng() * 1200,
    band: slot % BG_TRAFFIC_COUNT < 6 ? NORTH : SOUTH,
    kind: SLOT_KINDS[slot % SLOT_KINDS.length],
    airport: null,
  };
}

const SLOTS: SlotSetup[] = Array.from({ length: BG_TRAFFIC_COUNT }, (_, slot) =>
  slotSetup(slot),
);

function edgePoint(edge: number, along: number, band: Band): RoutePoint {
  if (edge === 0) return { x: X_MIN, y: band.yMin + along * (band.yMax - band.yMin) };
  if (edge === 1) return { x: X_MAX, y: band.yMin + along * (band.yMax - band.yMin) };
  if (edge === 2) return { x: X_MIN + along * (X_MAX - X_MIN), y: band.yMin };
  return { x: X_MIN + along * (X_MAX - X_MIN), y: band.yMax };
}

function pickEdge(rng: () => number): number {
  const r = rng();
  if (r < 0.35) return 0;
  if (r < 0.7) return 1;
  if (r < 0.85) return 2;
  return 3;
}

/** Inner band edge near the terminal (SFO end of the region). */
function terminalPoint(rng: () => number, band: Band): RoutePoint {
  return {
    x: 45 + rng() * 25,
    y: band === NORTH ? band.yMin : band.yMax,
  };
}

interface Route {
  p0: RoutePoint;
  pc: RoutePoint;
  p1: RoutePoint;
  kind: BgKind;
  alt0Ft: number;
  alt1Ft: number;
  callsign: string;
}

/**
 * Fixed airport-stream route: geometry never varies (the sequenced offsets
 * depend on it); altitude and callsign refresh per cycle like other slots.
 */
function planAirportRoute(slot: number, cycle: number, airport: AirportRole): Route {
  const rng = mulberry32(hash32([BG_SEED, slot, cycle, 7]));
  const arrival = airport === 'sfoArrival';
  const alt0Ft = arrival ? 7000 + rng() * 3000 : 900 + rng() * 600;
  const alt1Ft = arrival ? 800 + rng() * 700 : 9000 + rng() * 4000;
  return {
    p0: arrival ? SFO_ARRIVAL_P0 : SFO_DEPARTURE_P0,
    pc: arrival ? SFO_ARRIVAL_PC : SFO_DEPARTURE_PC,
    p1: arrival ? SFO_ARRIVAL_P1 : SFO_DEPARTURE_P1,
    kind: arrival ? 'arrival' : 'departure',
    alt0Ft,
    alt1Ft,
    callsign: `SIM ${100 + Math.floor(rng() * 800)}`,
  };
}

function planRoute(
  slot: number,
  cycle: number,
  band: Band,
  kind: BgKind,
  airport: AirportRole = null,
): Route {
  if (airport !== null) return planAirportRoute(slot, cycle, airport);
  const rng = mulberry32(hash32([BG_SEED, slot, cycle, 7]));
  let p0: RoutePoint = { x: X_MIN, y: (band.yMin + band.yMax) / 2 };
  let p1: RoutePoint = { x: X_MAX, y: (band.yMin + band.yMax) / 2 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const a = edgePoint(pickEdge(rng), rng(), band);
    const b = edgePoint(pickEdge(rng), rng(), band);
    if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_LEG_NM) {
      p0 = a;
      p1 = b;
      break;
    }
  }
  // Arrivals end near the terminal descending; departures start there climbing.
  if (kind === 'arrival') {
    const exit = terminalPoint(rng, band);
    if (Math.hypot(exit.x - p0.x, exit.y - p0.y) >= MIN_LEG_NM) p1 = exit;
  } else if (kind === 'departure') {
    const entry = terminalPoint(rng, band);
    if (Math.hypot(p1.x - entry.x, p1.y - entry.y) >= MIN_LEG_NM) p0 = entry;
  }
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.max(Math.hypot(dx, dy), 1e-6);
  const curved = rng() < 0.5;
  const amp = curved ? (rng() * 2 - 1) * MAX_CURVE_NM : 0;
  const pc = {
    x: Math.min(Math.max(mid.x + (-dy / len) * amp, X_MIN + 1), X_MAX - 1),
    y: Math.min(Math.max(mid.y + (dx / len) * amp, band.yMin + 1), band.yMax - 1),
  };
  let alt0Ft: number;
  let alt1Ft: number;
  if (kind === 'arrival') {
    alt0Ft = 9000 + rng() * 4000;
    alt1Ft = 2500 + rng() * 2000;
  } else if (kind === 'departure') {
    alt0Ft = 3000 + rng() * 2000;
    alt1Ft = 11000 + rng() * 5000;
  } else {
    alt0Ft = Math.round((24000 + rng() * 13000) / 500) * 500;
    alt1Ft = alt0Ft;
  }
  const callsign = `SIM ${100 + Math.floor(rng() * 800)}`;
  return { p0, pc, p1, kind, alt0Ft, alt1Ft, callsign };
}

/** Quadratic bezier position and derivative at phase u. */
function bezier(route: Route, u: number): { x: number; y: number; dx: number; dy: number } {
  const { p0, pc, p1 } = route;
  const v = 1 - u;
  return {
    x: v * v * p0.x + 2 * v * u * pc.x + u * u * p1.x,
    y: v * v * p0.y + 2 * v * u * pc.y + u * u * p1.y,
    dx: 2 * v * (pc.x - p0.x) + 2 * u * (p1.x - pc.x),
    dy: 2 * v * (pc.y - p0.y) + 2 * u * (p1.y - pc.y),
  };
}

/** Control-polygon length of a route (NM). */
function routeLengthNm(route: Pick<Route, 'p0' | 'pc' | 'p1'>): number {
  const a = Math.hypot(route.pc.x - route.p0.x, route.pc.y - route.p0.y);
  const b = Math.hypot(route.p1.x - route.pc.x, route.p1.y - route.pc.y);
  return Math.max(a + b, 1);
}

/** Seconds to fly one cycle at the kind's mean speed. */
function cyclePeriodS(slot: number, cycle: number, setup: SlotSetup): number {
  const route = planRoute(slot, cycle, setup.band, setup.kind, setup.airport);
  return (routeLengthNm(route) / KIND_SPEED_KT[setup.kind]) * 3600;
}

/** Locate the cycle and linear phase for shifted time; pure and bounded. */
function locateCycle(shiftedS: number, slot: number, setup: SlotSetup): { cycle: number; s: number } {
  let cycle = 0;
  let start = 0;
  for (;;) {
    const period = cyclePeriodS(slot, cycle, setup);
    if (shiftedS < start + period || cycle > 1000) {
      return { cycle, s: (shiftedS - start) / period };
    }
    start += period;
    cycle += 1;
  }
}

/**
 * Arrival phase shaping: eased progress (fast early, slow near the
 * terminal) with slope 1.25x the mean at entry and 0.75x at exit.
 */
function arrivalPhase(s: number): { u: number; slope: number } {
  const eased = 1 - (1 - s) * (1 - s);
  return { u: 0.75 * s + 0.25 * eased, slope: 0.75 + 0.5 * (1 - s) };
}

/** Deterministic pairwise spacing; zero push at the boundary. */
function separate(positions: RoutePoint[], bandOf: Band[]): void {
  // Separate past the minimum with margin: the band clamp inside the loop
  // can pull edge pairs slightly back together on the final pass.
  const target = BG_MIN_SEP_NM + 0.3;
  for (let pass = 0; pass < 30; pass += 1) {
    let moved = false;
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i];
        const b = positions[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= target - 1e-9 || dist < 1e-6) continue;
        moved = true;
        const push = ((target - dist) / 2 / dist) * 0.9;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
    for (let i = 0; i < positions.length; i += 1) {
      const band = bandOf[i];
      positions[i].x = Math.min(Math.max(positions[i].x, X_MIN), X_MAX);
      positions[i].y = Math.min(Math.max(positions[i].y, band.yMin), band.yMax);
    }
    if (!moved) break;
  }
}

/** All background aircraft at sim time t (seconds). Pure: same t, same sky. */
export function backgroundTrafficAt(timeS: number): BgAircraft[] {
  const t = Math.max(0, timeS);
  const legs = SLOTS.map((setup, slot) => {
    const { cycle, s } = locateCycle(t + setup.offsetS, slot, setup);
    const route = planRoute(slot, cycle, setup.band, setup.kind, setup.airport);
    const shaped = setup.kind === 'arrival' ? arrivalPhase(Math.min(Math.max(s, 0), 1)) : null;
    const u = shaped === null ? s : shaped.u;
    const slope = shaped === null ? 1 : shaped.slope;
    const pos = bezier(route, u);
    const period = cyclePeriodS(slot, cycle, setup);
    let dx = pos.dx;
    let dy = pos.dy;
    if (Math.hypot(dx, dy) < 1e-6) {
      dx = route.p1.x - route.p0.x;
      dy = route.p1.y - route.p0.y;
    }
    return {
      slot,
      cycle,
      route,
      xNm: pos.x,
      yNm: pos.y,
      altFt: route.alt0Ft + (route.alt1Ft - route.alt0Ft) * u,
      speedKt: (routeLengthNm(route) / period) * 3600 * slope,
      headingDeg: trackAngleDeg(0, 0, dx, -dy),
    };
  });
  const positions = legs.map((leg) => ({ x: leg.xNm, y: leg.yNm }));
  separate(positions, SLOTS.map((setup) => setup.band));
  return legs.map((leg, index) => ({
    slot: leg.slot,
    cycle: leg.cycle,
    callsign: leg.route.callsign,
    kind: leg.route.kind,
    xNm: positions[index].x,
    yNm: positions[index].y,
    altFt: leg.altFt,
    speedKt: leg.speedKt,
    headingDeg: leg.headingDeg,
  }));
}

/** Hover label. Callsigns are generic SIM numbers; no airline codes. */
export function formatBgTip(ac: BgAircraft): string {
  return `${ac.callsign} · ${Math.round(ac.altFt).toLocaleString('en-US')} ft`;
}
