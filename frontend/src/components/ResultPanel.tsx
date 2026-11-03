import { memo } from 'react';
import type {
  ComparisonMatrix,
  ConflictPrediction,
  CorrectionResult,
  SafetyWindow,
} from '../api/types';
import { fixAppliedPhrase } from '../utils/clearancePhrases';
import { meritAfterTrafficS } from '../utils/playbackMath';
import { AnimatedText } from './AnimatedText';

export interface ResultPanelProps {
  conflict: ConflictPrediction | null;
  comparison: ComparisonMatrix | null;
  correction: CorrectionResult | null;
  safety: SafetyWindow | null;
  correcting: boolean;
  onConfirmCorrection: () => void;
  /** Confirmation flow drives the correction itself; locks manual confirm. */
  flowActive?: boolean;
}

type StatusTone = 'ok' | 'warn' | 'bad';

function statusOf(
  conflict: ConflictPrediction,
  comparison: ComparisonMatrix | null,
  correction: CorrectionResult | null,
): { text: string; tone: StatusTone } {
  if (conflict.conflict) {
    return conflict.first_conflict_time_s === null
      ? { text: 'Conflict predicted', tone: 'bad' }
      : { text: `Conflict in ${Math.round(conflict.first_conflict_time_s)} s`, tone: 'bad' };
  }
  if (correction !== null && correction.resolved) {
    return { text: 'Conflict cleared ✓', tone: 'ok' };
  }
  if (comparison !== null && comparison.overall !== 'agree') {
    return { text: 'Mismatch — no conflict predicted', tone: 'warn' };
  }
  return { text: 'No conflict predicted', tone: 'ok' };
}

/**
 * Single merged result card. Rows with no backend value are hidden rather
 * than shown as dashes; full detail lives in the Evidence drawer.
 */
export const ResultPanel = memo(function ResultPanel(
  props: ResultPanelProps,
): React.JSX.Element | null {
  const { conflict, comparison, correction, safety, correcting, onConfirmCorrection, flowActive = false } = props;
  if (conflict === null) return null;

  const status = statusOf(conflict, comparison, correction);
  // Separation at the closest lateral approach: the whole-horizon minimum
  // reads 0 ft after a benign level-off far past the crossing.
  const separationFt =
    safety === null
      ? null
      : correction === null
        ? safety.min_sep_no_correction.vertical_at_min_lateral_ft
        : safety.min_sep_after_correction.vertical_at_min_lateral_ft;
  const fixApplied = correction === null ? null : fixAppliedPhrase(correction);
  // MERIT sequencing from simulation output; hidden when a crossing is absent.
  const afterTraffic = meritAfterTrafficS(conflict);
  const timingText =
    afterTraffic !== null && afterTraffic > 0.5
      ? `Crosses MERIT ${Math.round(afterTraffic)} s after traffic ✓`
      : null;
  const verified =
    correction !== null && correction.resolved && conflict.conflict === false;
  const needsAction =
    correction === null &&
    (conflict.conflict || (comparison?.overall ?? 'agree') !== 'agree');

  const conflictT = conflict.first_conflict_time_s;
  return (
    <section
      className="panel result"
      aria-label="Result"
      data-verified={verified || undefined}
    >
      <h2>Result</h2>
      <p className={`result-status result-${status.tone}`}>
        {conflict.conflict && conflictT !== null ? (
          <AnimatedText value={conflictT} format={(n) => `Conflict in ${Math.round(n)} s`} />
        ) : (
          status.text
        )}
      </p>
      <dl className="facts">
        {separationFt !== null ? (
          <>
            <dt>Separation</dt>
            <dd className={conflict.conflict ? 'v-bad' : undefined}>
              <AnimatedText
                value={separationFt}
                format={(n) => `${Math.round(n).toLocaleString('en-US')} ft`}
              />
            </dd>
          </>
        ) : null}
        {timingText !== null ? (
          <>
            <dt>Timing</dt>
            <dd>{timingText}</dd>
          </>
        ) : null}
        {fixApplied !== null ? (
          <>
            <dt>Fix applied</dt>
            <dd>{fixApplied}</dd>
          </>
        ) : null}
        {verified ? (
          <>
            <dt>Verified</dt>
            <dd>Readback, FMS and trajectory agree</dd>
          </>
        ) : null}
      </dl>
      {needsAction ? (
        <>
          <button
            type="button"
            className="btn-primary"
            disabled={correcting || flowActive}
            onClick={onConfirmCorrection}
          >
            {correcting ? 'Applying correction…' : 'Confirm correction'}
          </button>
          <p className="meta-line">
            Confirming reprograms the simulated FMS from the ATC clearance.
          </p>
        </>
      ) : null}
    </section>
  );
});
