import {
  PROVENANCE_LABELS,
  type AuditEvent,
  type AuditVerify,
  type CoordinationResult,
  type CorrectionResult,
  type Fingerprints,
  type VerificationResult,
} from '../api/types';
import { formatTechnicalOutput, summarizeToolCall } from '../utils/demoLabels';

interface AgentPanelProps {
  coordination: CoordinationResult | null;
  fingerprints: Fingerprints | null;
  audit: AuditVerify | null;
  auditEvents: AuditEvent[] | null;
  selectedId: string | null;
  appliedId: string | null;
  correction: CorrectionResult | null;
  verification: VerificationResult | null;
  active: boolean;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

function resolutionStatus(
  coordination: CoordinationResult,
  verification: VerificationResult | null,
  appliedId: string,
  correction: CorrectionResult,
): string {
  if (!correction.resolved) return 'NOT RESOLVED';
  // The coordinator only ever recommends VERIFIED candidate ids, and the
  // operator verify call confirms the selected one explicitly.
  const verified =
    coordination.recommended_candidate_id === appliedId ||
    (verification !== null &&
      verification.candidate_id === appliedId &&
      verification.verified);
  return verified ? 'VERIFIED AND APPLIED' : 'APPLIED';
}

export function AgentPanel(props: AgentPanelProps): React.JSX.Element {
  const {
    coordination,
    fingerprints,
    audit,
    auditEvents,
    selectedId,
    appliedId,
    correction,
    verification,
    active,
  } = props;
  if (coordination === null && audit === null) {
    return (
      <section className="panel">
        <h2>Agent verification panel</h2>
        <p className="empty">Run the demo to load coordinator verification.</p>
      </section>
    );
  }
  const pending = active ? 'Loading…' : 'No data.';
  const orderedCalls =
    coordination === null
      ? []
      : [...coordination.tool_calls].sort((a, b) => a.turn - b.turn);
  return (
    <section className="panel">
      <h2>Agent verification panel</h2>
      {coordination === null ? (
        <p className="empty">{pending}</p>
      ) : (
        <div>
          <p className="meta-line">
            Provenance: {PROVENANCE_LABELS[coordination.provenance]} · Model:{' '}
            {coordination.model} · Overridden: {coordination.overridden ? 'Yes' : 'No'}
          </p>
          <h3>Native Meta tool calls (in order)</h3>
          {orderedCalls.length === 0 ? (
            <p className="empty">No tool calls recorded.</p>
          ) : (
            <ol>
              {orderedCalls.map((call, index) => (
                <li key={`${call.turn}-${call.tool}-${index}`}>
                  Step {call.turn}: <strong>{call.tool}</strong> [
                  {call.ok ? 'ok' : 'failed'}] — {summarizeToolCall(call.summary)}
                  <details>
                    <summary>Technical output</summary>
                    <pre>{formatTechnicalOutput(call.summary)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
          <h3>Selected verified candidate</h3>
          <p>
            Coordinator recommendation: {coordination.recommended_candidate_id ?? 'None'}
            {selectedId !== null ? ` · Operator selection: ${selectedId}` : null}
            {appliedId !== null ? ` · Applied by pilot: ${appliedId}` : null}
          </p>
          <p className="meta-line">{coordination.summary}</p>
          <p className="meta-line">{coordination.rationale}</p>
          {coordination.note !== null ? (
            <p className="meta-line">Note: {coordination.note}</p>
          ) : null}
          {correction !== null && appliedId !== null ? (
            <div>
              <h3>Final resolution state</h3>
              <dl className="facts">
                <dt>Original coordinator recommendation</dt>
                <dd>{coordination.recommended_candidate_id ?? 'None'}</dd>
                <dt>Operator selection</dt>
                <dd>{selectedId ?? 'None'}</dd>
                <dt>Applied by pilot</dt>
                <dd>{appliedId}</dd>
                <dt>Resolution status</dt>
                <dd>{resolutionStatus(coordination, verification, appliedId, correction)}</dd>
                <dt>Conflict status</dt>
                <dd>
                  {correction.resolved && !correction.conflict.conflict
                    ? 'CLEARED'
                    : 'STILL PREDICTED'}
                </dd>
                <dt>Intent fingerprints</dt>
                <dd>
                  {fingerprints === null
                    ? '—'
                    : fingerprints.all_agree
                      ? 'ALL AGREE'
                      : 'NOT AGREED'}
                </dd>
              </dl>
            </div>
          ) : null}
        </div>
      )}
      <h3>Intent fingerprints</h3>
      {fingerprints === null ? (
        <p className="empty">{pending}</p>
      ) : (
        <dl className="facts">
          <dt>ATC</dt>
          <dd>{shortHash(fingerprints.atc)}</dd>
          <dt>Pilot</dt>
          <dd>{shortHash(fingerprints.pilot)}</dd>
          <dt>FMS</dt>
          <dd>{shortHash(fingerprints.fms)}</dd>
          <dt>All agree</dt>
          <dd>{fingerprints.all_agree ? 'Yes' : 'No'}</dd>
          <dt>Display id</dt>
          <dd>{fingerprints.display_id}</dd>
        </dl>
      )}
      <h3>Audit-chain validity</h3>
      {audit === null ? (
        <p className="empty">{pending}</p>
      ) : (
        <dl className="facts">
          <dt>Valid</dt>
          <dd>{audit.valid ? 'Yes' : 'No'}</dd>
          <dt>Length</dt>
          <dd>{audit.length}</dd>
          <dt>Head</dt>
          <dd>{audit.head === null ? '—' : shortHash(audit.head)}</dd>
          <dt>First bad seq</dt>
          <dd>{audit.first_bad_seq === null ? '—' : audit.first_bad_seq}</dd>
        </dl>
      )}
      <h3>Recent audit events</h3>
      {auditEvents === null ? (
        <p className="empty">{pending}</p>
      ) : auditEvents.length === 0 ? (
        <p className="empty">No audit events recorded.</p>
      ) : (
        <ol>
          {auditEvents.slice(-6).map((event) => (
            <li key={event.seq}>
              #{event.seq} <strong>{event.type}</strong> [{event.provenance}] —{' '}
              {event.human_confirmation}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
