import type {
  ComparisonMatrix,
  ConflictPrediction,
  CorrectionResult,
  DemoResult,
} from '../api/types';

/**
 * One prominent context-sensitive card. Titles are UI status labels derived
 * from backend state; every sentence comes from backend explanation/findings.
 */
export function AlertCard(props: {
  demo: DemoResult;
  correction: CorrectionResult | null;
  comparison: ComparisonMatrix;
  conflict: ConflictPrediction;
}): React.JSX.Element {
  const { demo, correction, comparison, conflict } = props;

  if (correction !== null && correction.resolved && !conflict.conflict) {
    return (
      <section className="panel alert alert-ok" aria-live="polite">
        <h2>Resolution verified</h2>
        <p className="alert-title">
          <span aria-hidden="true">✓</span> CLEARANCE SYNCHRONIZED
        </p>
        <p className="alert-title">
          <span aria-hidden="true">✓</span> CONFLICT CLEARED
        </p>
        <p className="meta-line">{correction.explanation.summary}</p>
      </section>
    );
  }

  if (conflict.conflict) {
    return (
      <section className="panel alert alert-bad" aria-live="polite">
        <h2>Conflict predicted</h2>
        <p className="alert-title">
          <span aria-hidden="true">●</span> CONFLICT PREDICTED
        </p>
        <p>{demo.explanation.summary}</p>
        {comparison.overall === 'mismatch' ? (
          <p className="meta-line">Caused by a clearance mismatch. See comparison below.</p>
        ) : null}
      </section>
    );
  }

  if (comparison.overall === 'mismatch') {
    const detail =
      comparison.findings.length > 0
        ? comparison.findings[0].detail
        : 'Clearance sources disagree.';
    return (
      <section className="panel alert alert-warn" aria-live="polite">
        <h2>Mismatch detected</h2>
        <p className="alert-title">
          <span aria-hidden="true">▲</span> MISMATCH DETECTED
        </p>
        <p>{detail}</p>
      </section>
    );
  }

  return (
    <section className="panel alert alert-ok" aria-live="polite">
      <h2>No mismatch</h2>
      <p className="alert-title">
        <span aria-hidden="true">✓</span> CLEARANCE CONSISTENT
      </p>
      <p className="meta-line">{demo.explanation.summary}</p>
    </section>
  );
}
