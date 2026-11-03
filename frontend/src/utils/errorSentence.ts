import type {
  Clearance,
  ClearanceAction,
  ComparisonMatrix,
  FMSProgram,
} from '../api/types';

/** Every value below is formatted from backend clearance / FMS data. */

function formatActionValue(action: ClearanceAction): string {
  if (action.numeric_value === null) return action.action_type;
  if (action.unit === 'FL') return `FL${action.numeric_value}`;
  if (action.unit === 'FT') return `${action.numeric_value.toLocaleString('en-US')} ft`;
  return `${action.numeric_value} ${action.unit.toLowerCase()}`;
}

function formatFmsAltitude(fms: FMSProgram): string | null {
  if (fms.cleared_alt_ft !== null) return `${fms.cleared_alt_ft.toLocaleString('en-US')} ft`;
  if (fms.cleared_fl !== null) return `FL${fms.cleared_fl}`;
  return null;
}

function actionOf(clearance: Clearance, actionType: string): ClearanceAction | null {
  return clearance.actions.find((action) => action.action_type === actionType) ?? null;
}

function subjectFor(actionType: string): string {
  if (actionType === 'CLIMB' || actionType === 'DESCEND' || actionType === 'MAINTAIN') {
    return 'Altitude';
  }
  return actionType;
}

export interface ErrorInputs {
  atc: Clearance;
  pilot: Clearance;
  fms: FMSProgram;
  comparison: ComparisonMatrix;
}

/**
 * One immediately readable error sentence. Falls back to the backend finding
 * detail when the category has no dedicated template.
 */
export function describeError(inputs: ErrorInputs): string {
  const { atc, pilot, fms, comparison } = inputs;
  const finding = comparison.findings[0];
  if (finding === undefined) return 'Clearance sources disagree.';
  const atcAction = actionOf(atc, finding.action);
  const pilotAction = actionOf(pilot, finding.action);

  if (finding.category === 'MISSING_CONDITION') {
    const value = atcAction === null ? finding.action : formatActionValue(atcAction);
    const phrase = comparison.missing_phrase ?? finding.detail;
    return `${subjectFor(finding.action)} ${value} is correct; the ${phrase} timing was omitted.`;
  }

  if (finding.category === 'CHANGED_VALUE') {
    const atcValue = atcAction === null ? '—' : formatActionValue(atcAction);
    const pilotValue = pilotAction === null ? '—' : formatActionValue(pilotAction);
    const fmsValue = formatFmsAltitude(fms) ?? '—';
    return `ATC assigned ${atcValue}; pilot read back ${pilotValue}; FMS selected ${fmsValue}.`;
  }

  if (finding.category === 'CHANGED_WAYPOINT') {
    const atcFix = atcAction?.target_fix ?? '—';
    const pilotFix = pilotAction?.target_fix ?? '—';
    const fmsFix =
      fms.lateral_direct_to ?? (fms.route.length > 0 ? fms.route.join(', ') : '—');
    return `ATC cleared direct ${atcFix}; pilot read back ${pilotFix}; FMS selected ${fmsFix}.`;
  }

  return finding.detail;
}

export interface ResolvedInputs {
  fms: FMSProgram;
  comparison: ComparisonMatrix;
}

/** Resolved-state summary: agreement plus the selected FMS value. */
export function describeResolved(inputs: ResolvedInputs): string {
  const { fms, comparison } = inputs;
  if (comparison.overall !== 'agree') return '';
  const altitude = formatFmsAltitude(fms);
  if (altitude === null) return 'ATC / Pilot / FMS agree.';
  return `ATC / Pilot / FMS agree. FMS selected: ${altitude}.`;
}
