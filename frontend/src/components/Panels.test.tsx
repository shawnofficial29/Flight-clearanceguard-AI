import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
});
import { AgentPanel } from './AgentPanel';
import { Header } from './Header';
import { SafetyPanel } from './SafetyPanel';
import {
  makeAuditEvents,
  makeAuditVerify,
  makeCandidates,
  makeClearConflict,
  makeCoordination,
  makeCorrectionResult,
  makeFingerprints,
  makeHealth,
  makeLiveCoordination,
  makeMismatchConflict,
  makeResolvedSafetyWindow,
  makeSafetyWindow,
  makeScenarios,
  makeVerification,
} from '../test/fixtures';

describe('SafetyPanel timing labels', () => {
  it('shows conflict, last-safe, and margin in seconds', () => {
    render(
      <SafetyPanel
        conflict={makeMismatchConflict()}
        safety={makeSafetyWindow()}
        candidates={makeCandidates()}
        selectedId={null}
        appliedId={null}
        verification={null}
        verifying={false}
        correcting={false}
        correction={null}
        onSelectCandidate={() => {}}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toContain(
      '215 seconds',
    );
    expect(screen.getByText('Last safe correction in').nextElementSibling?.textContent).toBe(
      '197 seconds',
    );
    expect(
      screen.getByText('Safety margin between last correction and conflict').nextElementSibling
        ?.textContent,
    ).toBe('18 seconds');
    expect(screen.queryByText(/remaining/)).toBeNull();
  });

  it('shows no active conflict and the applied marker after correction', () => {
    const noop = (): void => {};
    render(
      <SafetyPanel
        conflict={makeClearConflict()}
        safety={makeResolvedSafetyWindow()}
        candidates={makeCandidates()}
        selectedId="missing-condition-climb-0"
        appliedId="missing-condition-climb-0"
        verification={makeVerification()}
        verifying={false}
        correcting={false}
        correction={makeCorrectionResult()}
        onSelectCandidate={noop}
        onConfirmCorrection={noop}
      />,
    );
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toBe(
      'No conflict predicted',
    );
    expect(screen.getByText('Applied')).not.toBeNull();
  });
});

describe('AgentPanel presentation', () => {
  it('shows compact steps and hides JSON inside collapsed details', () => {
    render(
      <AgentPanel
        coordination={makeCoordination()}
        fingerprints={makeFingerprints(false)}
        audit={makeAuditVerify(7)}
        auditEvents={makeAuditEvents()}
        selectedId={null}
        appliedId={null}
        correction={null}
        verification={null}
        active
      />,
    );
    expect(screen.getByText('Step 1:', { exact: false })).not.toBeNull();
    expect(screen.getByText('compare_intents')).not.toBeNull();
    const details = screen.getAllByText('Technical output');
    expect(details.length).toBeGreaterThan(0);
    for (const summary of details) {
      expect(summary.closest('details')?.hasAttribute('open')).toBe(false);
    }
    expect(screen.getByText(/simulated-pilot-confirmed/)).not.toBeNull();
  });

  it('shows zero-length audit after reset without demo data', () => {
    render(
      <AgentPanel
        coordination={null}
        fingerprints={null}
        audit={makeAuditVerify(0)}
        auditEvents={[]}
        selectedId={null}
        appliedId={null}
        correction={null}
        verification={null}
        active={false}
      />,
    );
    expect(screen.getByText('Length').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('No audit events recorded.')).not.toBeNull();
    expect(screen.getAllByText('No data.').length).toBeGreaterThan(0);
  });

  it('shows the final resolution state after the pilot applies a candidate', () => {
    render(
      <AgentPanel
        coordination={makeLiveCoordination()}
        fingerprints={makeFingerprints(true)}
        audit={makeAuditVerify(14)}
        auditEvents={makeAuditEvents()}
        selectedId="missing-condition-climb-0"
        appliedId="missing-condition-climb-0"
        correction={makeCorrectionResult()}
        verification={makeVerification()}
        active
      />,
    );
    expect(screen.getByText(/Live Meta API/)).not.toBeNull();
    const block = screen.getByText('Final resolution state').closest('div');
    if (block === null) throw new Error('Missing final resolution block.');
    const scoped = within(block);
    const valueOf = (label: string): string | null =>
      scoped.getByText(label).nextElementSibling?.textContent ?? null;
    expect(valueOf('Original coordinator recommendation')).toBe('missing-condition-climb-0');
    expect(valueOf('Operator selection')).toBe('missing-condition-climb-0');
    expect(valueOf('Applied by pilot')).toBe('missing-condition-climb-0');
    expect(valueOf('Resolution status')).toBe('VERIFIED AND APPLIED');
    expect(valueOf('Conflict status')).toBe('CLEARED');
    expect(valueOf('Intent fingerprints')).toBe('ALL AGREE');
    expect(screen.queryByText(/No verified correction available/)).toBeNull();
  });
});

describe('Header live gating', () => {
  const baseProps = {
    offline: false,
    scenarios: makeScenarios(),
    scenarioId: 'early-climb',
    busy: false,
    hasDemo: false,
    onScenarioChange: () => {},
    onUseLiveChange: () => {},
    onRunDemo: () => {},
    onCorrect: () => {},
    onReset: () => {},
  };

  it('disables Live Meta with a message when the backend has no Meta API', () => {
    render(<Header {...baseProps} health={makeHealth(false)} useLive={false} />);
    expect(screen.getByText('Fixture Simulation')).not.toBeNull();
    const live = screen.getByLabelText('Live Meta') as HTMLInputElement;
    expect(live.disabled).toBe(true);
    expect(live.checked).toBe(false);
    expect(screen.getByText('Meta API unavailable in backend process.')).not.toBeNull();
  });

  it('enables Live Meta when the backend reports it configured', () => {
    render(<Header {...baseProps} health={makeHealth(true)} useLive={false} />);
    expect((screen.getByLabelText('Live Meta') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText('Meta API unavailable in backend process.')).toBeNull();
  });
});
