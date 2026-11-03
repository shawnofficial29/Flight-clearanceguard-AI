import type {
  Clearance,
  ClearanceAction,
  ComparisonMatrix,
  FMSProgram,
} from '../api/types';

function isAltitudeAction(actionType: string): boolean {
  return actionType === 'CLIMB' || actionType === 'DESCEND' || actionType === 'MAINTAIN';
}

function formatValue(action: ClearanceAction): string {
  if (action.numeric_value === null) return action.action_type;
  if (action.unit === 'FL') return `FL${action.numeric_value}`;
  if (action.unit === 'FT') return `${action.numeric_value.toLocaleString('en-US')} ft`;
  return `${action.numeric_value} ${action.unit}`;
}

function formatFmsAltitude(fms: FMSProgram): string {
  if (fms.cleared_alt_ft !== null) return `${fms.cleared_alt_ft.toLocaleString('en-US')} ft`;
  if (fms.cleared_fl !== null) return `FL${fms.cleared_fl}`;
  return '—';
}

function actionOf(clearance: Clearance, actionType: string): ClearanceAction | null {
  return clearance.actions.find((action) => action.action_type === actionType) ?? null;
}

function triggerPhrase(action: ClearanceAction | null): string {
  if (action === null) return '—';
  if (action.trigger_type === 'IMMEDIATE') return 'IMMEDIATE';
  if (action.trigger_type === 'AFTER_WAYPOINT') return `AFTER ${action.trigger_value ?? '—'}`;
  if (action.trigger_type === 'AT_WAYPOINT') return `AT ${action.trigger_value ?? '—'}`;
  return `${action.trigger_type} ${action.trigger_value ?? ''}`.trim();
}

export interface ClearanceSummaryProps {
  atc: Clearance;
  pilot: Clearance;
  fms: FMSProgram;
  comparison: ComparisonMatrix;
  corrected: boolean;
}

/**
 * Compact clearance cards. Altitude disagreements show the three assigned
 * values; timing disagreements show the ATC/FMS timing side by side. Every
 * value is formatted from backend clearance / FMS data.
 */
export function ClearanceSummary(props: ClearanceSummaryProps): React.JSX.Element | null {
  const { atc, pilot, fms, comparison, corrected } = props;
  const finding = comparison.findings[0];

  if (comparison.overall === 'agree') {
    const altitude = atc.actions.find((action) => isAltitudeAction(action.action_type)) ?? null;
    if (altitude === null) return null;
    const pilotAction = actionOf(pilot, altitude.action_type);
    return (
      <section className="panel cards" aria-label="Clearance values">
        <h2>Clearance values</h2>
        <dl className="value-cards">
          <div className="vrow">
            <dt>ATC assigned</dt>
            <dd>{formatValue(altitude)}</dd>
          </div>
          <div className="vrow">
            <dt>Pilot confirmed</dt>
            <dd>{pilotAction === null ? '—' : formatValue(pilotAction)}</dd>
          </div>
          <div className="vrow">
            <dt>FMS selected</dt>
            <dd>{formatFmsAltitude(fms)}</dd>
          </div>
          <div className="vrow">
            <dt>Status</dt>
            <dd className="v-ok">Synchronized</dd>
          </div>
        </dl>
      </section>
    );
  }

  if (
    finding !== undefined &&
    finding.category === 'CHANGED_VALUE' &&
    isAltitudeAction(finding.action)
  ) {
    const atcAction = actionOf(atc, finding.action);
    const pilotAction = actionOf(pilot, finding.action);
    return (
      <section className="panel cards" aria-label="Clearance values">
        <h2>Clearance values</h2>
        <dl className="value-cards">
          <div className="vrow">
            <dt>ATC assigned</dt>
            <dd>{atcAction === null ? '—' : formatValue(atcAction)}</dd>
          </div>
          <div className="vrow">
            <dt>{corrected ? 'Pilot confirmed' : 'Pilot readback'}</dt>
            <dd>{pilotAction === null ? '—' : formatValue(pilotAction)}</dd>
          </div>
          <div className="vrow">
            <dt>FMS selected</dt>
            <dd>{formatFmsAltitude(fms)}</dd>
          </div>
        </dl>
      </section>
    );
  }

  if (finding !== undefined && finding.category === 'MISSING_CONDITION') {
    const atcAction = actionOf(atc, finding.action);
    const value = atcAction === null ? finding.action : formatValue(atcAction);
    return (
      <section className="panel cards" aria-label="Clearance timing">
        <h2>Clearance timing</h2>
        <p className="timing-lead">Altitude {value} matches.</p>
        <p className="meta-line">Execution timing differs:</p>
        <dl className="value-cards">
          <div className="vrow">
            <dt>ATC</dt>
            <dd>{triggerPhrase(atcAction)}</dd>
          </div>
          <div className="vrow">
            <dt>FMS</dt>
            <dd>{fms.climb_start_fix ?? 'IMMEDIATE'}</dd>
          </div>
        </dl>
      </section>
    );
  }

  return null;
}
