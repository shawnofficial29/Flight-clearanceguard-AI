import type {
  ConflictPrediction,
  CorrectionResult,
  ResolutionCandidate,
  SafetyWindow,
  VerificationResult,
} from '../api/types';
import { formatSeconds, safetyMargin } from '../utils/demoLabels';

interface SafetyPanelProps {
  conflict: ConflictPrediction | null;
  safety: SafetyWindow | null;
  candidates: ResolutionCandidate[] | null;
  selectedId: string | null;
  appliedId: string | null;
  verification: VerificationResult | null;
  verifying: boolean;
  correcting: boolean;
  correction: CorrectionResult | null;
  onSelectCandidate: (id: string) => void;
  onConfirmCorrection: () => void;
}

export function SafetyPanel(props: SafetyPanelProps): React.JSX.Element {
  const {
    conflict,
    safety,
    candidates,
    selectedId,
    appliedId,
    verification,
    verifying,
    correcting,
    correction,
    onSelectCandidate,
    onConfirmCorrection,
  } = props;

  if (conflict === null) {
    return (
      <section className="panel">
        <h2>Safety and resolution panel</h2>
        <p className="empty">Run the demo to load the safety window.</p>
      </section>
    );
  }

  const margin = safetyMargin(
    conflict.first_conflict_time_s,
    safety?.last_safe_correction_s,
  );

  return (
    <section className="panel">
      <h2>Safety and resolution panel</h2>
      <dl className="facts">
        <dt>Conflict predicted</dt>
        <dd>{conflict.conflict ? 'Yes' : 'No'}</dd>
        <dt>Conflict predicted in</dt>
        <dd>
          {conflict.first_conflict_time_s === null
            ? 'No conflict predicted'
            : `${formatSeconds(conflict.first_conflict_time_s)} (lateral ${conflict.lateral_nm_at_conflict ?? '—'} NM, vertical ${conflict.vertical_ft_at_conflict ?? '—'} ft)`}
        </dd>
        <dt>Last safe correction in</dt>
        <dd>
          {safety?.last_safe_correction_s === null ||
          safety?.last_safe_correction_s === undefined
            ? '—'
            : formatSeconds(safety.last_safe_correction_s)}
        </dd>
        <dt>Safety margin between last correction and conflict</dt>
        <dd>{margin === null ? '—' : formatSeconds(margin)}</dd>
        <dt>Basis</dt>
        <dd>{safety?.basis ?? 'Loading…'}</dd>
      </dl>

      <h3>Causal chain</h3>
      {safety === null ? (
        <p className="empty">Loading…</p>
      ) : (
        <ol>
          {safety.causal_chain.map((step) => (
            <li key={step.step}>
              <strong>{step.stage}</strong>: {step.detail}
            </li>
          ))}
        </ol>
      )}

      <h3>Verified resolution candidates</h3>
      {candidates === null ? (
        <p className="empty">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="empty">No candidates enumerated.</p>
      ) : (
        <ul className="candidates">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <label>
                <input
                  type="radio"
                  name="candidate"
                  checked={selectedId === candidate.id}
                  disabled={correction !== null}
                  onChange={() => onSelectCandidate(candidate.id)}
                />
                <strong>{candidate.id}</strong> [{candidate.verification}]{' '}
                {candidate.action_human}
              </label>
              {appliedId === candidate.id ? (
                <span className="pill pill-ok">Applied</span>
              ) : null}
              <p className="meta-line">{candidate.safe_reason}</p>
            </li>
          ))}
        </ul>
      )}
      {verifying ? <p className="meta-line">Verifying candidate…</p> : null}
      {verification !== null && !verifying ? (
        <p className="meta-line">
          Verification for {verification.candidate_id}:{' '}
          <strong>{verification.verified ? 'VERIFIED' : 'NOT RESOLVED'}</strong> —{' '}
          {verification.reason}
        </p>
      ) : null}

      <h3>Pilot confirmation</h3>
      <p className="meta-line">
        Confirming reprograms the simulated FMS from the ATC clearance.
      </p>
      <button
        type="button"
        disabled={correcting || correction !== null}
        onClick={onConfirmCorrection}
      >
        {correcting ? 'Applying correction…' : 'Confirm correction (pilot)'}
      </button>
      {correction !== null ? (
        <p className="meta-line">
          Correction applied. Resolved: <strong>{correction.resolved ? 'Yes' : 'No'}</strong> ·
          Comparison: {correction.comparison.overall} · Conflict:{' '}
          {correction.conflict.conflict ? 'still predicted' : 'cleared'}
        </p>
      ) : null}
    </section>
  );
}
