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
  ResolutionCandidate,
  SafetyWindow,
  VerificationResult,
} from '../api/types';
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
}

/**
 * Native expandable region for full technical evidence. Content stays mounted
 * (but hidden) so detail links and tests resolve without custom focus code.
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
  } = props;
  const technical =
    comparison === null && conflict === null && safety === null
      ? 'No data.'
      : JSON.stringify({ comparison, conflict, safety }, null, 2);
  return (
    <details className="evidence">
      <summary>
        Evidence: full technical details (matrix, transcripts, tool trace, fingerprints,
        audit)
      </summary>
      <div className="evidence-grid">
        <MatrixPanel comparison={comparison} />
        <AtcPanel clearance={atc} />
        <PilotFmsPanel pilot={pilot} fms={fms} comparison={comparison} />
        <section className="panel">
          <h2>Candidate details</h2>
          {candidates === null ? (
            <p className="empty">Run the demo to load resolution candidates.</p>
          ) : candidates.length === 0 ? (
            <p className="empty">No candidates enumerated.</p>
          ) : (
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
          )}
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
        <section className="panel">
          <h2>Technical JSON</h2>
          <details>
            <summary>Comparison, conflict, safety window</summary>
            <pre>{technical}</pre>
          </details>
        </section>
      </div>
    </details>
  );
}
