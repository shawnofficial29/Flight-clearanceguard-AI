import { PROVENANCE_LABELS, type Clearance } from '../api/types';

function formatValue(action: Clearance['actions'][number]): string {
  if (action.numeric_value === null) return '—';
  return `${action.numeric_value} ${action.unit}`;
}

function formatTrigger(action: Clearance['actions'][number]): string {
  if (action.trigger_type === 'IMMEDIATE') return 'Immediate';
  return `${action.trigger_type} ${action.trigger_value ?? ''}`.trim();
}

export function AtcPanel(props: { clearance: Clearance | null }): React.JSX.Element {
  const { clearance } = props;
  if (clearance === null) {
    return (
      <section className="panel">
        <h2>ATC panel</h2>
        <p className="empty">Run the demo to load the ATC clearance.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>ATC panel</h2>
      <p className="transcript">{clearance.raw_text}</p>
      <p className="meta-line">
        Callsign: {clearance.callsign ?? '—'} · Provenance:{' '}
        {PROVENANCE_LABELS[clearance.provenance]} · Model: {clearance.model}
      </p>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Fix</th>
            <th>Value</th>
            <th>Trigger</th>
            <th>Evidence</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {clearance.actions.map((action, index) => (
            <tr key={`${action.action_type}-${index}`}>
              <td>{action.action_type}</td>
              <td>{action.target_fix ?? '—'}</td>
              <td>{formatValue(action)}</td>
              <td>{formatTrigger(action)}</td>
              <td>{action.evidence ?? '—'}</td>
              <td>{action.confidence.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meta-line">Overall confidence: {clearance.overall_confidence.toFixed(2)}</p>
    </section>
  );
}
