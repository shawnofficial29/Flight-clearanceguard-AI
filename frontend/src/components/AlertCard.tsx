import type {
  Clearance,
  ComparisonMatrix,
  ConflictPrediction,
  CorrectionResult,
  DemoResult,
  FMSProgram,
} from '../api/types';
import { describeError, describeResolved } from '../utils/errorSentence';

/**
 * One prominent context-sensitive card. Titles are UI status labels derived
 * from backend state; every sentence comes from backend explanation/findings.
 */
export function AlertCard(props: {
  demo: DemoResult;
  correction: CorrectionResult | null;
  comparison: ComparisonMatrix;
  conflict: ConflictPrediction;
  atc: Clearance;
  pilot: Clearance;
  fms: FMSProgram;
}): React.JSX.Element {
  const { demo, correction, comparison, conflict, atc, pilot, fms } = props;

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
        <p className="error-sentence">{describeResolved({ fms, comparison })}</p>
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
        <p className="error-sentence">{describeError({ atc, pilot, fms, comparison })}</p>
        <p className="meta-line">{demo.explanation.summary}</p>
      </section>
    );
  }

  if (comparison.overall === 'mismatch') {
    return (
      <section className="panel alert alert-warn" aria-live="polite">
        <h2>Mismatch detected</h2>
        <p className="alert-title">
          <span aria-hidden="true">▲</span> MISMATCH DETECTED
        </p>
        <p className="error-sentence">{describeError({ atc, pilot, fms, comparison })}</p>
        <p className="meta-line">{demo.explanation.summary}</p>
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
