/** Full sync-loop sequence against mocked backend responses. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  makeAuditEvents,
  makeAuditVerify,
  makeFingerprints,
  makeHealth,
  makeScenarios,
  makeSyncCandidates,
  makeSyncCoordination,
  makeSyncCorrection,
  makeSyncDemo,
  makeSyncLiveCoordination,
  makeSyncResolvedSafetyWindow,
  makeSyncSafetyWindow,
  makeSyncVerification,
} from './test/fixtures';

const SYNC_TITLE = 'Altitude sync — pilot sets 22,000 ft, ATC cleared 23,000 ft';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bodyOf(init?: RequestInit): Record<string, never> {
  if (typeof init?.body !== 'string') return {};
  return JSON.parse(init.body) as Record<string, never>;
}

function isCorrectedTriple(init?: RequestInit): boolean {
  const body = bodyOf(init) as { fms?: { source?: string } };
  return body.fms?.source === 'corrected';
}

function installFetch(options: { live: boolean }): { coordinateCalls: number } {
  const demo = makeSyncDemo();
  const correction = makeSyncCorrection();
  const coordination = options.live ? makeSyncLiveCoordination() : makeSyncCoordination();
  const counts = { coordinateCalls: 0 };
  let resetDone = false;
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/health')) return jsonResponse(makeHealth(options.live));
    if (url.endsWith('/api/scenarios')) return jsonResponse({ scenarios: makeScenarios() });
    if (url.endsWith('/api/demo/run')) return jsonResponse(demo);
    if (url.endsWith('/api/demo/correct')) return jsonResponse(correction);
    if (url.endsWith('/api/safety/window')) {
      return jsonResponse(
        isCorrectedTriple(init) ? makeSyncResolvedSafetyWindow() : makeSyncSafetyWindow(),
      );
    }
    if (url.endsWith('/api/resolutions/enumerate')) return jsonResponse(makeSyncCandidates());
    if (url.endsWith('/api/resolutions/verify')) return jsonResponse(makeSyncVerification());
    if (url.endsWith('/api/fingerprints')) {
      return jsonResponse(makeFingerprints(isCorrectedTriple(init)));
    }
    if (url.endsWith('/api/coordinate')) {
      counts.coordinateCalls += 1;
      return jsonResponse(coordination);
    }
    if (url.endsWith('/api/audit/events')) {
      return jsonResponse(resetDone ? [] : makeAuditEvents());
    }
    if (url.endsWith('/api/audit/verify')) {
      return jsonResponse(makeAuditVerify(resetDone ? 0 : 7));
    }
    if (url.endsWith('/api/session/reset')) {
      resetDone = true;
      return jsonResponse({ status: 'reset' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  vi.stubGlobal('fetch', handler);
  return counts;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('demo transition', () => {
  it('runs mismatch, ATC confirm, pilot verify, then resets to empty', async () => {
    const counts = installFetch({ live: false });
    render(<App />);

    await screen.findByText(SYNC_TITLE);
    expect(
      (screen.getByRole('button', { name: 'Live' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '▶ Run Demo' }));
    await screen.findByText('CHANGED_VALUE');
    // ATC is asked first while the cockpit waits; manual correction locks.
    expect(
      screen.getByText('META 452 set 22,000. You cleared 23,000. Which is correct?'),
    ).not.toBeNull();
    expect(screen.getByText('Waiting for ATC to confirm…')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Pilot Correction' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText('set 22,000, cleared 23,000')).not.toBeNull();
    expect(screen.getByText('Conflict in 165 s')).not.toBeNull();
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toContain(
      '165 seconds',
    );
    expect(screen.getByText('Timing').nextElementSibling?.textContent).toBe(
      'Crosses MERIT 88 s after traffic ✓',
    );

    fireEvent.click(screen.getByLabelText(/changed-value-maintain-0/));
    await screen.findByText('VERIFIED');

    // ATC confirms 23,000, then the pilot verifies through the same flow.
    fireEvent.click(screen.getByText('23,000 ✓'));
    await screen.findByText('ATC confirmed 23,000. You set 22,000.');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('Applied');
    expect(screen.getAllByText('Clearance synchronized ✓ 23,000 ft')).toHaveLength(2);
    expect(document.querySelectorAll('.sync-strip .num-ok')).toHaveLength(2);
    expect(screen.getByText('23,000 is correct')).not.toBeNull();
    expect(screen.getByText('everyone agrees')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'After' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // Every panel describes the corrected state.
    const matrix = screen.getByText('Clearance Integrity Matrix').closest('section');
    expect(matrix).not.toBeNull();
    expect(within(matrix as HTMLElement).getByText('agree')).not.toBeNull();
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toBe(
      'No conflict predicted',
    );
    expect(screen.queryByText('Display id')).toBeNull();
    expect(screen.getByText(/Applied by pilot:/)).not.toBeNull();
    // The original coordinator result is preserved, not rerun after correction.
    expect(counts.coordinateCalls).toBe(1);
    expect(screen.getByText(/Comparison is mismatch/)).not.toBeNull();
    expect(screen.queryByText(/No verified correction available/)).toBeNull();
    const block = screen.getByText('Final resolution state').closest('div');
    if (block === null) throw new Error('Missing final resolution block.');
    const scoped = within(block);
    const valueOf = (label: string): string | null =>
      scoped.getByText(label).nextElementSibling?.textContent ?? null;
    expect(valueOf('Resolution status')).toBe('VERIFIED AND APPLIED');
    expect(valueOf('Conflict status')).toBe('CLEARED');
    expect(valueOf('Intent fingerprints')).toBe('ALL AGREE');
    expect(screen.getByText(/simulated-pilot-confirmed/)).not.toBeNull();
    expect(screen.getByText('Corrected route (executed)')).not.toBeNull();
    expect(screen.getByText('Corrected trajectory (executed)')).not.toBeNull();
    expect(screen.getByText('Pre-correction trajectory')).not.toBeNull();
    expect(screen.getByText('Conflict cleared ✓')).not.toBeNull();
    // The separation readout counts up to the corrected value.
    await screen.findByText('1,000 ft');
    expect(screen.getByText("Restored '23,000 ft'")).not.toBeNull();
    expect(screen.getByText('Readback, FMS and trajectory agree')).not.toBeNull();

    fireEvent.click(screen.getByText('Reset'));
    await screen.findByText('Run the demo to load the ATC clearance.');
    expect(screen.queryByText('changed-value-maintain-0')).toBeNull();
    expect(screen.queryByText('Applied')).toBeNull();
    expect(screen.getByText('No audit events recorded.')).not.toBeNull();
    expect(screen.getByText('Length').nextElementSibling?.textContent).toBe('0');
  });

  it('shows the single scenario with no selector', async () => {
    installFetch({ live: false });
    render(<App />);
    await screen.findByText(SYNC_TITLE);
    const header = screen.getByRole('banner');
    expect(header.querySelector('select')).toBeNull();
  });

  it('keeps the live coordinator result after the pilot verifies', async () => {
    const counts = installFetch({ live: true });
    render(<App />);
    await screen.findByText(SYNC_TITLE);

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    fireEvent.click(screen.getByRole('button', { name: '▶ Run Demo' }));
    await screen.findByText('CHANGED_VALUE');
    expect(screen.getByText(/Live Meta API/)).not.toBeNull();

    fireEvent.click(screen.getByLabelText(/changed-value-maintain-0/));
    await screen.findByText('VERIFIED');

    fireEvent.click(screen.getByText('23,000 ✓'));
    await screen.findByText('ATC confirmed 23,000. You set 22,000.');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('Applied');

    // No rerun: the live recommendation, provenance, and tool trace remain.
    expect(counts.coordinateCalls).toBe(1);
    expect(screen.getByText(/Live Meta API/)).not.toBeNull();
    const liveBlock = screen.getByText('Final resolution state').closest('div');
    if (liveBlock === null) throw new Error('Missing final resolution block.');
    const liveScoped = within(liveBlock);
    const liveValueOf = (label: string): string | null =>
      liveScoped.getByText(label).nextElementSibling?.textContent ?? null;
    expect(liveValueOf('Original coordinator recommendation')).toBe(
      'changed-value-maintain-0',
    );
    expect(screen.getByText('Step 1:', { exact: false })).not.toBeNull();
    expect(screen.queryByText(/No verified correction available/)).toBeNull();
    // Corrected views still refresh around the preserved coordination.
    expect(liveValueOf('Conflict status')).toBe('CLEARED');
    expect(liveValueOf('Intent fingerprints')).toBe('ALL AGREE');
    expect(liveValueOf('Resolution status')).toBe('VERIFIED AND APPLIED');
  });
});
