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
  makeSyncDemo,
} from './test/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DemoStepper', () => {
  it('shows three pending sync steps with no demo', () => {
    render(<DemoStepper demo={null} />);
    expect(screen.getByText('Mismatch caught')).not.toBeNull();
    expect(screen.getByText('ATC confirmed')).not.toBeNull();
    expect(screen.getByText('Pilot verified')).not.toBeNull();
    expect(screen.getByText('Awaiting demo')).not.toBeNull();
    expect(screen.getByText('Awaiting ATC confirmation')).not.toBeNull();
    expect(screen.getByText('Awaiting pilot verification')).not.toBeNull();
  });

  it('marks the caught mismatch from the demo run', () => {
    render(
      <DemoStepper
        demo={makeSyncDemo()}
        sync={{ stage: 'atc', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: null }}
      />,
    );
    expect(screen.getByText('set 22,000, cleared 23,000')).not.toBeNull();
    expect(screen.getByText('Awaiting ATC confirmation')).not.toBeNull();
  });

  it('marks ATC confirmed and pilot verified from sync state', () => {
    render(
      <DemoStepper
        demo={makeSyncDemo()}
        sync={{ stage: 'done', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: 23000 }}
      />,
    );
    expect(screen.getByText('23,000 is correct')).not.toBeNull();
    expect(screen.getByText('everyone agrees')).not.toBeNull();
  });

  it('fills the tracker and draws checks on completed steps', () => {
    const { container } = render(
      <DemoStepper
        demo={makeSyncDemo()}
        sync={{ stage: 'done', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: 23000 }}
      />,
    );
    const fill = container.querySelector('.stepper-fill') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe('100%');
    expect(fill?.className).toContain('is-complete');
    expect(container.querySelectorAll('.step-check').length).toBe(3);
  });

  it('advances the tracker halfway once ATC confirms', () => {
    const { container } = render(
      <DemoStepper
        demo={makeSyncDemo()}
        sync={{ stage: 'pilot', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: 23000 }}
      />,
    );
    const fill = container.querySelector('.stepper-fill') as HTMLElement | null;
    expect(fill?.style.width).toBe('50%');
    expect(fill?.className).not.toContain('is-complete');
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
        atc={makeDemoResult().atc}
        pilot={makeDemoResult().pilot}
        fms={makeDemoResult().fms}
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
        atc={makeDemoResult().atc}
        pilot={makeDemoResult().pilot}
        fms={makeDemoResult().fms}
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
        atc={makeDemoResult().atc}
        pilot={makeCorrectionResult().corrected_pilot}
        fms={makeCorrectionResult().fms}
      />,
    );
    expect(screen.getByText('CLEARANCE SYNCHRONIZED')).not.toBeNull();
    expect(screen.getByText('CONFLICT CLEARED')).not.toBeNull();
  });
});

describe('IntentCompare', () => {
  it('summarizes ATC, pilot, and FMS without raw category codes', () => {
    render(<IntentCompare comparison={makeMismatchMatrix()} />);
    expect(screen.getByText('DESCEND')).not.toBeNull();
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

  it('keeps the judges evidence mounted behind a native collapsed summary', () => {
    renderEvidence();
    const summary = screen.getByText(/Evidence: transcripts, matrix, safety window, fix, audit/);
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(screen.getByText('Clearance Integrity Matrix')).not.toBeNull();
    expect(screen.getByText('ATC panel')).not.toBeNull();
    expect(screen.getByText('Agent verification panel')).not.toBeNull();
    expect(screen.getByText('Candidate details')).not.toBeNull();
    expect(screen.queryByText('Technical JSON')).toBeNull();
  });

  it('exposes candidate details without duplicating the selection control', () => {
    renderEvidence();
    // Without a selection handler the table stays read-only.
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('missing-condition-descend-0')).not.toBeNull();
  });

  it('hosts the single candidate selection control when wired', () => {
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
        onSelectCandidate={() => {}}
      />,
    );
    expect(screen.getAllByRole('radio').length).toBe(1);
    expect(screen.getByText('missing-condition-descend-0')).not.toBeNull();
  });

  it('keeps the safety window in Evidence without backend status', () => {
    renderEvidence();
    expect(screen.queryByText('Backend status')).toBeNull();
    expect(screen.getByText('Safety window')).not.toBeNull();
    expect(screen.getByText('Causal chain')).not.toBeNull();
    expect(screen.getByText('Conflict predicted in')).not.toBeNull();
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
    await screen.findByText('Altitude sync — pilot sets 22,000 ft, ATC cleared 23,000 ft');
    expect(
      screen.getByText('One misheard number can put the aircraft at the wrong altitude.'),
    ).not.toBeNull();
    expect(screen.getByText('Run the demo to see ClearanceGuard catch it.')).not.toBeNull();
    expect(screen.getByText('The scenario: one misunderstood number')).not.toBeNull();
    expect(screen.getByText('One scenario is loaded.')).not.toBeNull();
    expect(screen.getByText('Ready to run')).not.toBeNull();
    expect(screen.getAllByText('▶ Run Demo').length).toBe(1);
  });
});
