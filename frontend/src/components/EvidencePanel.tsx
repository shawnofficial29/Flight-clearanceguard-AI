import type {
  AuditEvent,
  AuditVerify,
  Clearance,
  ComparisonMatrix,
  ConflictPrediction,
  CoordinationResult,
  CorrectionResult,
  Fingerprints,
  FMSProgram,
  Health,
  ResolutionCandidate,
  SafetyWindow,
  VerificationResult,
} from '../api/types';
import { formatSeconds, safetyMargin } from '../utils/demoLabels';
import { AgentPanel } from './AgentPanel';
import { AtcPanel } from './AtcPanel';
import { AudioPanel } from './AudioPanel';
import { MatrixPanel } from './MatrixPanel';
import { PilotFmsPanel } from './PilotFmsPanel';

interface EvidenceProps {
  atc: Clearance | null;
  pilot: Clearance | null;
  fms: FMSProgram | null;
  comparison: ComparisonMatrix | null;
  conflict: ConflictPrediction | null;
  safety: SafetyWindow | null;
  candidates: ResolutionCandidate[] | null;
  coordination: CoordinationResult | null;
  fingerprints: Fingerprints | null;
  audit: AuditVerify | null;
  auditEvents: AuditEvent[] | null;
  selectedId: string | null;
  appliedId: string | null;
  correction: CorrectionResult | null;
  verification: VerificationResult | null;
  active: boolean;
  useLive: boolean;
  voiceConfigured: boolean | null;
  offline: boolean;
  health?: Health | null;
  /** Enables candidate selection here when provided. */
  onSelectCandidate?: (id: string) => void;
  verifying?: boolean;
}

/**
 * Native expandable region for judges: transcripts, matrix, safety window,
 * the applied fix, and the audit trail. Content stays mounted (but hidden)
 * so detail links and tests resolve without custom focus code.
 */
export function EvidencePanel(props: EvidenceProps): React.JSX.Element {
  const {
    atc,
    pilot,
    fms,
    comparison,
    conflict,
    safety,
    candidates,
    coordination,
    fingerprints,
    audit,
    auditEvents,
    selectedId,
    appliedId,
    correction,
    verification,
    active,
    useLive,
    voiceConfigured,
    offline,
    onSelectCandidate,
    verifying = false,
  } = props;
  const margin = safetyMargin(
    conflict?.first_conflict_time_s,
    safety?.last_safe_correction_s,
  );
  return (
    <details className="evidence">
      <summary>
        Evidence: transcripts, matrix, safety window, fix, audit
      </summary>
      <div className="evidence-grid">
        <MatrixPanel comparison={comparison} />
        <section className="panel">
          <h2>Safety window</h2>
          {conflict === null && safety === null ? (
            <p className="empty">Run the demo to load the safety window.</p>
          ) : (
            <>
              <dl className="facts">
                <dt>Conflict predicted in</dt>
                <dd>
                  {conflict?.first_conflict_time_s === null ||
                  conflict?.first_conflict_time_s === undefined
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
                <dd>
                  {safety?.basis ?? (
                    <span className="skeleton skeleton-line" title="Loading…" />
                  )}
                </dd>
              </dl>
              <h3>Causal chain</h3>
              {safety === null ? (
                <div role="status" aria-label="Loading safety window">
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line short" />
                </div>
              ) : (
                <ol>
                  {safety.causal_chain.map((step) => (
                    <li key={step.step}>
                      <strong>{step.stage}</strong>: {step.detail}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
        <AtcPanel clearance={atc} />
        <PilotFmsPanel pilot={pilot} fms={fms} comparison={comparison} />
        <section className="panel">
          <h2>Candidate details</h2>
          {candidates === null ? (
            <p className="empty">Run the demo to load resolution candidates.</p>
          ) : candidates.length === 0 ? (
            <p className="empty">No candidates enumerated.</p>
          ) : onSelectCandidate === undefined ? (
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Action</th>
                  <th>Min lateral</th>
                  <th>Min vertical</th>
                  <th>Safe reason</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>{candidate.id}</td>
                    <td>{candidate.action_human}</td>
                    <td>{candidate.min_lateral_nm} NM</td>
                    <td>{candidate.min_vertical_ft} ft</td>
                    <td>{candidate.safe_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <p className="meta-line">
                    Min lateral {candidate.min_lateral_nm} NM · Min vertical{' '}
                    {candidate.min_vertical_ft} ft
                  </p>
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
        </section>
        <AgentPanel
          coordination={coordination}
          fingerprints={fingerprints}
          audit={audit}
          auditEvents={auditEvents}
          selectedId={selectedId}
          appliedId={appliedId}
          correction={correction}
          verification={verification}
          active={active}
        />
        <AudioPanel useLive={useLive} voiceConfigured={voiceConfigured} offline={offline} />
      </div>
    </details>
  );
}
