/** Result card, phrase helpers, and Evidence additions. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedText } from './components/AnimatedText';
import { EvidencePanel } from './components/EvidencePanel';
import { ResultPanel } from './components/ResultPanel';
import {
  fixAppliedPhrase,
  formatClearancePhrase,
  formatFmsPhrase,
  primaryAction,
} from './utils/clearancePhrases';
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
  makeMismatchConflict,
  makeMismatchMatrix,
  makeResolvedSafetyWindow,
  makeSafetyWindow,
  makeVerification,
} from './test/fixtures';

afterEach(() => {
  cleanup();
});

describe('clearance phrases', () => {
  it('headlines the conditioned descent over a leading speed instruction', () => {
    const demo = makeDemoResult();
    expect(demo.atc.actions[0].action_type).toBe('SPEED');
    expect(primaryAction(demo.atc.actions)?.action_type).toBe('DESCEND');
    expect(primaryAction(demo.fms.loaded_actions)?.action_type).toBe('DESCEND');
  });

  it('formats clearance phrases with and without timing', () => {
    const demo = makeDemoResult();
    expect(formatClearancePhrase(demo.atc)).toBe('Descend 15,000 ft after MERIT');
    expect(formatClearancePhrase(demo.pilot)).toBe('Descend 15,000 ft after MERIT');
  });

  it('formats the FMS immediate descent on a dropped condition', () => {
    const demo = makeDemoResult();
    expect(formatFmsPhrase(demo.fms, 'MISSING_CONDITION')).toBe('Descends immediately');
  });

  it('formats the FMS programmed value otherwise', () => {
    const correction = makeCorrectionResult();
    expect(formatFmsPhrase(correction.fms, null)).toBe('Descend 15,000 ft after MERIT');
  });

  it('describes the applied fix from the corrected clearance', () => {
    expect(fixAppliedPhrase(makeCorrectionResult())).toBe("Restored 'after MERIT' condition");
  });

});

describe('ResultPanel', () => {
  it('reports the predicted conflict with separation and a confirm action', () => {
    const onConfirm = vi.fn();
    render(
      <ResultPanel
        conflict={makeMismatchConflict()}
        comparison={makeMismatchMatrix()}
        correction={null}
        safety={makeSafetyWindow()}
        correcting={false}
        onConfirmCorrection={onConfirm}
      />,
    );
    expect(screen.getByText('Result')).not.toBeNull();
    expect(screen.getByText('Conflict in 205 s')).not.toBeNull();
    expect(screen.getByText('Separation').nextElementSibling?.textContent).toBe('650 ft');
    expect(screen.queryByText('Fix applied')).toBeNull();
    expect(screen.queryByText('Verified')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm correction' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('hides rows without backend values', () => {
    render(
      <ResultPanel
        conflict={makeMismatchConflict()}
        comparison={makeMismatchMatrix()}
        correction={null}
        safety={null}
        correcting={false}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.queryByText('Separation')).toBeNull();
    expect(screen.getByText('Conflict in 205 s')).not.toBeNull();
  });

  it('reports the cleared state with fix and verification rows', () => {
    const { container } = render(
      <ResultPanel
        conflict={makeClearConflict()}
        comparison={makeAgreeMatrix()}
        correction={makeCorrectionResult()}
        safety={makeResolvedSafetyWindow()}
        correcting={false}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.getByText('Conflict cleared ✓')).not.toBeNull();
    expect(
      container.querySelector('.result[data-verified="true"]'),
    ).not.toBeNull();
    expect(screen.getByText('Separation').nextElementSibling?.textContent).toBe('8,000 ft');
    expect(screen.getByText("Restored 'after MERIT' condition")).not.toBeNull();
    expect(screen.getByText('Readback, FMS and trajectory agree')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm correction' })).toBeNull();
  });

  it('reports MERIT sequencing after traffic from the simulation', () => {
    const { rerender } = render(
      <ResultPanel
        conflict={makeMismatchConflict()}
        comparison={makeMismatchMatrix()}
        correction={null}
        safety={makeSafetyWindow()}
        correcting={false}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.getByText('Timing').nextElementSibling?.textContent).toBe(
      'Crosses MERIT 125 s after traffic ✓',
    );

    rerender(
      <ResultPanel
        conflict={makeClearConflict()}
        comparison={makeAgreeMatrix()}
        correction={makeCorrectionResult()}
        safety={makeResolvedSafetyWindow()}
        correcting={false}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.getByText('Timing').nextElementSibling?.textContent).toBe(
      'Crosses MERIT 125 s after traffic ✓',
    );
  });

  it('hides Timing when a MERIT crossing is absent', () => {
    render(
      <ResultPanel
        conflict={{ ...makeMismatchConflict(), intruder_merit_time_s: null }}
        comparison={makeMismatchMatrix()}
        correction={null}
        safety={makeSafetyWindow()}
        correcting={false}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.queryByText('Timing')).toBeNull();
  });

  it('flags a mismatch without a predicted conflict', () => {
    render(
      <ResultPanel
        conflict={makeClearConflict()}
        comparison={makeMismatchMatrix()}
        correction={null}
        safety={makeSafetyWindow()}
        correcting={false}
        onConfirmCorrection={() => {}}
      />,
    );
    expect(screen.getByText('Mismatch — no conflict predicted')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Confirm correction' }),
    ).not.toBeNull();
  });
});

describe('AnimatedText', () => {
  it('shows the exact value on mount and eases to updates', async () => {
    const { rerender } = render(
      <AnimatedText value={215} format={(n) => `Conflict in ${Math.round(n)} s`} />,
    );
    expect(screen.getByText('Conflict in 215 s')).not.toBeNull();
    rerender(
      <AnimatedText value={180} format={(n) => `Conflict in ${Math.round(n)} s`} />,
    );
    await screen.findByText('Conflict in 180 s');
  });
});

describe('EvidencePanel additions', () => {
  function renderEvidence(overrides: Record<string, unknown> = {}) {
    const demo = makeDemoResult();
    return render(
      <EvidencePanel
        atc={demo.atc}
        pilot={demo.pilot}
        fms={demo.fms}
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
        {...overrides}
      />,
    );
  }

  it('keeps the judges cut and drops backend internals', () => {
    renderEvidence();
    expect(screen.getByText('ATC panel')).not.toBeNull();
    expect(screen.getByText('Pilot and FMS panel')).not.toBeNull();
    expect(screen.getByText('Clearance Integrity Matrix')).not.toBeNull();
    expect(screen.getByText('Safety window')).not.toBeNull();
    expect(screen.getByText('Candidate details')).not.toBeNull();
    expect(screen.getByText('Agent verification panel')).not.toBeNull();
    expect(screen.queryByText('Backend status')).toBeNull();
    expect(screen.queryByText('Technical JSON')).toBeNull();
    expect(screen.queryByText('Display id')).toBeNull();
    expect(screen.queryByText('Meta API')).toBeNull();
  });

  it('shows the SPEED comparison row from backend data', () => {
    renderEvidence();
    const section = screen.getByText('Clearance Integrity Matrix').closest('section');
    expect(section).not.toBeNull();
    const scoped = within(section as HTMLElement);
    expect(scoped.getByText('SPEED')).not.toBeNull();
    expect(scoped.getAllByText('250 kt now').length).toBe(4);
  });

  it('shows safety timing and the causal chain', () => {
    renderEvidence();
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toContain(
      '205 seconds',
    );
    expect(screen.getByText('Last safe correction in').nextElementSibling?.textContent).toBe(
      '187 seconds',
    );
    const section = screen.getByText('Safety window').closest('section');
    expect(section).not.toBeNull();
    const scoped = within(section as HTMLElement);
    expect(scoped.getByText('Causal chain')).not.toBeNull();
    expect(scoped.getByText('divergence', { exact: false })).not.toBeNull();
  });

  it('selects and marks the applied candidate', () => {
    const onSelect = vi.fn();
    renderEvidence({ onSelectCandidate: onSelect });
    const radio = screen.getByLabelText(/missing-condition-descend-0/);
    fireEvent.click(radio);
    expect(onSelect).toHaveBeenCalledWith('missing-condition-descend-0');
  });

  it('shows skeleton shimmer while the safety window loads', () => {
    const { container } = renderEvidence({ safety: null });
    expect(container.querySelectorAll('.skeleton-line').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the applied marker and verification outcome', () => {
    renderEvidence({
      onSelectCandidate: () => {},
      selectedId: 'missing-condition-descend-0',
      appliedId: 'missing-condition-descend-0',
      correction: makeCorrectionResult(),
      verification: makeVerification(),
    });
    expect(screen.getByText('Applied')).not.toBeNull();
    expect(screen.getByText('VERIFIED')).not.toBeNull();
  });
});
