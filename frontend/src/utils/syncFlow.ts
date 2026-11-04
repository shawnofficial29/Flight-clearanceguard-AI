/** Data selectors for the ATC-first / pilot-second altitude sync loop. */

import type { Clearance, DemoResult } from '../api/types';

/** Scenario running the two-step altitude confirmation flow. */
export const SYNC_SCENARIO_ID = 'altitude-sync';
export const CUSTOM_SCENARIO_ID = 'custom';

/** Autoplay dwell per sync step (ms): paced for live narration. */
export const SYNC_STEP_MS = 8000;

/**
 * Fix named in the traffic caution. Presentation geography shared with the
 * SimMap fix anchors; the altitude beside it always comes from simulation.
 */
export const SYNC_TRAFFIC_FIX = 'MERIT';

export interface SyncAltitudes {
  callsign: string;
  atcClearedFt: number;
  pilotSetFt: number;
  trafficFt: number;
}

function verticalFt(clearance: Clearance): number | null {
  const maintain = clearance.actions.find(
    (entry) =>
      entry.action_type === 'MAINTAIN' && entry.unit === 'FT' && entry.numeric_value !== null,
  );
  if (maintain?.numeric_value !== null && maintain?.numeric_value !== undefined) {
    return maintain.numeric_value;
  }
  const change = clearance.actions.find(
    (entry) =>
      (entry.action_type === 'CLIMB' || entry.action_type === 'DESCEND') &&
      entry.unit === 'FT' &&
      entry.numeric_value !== null,
  );
  return change?.numeric_value ?? null;
}

/**
 * Sync altitudes from simulation data: ATC clearance, FMS-set altitude, and
 * traffic altitude. Null when the demo lacks any of them.
 */
export function syncAltitudes(demo: DemoResult | null): SyncAltitudes | null {
  if (demo === null) return null;
  const atcClearedFt = verticalFt(demo.atc);
  const pilotSetFt = demo.fms.cleared_alt_ft ?? verticalFt(demo.pilot);
  const trafficFt = demo.conflict.profile[0]?.intruder_ft ?? null;
  const callsign = demo.atc.callsign ?? demo.pilot.callsign ?? 'Ownship';
  if (atcClearedFt === null || pilotSetFt === null || trafficFt === null) return null;
  return { callsign, atcClearedFt, pilotSetFt, trafficFt: Math.round(trafficFt) };
}

export function formatSyncFt(ft: number): string {
  return Math.round(ft).toLocaleString('en-US');
}
