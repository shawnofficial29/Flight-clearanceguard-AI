import type { ComparisonMatrix } from '../api/types';

function statusLabel(status: string): string {
  if (status === 'match') return 'Match';
  if (status === 'mismatch') return 'Mismatch';
  return 'Verify required';
}

function statusIcon(status: string): string {
  if (status === 'match') return '✓';
  if (status === 'mismatch') return '✕';
  return '?';
}

/** Simplified ATC / Pilot / FMS comparison. Full matrix stays in Evidence. */
export function IntentCompare(props: {
  comparison: ComparisonMatrix;
}): React.JSX.Element {
  const { comparison } = props;
  const ordered = [...comparison.rows].sort((a, b) => {
    const rank = (status: string): number => (status === 'match' ? 1 : 0);
    return rank(a.status) - rank(b.status);
  });
  return (
    <section className="panel">
      <h2>ATC / Pilot / FMS comparison</h2>
      <p className="meta-line">
        Overall: <strong>{comparison.overall}</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>Aspect</th>
            <th>ATC</th>
            <th>Pilot</th>
            <th>FMS</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, index) => (
            <tr key={`${row.aspect}-${index}`} className={`row-${row.status}`}>
              <td>{row.aspect}</td>
              <td>{row.atc}</td>
              <td>{row.pilot}</td>
              <td>{row.fms}</td>
              <td>
                <span className={`pill pill-${row.status}`}>
                  <span aria-hidden="true">{statusIcon(row.status)} </span>
                  {statusLabel(row.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {comparison.missing_condition && comparison.missing_phrase !== null ? (
        <p className="meta-line">Missing condition: {comparison.missing_phrase}</p>
      ) : null}
    </section>
  );
}
