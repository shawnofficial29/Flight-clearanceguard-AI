import {
  PROVENANCE_LABELS,
  type Clearance,
  type ComparisonMatrix,
  type FMSProgram,
} from '../api/types';

interface PilotFmsProps {
  pilot: Clearance | null;
  fms: FMSProgram | null;
  comparison: ComparisonMatrix | null;
}

export function PilotFmsPanel(props: PilotFmsProps): React.JSX.Element {
  const { pilot, fms, comparison } = props;
  if (pilot === null || fms === null) {
    return (
      <section className="panel">
        <h2>Pilot and FMS panel</h2>
        <p className="empty">Run the demo to load the pilot readback and FMS state.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Pilot and FMS panel</h2>
      <h3>Pilot readback</h3>
      <p className="transcript">{pilot.raw_text}</p>
      <p className="meta-line">
        Provenance: {PROVENANCE_LABELS[pilot.provenance]} · Model: {pilot.model} · Overall
        confidence: {pilot.overall_confidence.toFixed(2)}
      </p>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Fix</th>
            <th>Value</th>
            <th>Trigger</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {pilot.actions.map((action, index) => (
            <tr key={`${action.action_type}-${index}`}>
              <td>{action.action_type}</td>
              <td>{action.target_fix ?? '—'}</td>
              <td>
                {action.numeric_value === null
                  ? '—'
                  : `${action.numeric_value} ${action.unit}`}
              </td>
              <td>
                {action.trigger_type === 'IMMEDIATE'
                  ? 'Immediate'
                  : `${action.trigger_type} ${action.trigger_value ?? ''}`.trim()}
              </td>
              <td>{action.confidence.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Simulated FMS state</h3>
      <p>{fms.summary}</p>
      <dl className="facts">
        <dt>Callsign</dt>
        <dd>{fms.callsign ?? '—'}</dd>
        <dt>Cleared altitude</dt>
        <dd>{fms.cleared_alt_ft === null ? '—' : `${fms.cleared_alt_ft.toLocaleString()} ft`}</dd>
        <dt>Altitude change fix</dt>
        <dd>{fms.climb_start_fix ?? 'Immediate (none)'}</dd>
        <dt>Direct to</dt>
        <dd>{fms.lateral_direct_to ?? '—'}</dd>
        <dt>Route</dt>
        <dd>{fms.route.length > 0 ? fms.route.join(' → ') : '—'}</dd>
        <dt>Loaded</dt>
        <dd>{fms.loaded.length > 0 ? fms.loaded.join('; ') : '—'}</dd>
        <dt>Held</dt>
        <dd>{fms.held.length > 0 ? fms.held.join('; ') : 'None'}</dd>
        <dt>Source</dt>
        <dd>{fms.source}</dd>
      </dl>
      <h3>Mismatch categories</h3>
      {comparison === null || comparison.findings.length === 0 ? (
        <p className="empty">No mismatch findings.</p>
      ) : (
        <ul>
          {comparison.findings.map((finding, index) => (
            <li key={`${finding.category}-${index}`}>
              <strong>{finding.category}</strong> [{finding.scope}] {finding.action}:{' '}
              {finding.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
