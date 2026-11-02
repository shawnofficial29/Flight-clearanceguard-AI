/** Redesign coverage: stepper, alert, comparison, evidence, empty state. */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AlertCard } from './components/AlertCard';
import { DemoStepper } from './components/DemoStepper';
import { EvidencePanel } from './components/EvidencePanel';
import { IntentCompare } from './components/IntentCompare';
import {
  makeAgreeMatrix,
  makeAuditEvents,
  makeAuditVerify,
  makeCandidates,
  makeClearConflict,
  makeCoordination,
  makeCorrectionResult,
  makeDemoResult,
  makeFingerprints,
  makeHealth,
  makeMismatchConflict,
  makeMismatchMatrix,
  makeSafetyWindow,
  makeScenarios,
} from './test/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DemoStepper', () => {
  it('shows three pending steps with no demo', () => {
    render(<DemoStepper demo={null} correction={null} />);
    expect(screen.getByText('Mismatch Detected')).not.toBeNull();
    expect(screen.getByText('Conflict Predicted')).not.toBeNull();
    expect(screen.getByText('Verified Resolution')).not.toBeNull();
    expect(screen.getAllByText('Awaiting demo').length).toBe(2);
  });

  it('marks mismatch and conflict from the original demo run', () => {
    render(<DemoStepper demo={makeDemoResult()} correction={null} />);
    expect(screen.getByText('Matrix: mismatch')).not.toBeNull();
    expect(screen.getByText('T+215 s')).not.toBeNull();
    expect(screen.getByText('Awaiting pilot confirmation')).not.toBeNull();
  });

  it('marks resolution done after a verified correction', () => {
    render(<DemoStepper demo={makeDemoResult()} correction={makeCorrectionResult()} />);
    expect(screen.getByText('Pilot confirmed, verified')).not.toBeNull();
  });
});

describe('AlertCard', () => {
  it('shows conflict predicted for a mismatch with conflict', () => {
    render(
      <AlertCard
        demo={makeDemoResult()}
        correction={null}
        comparison={makeMismatchMatrix()}
        conflict={makeMismatchConflict()}
      />,
    );
    expect(screen.getByText('CONFLICT PREDICTED')).not.toBeNull();
  });

  it('shows mismatch without conflict when none is predicted', () => {
    render(
      <AlertCard
        demo={makeDemoResult()}
        correction={null}
        comparison={makeMismatchMatrix()}
        conflict={makeClearConflict()}
      />,
    );
    expect(screen.getByText('MISMATCH DETECTED')).not.toBeNull();
  });

  it('shows synchronized and cleared after a verified correction', () => {
    render(
      <AlertCard
        demo={makeDemoResult()}
        correction={makeCorrectionResult()}
        comparison={makeAgreeMatrix()}
        conflict={makeClearConflict()}
      />,
    );
    expect(screen.getByText('CLEARANCE SYNCHRONIZED')).not.toBeNull();
    expect(screen.getByText('CONFLICT CLEARED')).not.toBeNull();
  });
});

describe('IntentCompare', () => {
  it('summarizes ATC, pilot, and FMS without raw category codes', () => {
    render(<IntentCompare comparison={makeMismatchMatrix()} />);
    expect(screen.getByText('CLIMB')).not.toBeNull();
    expect(screen.queryByText('MISSING_CONDITION')).toBeNull();
  });
});

describe('EvidencePanel', () => {
  function renderEvidence(): void {
    render(
      <EvidencePanel
        atc={makeDemoResult().atc}
        pilot={makeDemoResult().pilot}
        fms={makeDemoResult().fms}
        comparison={makeMismatchMatrix()}
        conflict={makeMismatchConflict()}
        safety={makeSafetyWindow()}
        candidates={makeCandidates()}
        coordination={makeCoordination()}
        fingerprints={makeFingerprints(false)}
        audit={makeAuditVerify(7)}
        auditEvents={makeAuditEvents()}
        selectedId={null}
        appliedId={null}
        correction={null}
        verification={null}
        active
        useLive={false}
        voiceConfigured={false}
        offline={false}
      />,
    );
  }

  it('keeps full evidence mounted behind a native collapsed summary', () => {
    renderEvidence();
    const summary = screen.getByText(/Evidence: full technical details/);
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(screen.getByText('Clearance Integrity Matrix')).not.toBeNull();
    expect(screen.getByText('ATC panel')).not.toBeNull();
    expect(screen.getByText('Agent verification panel')).not.toBeNull();
    expect(screen.getByText('Candidate details')).not.toBeNull();
    expect(screen.getByText('Technical JSON')).not.toBeNull();
  });

  it('exposes candidate details without duplicating the selection control', () => {
    renderEvidence();
    // Selection radios live once in the right rail, not in Evidence.
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('missing-condition-climb-0')).not.toBeNull();
  });
});

describe('empty state', () => {
  it('shows one prompt, the scenario line, and a single Run Demo action', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const data = url.endsWith('/health')
        ? makeHealth(false)
        : { scenarios: makeScenarios() };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    render(<App />);
    await screen.findByText('Backend connected');
    expect(
      screen.getByText('One omitted condition can change the aircraft trajectory.'),
    ).not.toBeNull();
    expect(screen.getByText('Run the demo to see ClearanceGuard catch it.')).not.toBeNull();
    expect(screen.getByText(/Scenario early-climb/)).not.toBeNull();
    expect(screen.getByText('Ready to run')).not.toBeNull();
    expect(screen.getAllByText('Run Demo').length).toBe(1);
  });
});
