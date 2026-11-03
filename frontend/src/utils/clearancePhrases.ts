/** Short human phrases formatted from backend clearance / FMS data. */

import type {
  Clearance,
  ClearanceAction,
  CorrectionResult,
  FMSProgram,
} from '../api/types';

const VERBS: Record<string, string> = {
  DIRECT_TO: 'Direct',
  CLIMB: 'Climb',
  DESCEND: 'Descend',
  MAINTAIN: 'Maintain',
  SPEED: 'Speed',
  HEADING: 'Heading',
  HOLD: 'Hold',
};

const VERBS_THIRD: Record<string, string> = {
  DIRECT_TO: 'Directs',
  CLIMB: 'Climbs',
  DESCEND: 'Descends',
  MAINTAIN: 'Maintains',
  SPEED: 'Speeds',
  HEADING: 'Heads',
  HOLD: 'Holds',
};

export function formatActionValue(action: ClearanceAction): string | null {
  if (action.action_type === 'DIRECT_TO') return action.target_fix;
  if (action.numeric_value === null) return null;
  if (action.unit === 'FL') return `FL${action.numeric_value}`;
  if (action.unit === 'FT') return `${action.numeric_value.toLocaleString('en-US')} ft`;
  return `${action.numeric_value} ${action.unit}`;
}

export function formatTrigger(action: ClearanceAction): string | null {
  if (action.trigger_type === 'AFTER_WAYPOINT') {
    return action.trigger_value === null ? 'after waypoint' : `after ${action.trigger_value}`;
  }
  if (action.trigger_type === 'AT_WAYPOINT') {
    return action.trigger_value === null ? 'at waypoint' : `at ${action.trigger_value}`;
  }
  if (action.trigger_type === 'AT_TIME') {
    return action.trigger_value === null ? 'at time' : `at ${action.trigger_value}`;
  }
  return null;
}

/**
 * The headline action of a clearance: the conditioned instruction first,
 * else the altitude instruction, else whatever comes first. The speed
 * instruction ("reduce speed now") never headlines over the descent.
 */
export function primaryAction(actions: ClearanceAction[]): ClearanceAction | null {
  return (
    actions.find((entry) => entry.trigger_type !== 'IMMEDIATE') ??
    actions.find(
      (entry) =>
        entry.action_type === 'CLIMB' ||
        entry.action_type === 'DESCEND' ||
        entry.action_type === 'MAINTAIN',
    ) ??
    actions[0] ??
    null
  );
}

/** One-line phrase for an ATC clearance or pilot readback. */
export function formatClearancePhrase(clearance: Clearance): string {
  const action = primaryAction(clearance.actions);
  if (action === null) return '—';
  const parts = [
    VERBS[action.action_type] ?? action.action_type,
    formatActionValue(action),
    formatTrigger(action),
  ].filter((part): part is string => part !== null);
  return parts.join(' ');
}

/**
 * One-line phrase for FMS programming. A dropped timing condition reads as
 * "<Verb>s immediately" ("Descends immediately"); any other state names the
 * programmed value/timing.
 */
export function formatFmsPhrase(fms: FMSProgram, findingCategory: string | null): string {
  const action = primaryAction(fms.loaded_actions);
  const type = action?.action_type ?? 'CLIMB';
  const timing = fms.climb_start_fix === null ? null : `after ${fms.climb_start_fix}`;
  if (findingCategory === 'MISSING_CONDITION' && timing === null) {
    return `${VERBS_THIRD[type] ?? type} immediately`;
  }
  let value: string | null = null;
  if (type === 'DIRECT_TO') {
    value = action?.target_fix ?? fms.lateral_direct_to ?? fms.route[0] ?? null;
  } else if (fms.cleared_fl !== null) {
    value = `FL${fms.cleared_fl}`;
  } else if (fms.cleared_alt_ft !== null) {
    value = `${fms.cleared_alt_ft.toLocaleString('en-US')} ft`;
  }
  const parts = [VERBS[type] ?? type, value, timing].filter(
    (part): part is string => part !== null,
  );
  return parts.join(' ');
}

/** Short "Fix applied" phrase from the corrected pilot clearance. */
export function fixAppliedPhrase(correction: CorrectionResult): string | null {
  const action = primaryAction(correction.corrected_pilot.actions);
  if (action === null) return null;
  if (
    (action.trigger_type === 'AFTER_WAYPOINT' || action.trigger_type === 'AT_WAYPOINT') &&
    action.trigger_value !== null
  ) {
    const prep = action.trigger_type === 'AFTER_WAYPOINT' ? 'after' : 'at';
    return `Restored '${prep} ${action.trigger_value}' condition`;
  }
  if (action.action_type === 'DIRECT_TO') {
    return action.target_fix === null ? null : `Restored 'direct ${action.target_fix}'`;
  }
  const value = formatActionValue(action);
  return value === null ? null : `Restored '${value}'`;
}

