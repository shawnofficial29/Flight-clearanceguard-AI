import type { ConflictPrediction, ProfilePoint } from '../api/types';

/** Fixed simulation rate shown as SIMULATION ×30. */
export const PLAYBACK_RATE = 30;

export interface TrackSample {
  ownX: number;
  ownFt: number;
  ownKt: number | null;
  tfcX: number;
  tfcY: number;
  tfcFt: number;
  tfcKt: number | null;
}

function sampleOf(point: ProfilePoint): TrackSample {
  return {
    ownX: point.meta_x_nm,
    ownFt: point.meta_ft,
    ownKt: point.meta_kt,
    tfcX: point.intruder_x_nm,
    tfcY: point.intruder_y_nm,
    tfcFt: point.intruder_ft,
    tfcKt: point.intruder_kt,
  };
}

/** Linearly interpolate the backend profile at sim time t (seconds). */
export function sampleProfile(profile: ProfilePoint[], t: number): TrackSample | null {
  if (profile.length === 0) return null;
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (t <= first.t_s) return sampleOf(first);
  if (t >= last.t_s) return sampleOf(last);
  for (let index = 1; index < profile.length; index += 1) {
    const next = profile[index];
    if (next.t_s >= t) {
      const prev = profile[index - 1];
      const span = next.t_s - prev.t_s;
      const frac = span <= 0 ? 0 : (t - prev.t_s) / span;
      const a = sampleOf(prev);
      const b = sampleOf(next);
      return {
        ownX: a.ownX + (b.ownX - a.ownX) * frac,
        ownFt: a.ownFt + (b.ownFt - a.ownFt) * frac,
        ownKt:
          a.ownKt === null ? b.ownKt : b.ownKt === null ? a.ownKt : a.ownKt + (b.ownKt - a.ownKt) * frac,
        tfcX: a.tfcX + (b.tfcX - a.tfcX) * frac,
        tfcY: a.tfcY + (b.tfcY - a.tfcY) * frac,
        tfcFt: a.tfcFt + (b.tfcFt - a.tfcFt) * frac,
        tfcKt:
          a.tfcKt === null ? b.tfcKt : b.tfcKt === null ? a.tfcKt : a.tfcKt + (b.tfcKt - a.tfcKt) * frac,
      };
    }
  }
  return sampleOf(last);
}

export interface AdvanceResult {
  t: number;
  hitPause: boolean;
  hitEnd: boolean;
}

/** Pure single-step advance for the playback loop (also unit-tested). */
export function advanceTime(
  t: number,
  dtMs: number,
  rate: number,
  pauseAt: number | null,
  pauseArmed: boolean,
  tMax: number,
): AdvanceResult {
  let next = t + (dtMs / 1000) * rate;
  if (pauseAt !== null && pauseArmed && t < pauseAt && next >= pauseAt) {
    return { t: pauseAt, hitPause: true, hitEnd: false };
  }
  if (next >= tMax) {
    return { t: tMax, hitPause: false, hitEnd: true };
  }
  return { t: next, hitPause: false, hitEnd: false };
}

/**
 * Conflict-zone opacity follows the story, never carries it alone: faint but
 * visible before the conflict, full at the conflict, faded after correction.
 */
export function zoneOpacity(
  t: number,
  conflictT: number | null,
  faded: boolean,
): number {
  if (faded) return 0.15;
  if (conflictT === null) return 0;
  if (t >= conflictT) return 1;
  const lead = 60;
  const start = conflictT - lead;
  if (t <= start) return 0.25;
  return 0.25 + 0.75 * ((t - start) / lead);
}

/**
 * Seconds META 452 crosses MERIT after traffic, from exact simulation
 * fields; null when either crossing is absent.
 */
export function meritAfterTrafficS(prediction: ConflictPrediction): number | null {
  if (prediction.merit_time_s === null || prediction.intruder_merit_time_s === null) {
    return null;
  }
  return prediction.merit_time_s - prediction.intruder_merit_time_s;
}

export type LabelDirection = 'top' | 'bottom' | 'left' | 'right';

export interface LabelLayout {
  heroDir: 'top' | 'bottom';
  tfcDir: 'top' | 'bottom';
  tagDir: 'left' | 'right';
}

/**
 * Label placement in scenario NM so the hero tag, traffic tag, and status
 * tag never stack: the traffic label extends away from the hero (forced to
 * opposite sides when close), and the status tag sits opposite the traffic
 * track. Pure in positions; stable across playback (no flip-flop).
 */
export function labelLayout(
  heroX: number,
  heroY: number,
  tfcX: number,
  tfcY: number,
  tagX: number,
  tfcTrackX: number,
): LabelLayout {
  const close = Math.hypot(heroX - tfcX, heroY - tfcY) < 8;
  return {
    heroDir: 'top',
    tfcDir: close || tfcY < heroY ? 'bottom' : 'top',
    tagDir: tfcTrackX >= tagX ? 'left' : 'right',
  };
}

/** Screen-space track angle in degrees for rotating aircraft glyphs. */
export function trackAngleDeg(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}
