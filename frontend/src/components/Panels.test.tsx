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
      '205 seconds',
    );
    expect(screen.getByText('Last safe correction in').nextElementSibling?.textContent).toBe(
      '187 seconds',
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
        selectedId="missing-condition-descend-0"
        appliedId="missing-condition-descend-0"
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
        selectedId="missing-condition-descend-0"
        appliedId="missing-condition-descend-0"
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
    expect(valueOf('Original coordinator recommendation')).toBe('missing-condition-descend-0');
    expect(valueOf('Operator selection')).toBe('missing-condition-descend-0');
    expect(valueOf('Applied by pilot')).toBe('missing-condition-descend-0');
    expect(valueOf('Resolution status')).toBe('VERIFIED AND APPLIED');
    expect(valueOf('Conflict status')).toBe('CLEARED');
    expect(valueOf('Intent fingerprints')).toBe('ALL AGREE');
    expect(screen.queryByText(/No verified correction available/)).toBeNull();
  });
});

describe('Header presentation', () => {
  const baseProps = {
    offline: false,
    scenario: makeScenarios()[0],
    busy: false,
    hasDemo: false,
    onUseLiveChange: () => {},
    onRunDemo: () => {},
    onCorrect: () => {},
    onReset: () => {},
  };

  it('shows the title, tagline, and the single scenario without a selector', () => {
    const { container } = render(<Header {...baseProps} health={makeHealth(false)} useLive={false} />);
    expect(screen.getByText('ClearanceGuard AI')).not.toBeNull();
    expect(
      screen.getByText('Catches clearance mismatches before the aircraft acts on them.'),
    ).not.toBeNull();
    expect(
      screen.getByText('Altitude sync — pilot sets 22,000 ft, ATC cleared 23,000 ft'),
    ).not.toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('shows the connection word next to the status dot', () => {
    const { container, rerender } = render(
      <Header {...baseProps} health={makeHealth(false)} useLive={false} />,
    );
    const statusWord = (): string | null | undefined =>
      container.querySelector('.status-word')?.textContent;
    expect(container.querySelector('.status-dot')).not.toBeNull();
    expect(statusWord()).toBe('Simulation');
    rerender(<Header {...baseProps} health={makeHealth(true)} useLive />);
    expect(statusWord()).toBe('Live');
    rerender(<Header {...baseProps} health={null} offline useLive={false} />);
    expect(statusWord()).toBe('Offline');
  });

  it('keeps Meta API status out of the header', () => {
    render(<Header {...baseProps} health={makeHealth(false)} useLive={false} />);
    expect(screen.queryByText(/Meta API/)).toBeNull();
    expect(screen.queryByText(/Backend connected/)).toBeNull();
  });

  it('disables the Live pill option when the backend has no Meta API', () => {
    render(<Header {...baseProps} health={makeHealth(false)} useLive={false} />);
    const live = screen.getByRole('button', { name: 'Live' }) as HTMLButtonElement;
    expect(live.disabled).toBe(true);
    expect(live.title).toContain('Meta API unavailable');
    expect(
      screen.getByRole('button', { name: 'Simulation' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('enables the Live pill option when the backend reports it configured', () => {
    render(<Header {...baseProps} health={makeHealth(true)} useLive={false} />);
    const live = screen.getByRole('button', { name: 'Live' }) as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    expect(live.title).not.toContain('unavailable');
  });

  it('locks everything but Reset while the confirmation flow runs', () => {
    render(
      <Header
        {...baseProps}
        health={makeHealth(false)}
        useLive={false}
        hasDemo
        flowActive
      />,
    );
    expect(
      (screen.getByRole('button', { name: '▶ Run Demo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Pilot Correction' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('offers one primary run action with secondary correction and reset', () => {
    render(<Header {...baseProps} health={makeHealth(true)} useLive={false} />);
    const run = screen.getByRole('button', { name: '▶ Run Demo' });
    expect(run.className).toContain('btn-primary');
    expect(
      screen.getByRole('button', { name: 'Pilot Correction' }).className,
    ).toContain('btn-secondary');
    expect(screen.getByRole('button', { name: 'Reset' }).className).toContain(
      'btn-secondary',
    );
  });
});
