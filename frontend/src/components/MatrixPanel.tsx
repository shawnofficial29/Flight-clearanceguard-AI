import type { ComparisonMatrix } from '../api/types';

function statusLabel(status: string): string {
  if (status === 'match') return 'Match';
  if (status === 'mismatch') return 'Mismatch';
  return 'Verify required';
}

export function MatrixPanel(props: {
  comparison: ComparisonMatrix | null;
}): React.JSX.Element {
  const { comparison } = props;
  if (comparison === null) {
    return (
      <section className="panel">
        <h2>Clearance Integrity Matrix</h2>
        <p className="empty">Run the demo to load the comparison matrix.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Clearance Integrity Matrix</h2>
      <p className="meta-line">
        Overall: <strong>{comparison.overall}</strong> · Min confidence:{' '}
        {comparison.min_confidence.toFixed(2)}
        {comparison.missing_condition
          ? ` · Missing condition: ${comparison.missing_phrase ?? ''}`
          : null}
      </p>
      <table>
        <thead>
          <tr>
            <th>Aspect</th>
            <th>ATC</th>
            <th>Pilot</th>
            <th>FMS</th>
            <th>Predicted execution</th>
            <th>Status</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row, index) => (
            <tr key={`${row.aspect}-${index}`} className={`row-${row.status}`}>
              <td>{row.aspect}</td>
              <td>{row.atc}</td>
              <td>{row.pilot}</td>
              <td>{row.fms}</td>
              <td>{row.predicted}</td>
              <td>
                <span className={`pill pill-${row.status}`}>{statusLabel(row.status)}</span>
              </td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
