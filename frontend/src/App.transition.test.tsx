/** Full demo sequence against mocked backend responses. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  makeAuditEvents,
  makeAuditVerify,
  makeCandidates,
  makeCoordination,
  makeCorrectionResult,
  makeDemoResult,
  makeFingerprints,
  makeHealth,
  makeLiveCoordination,
  makeResolvedSafetyWindow,
  makeSafetyWindow,
  makeScenarios,
  makeVerification,
} from './test/fixtures';

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
  const demo = makeDemoResult();
  const correction = makeCorrectionResult();
  const coordination = options.live ? makeLiveCoordination() : makeCoordination();
  const counts = { coordinateCalls: 0 };
  let resetDone = false;
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/health')) return jsonResponse(makeHealth(options.live));
    if (url.endsWith('/api/scenarios')) return jsonResponse({ scenarios: makeScenarios() });
    if (url.endsWith('/api/demo/run')) return jsonResponse(demo);
    if (url.endsWith('/api/demo/correct')) return jsonResponse(correction);
    if (url.endsWith('/api/safety/window')) {
      return jsonResponse(isCorrectedTriple(init) ? makeResolvedSafetyWindow() : makeSafetyWindow());
    }
    if (url.endsWith('/api/resolutions/enumerate')) return jsonResponse(makeCandidates());
    if (url.endsWith('/api/resolutions/verify')) return jsonResponse(makeVerification());
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
  it('runs mismatch, verifies, corrects every panel, then resets to empty', async () => {
    const counts = installFetch({ live: false });
    render(<App />);

    await screen.findByText('Backend connected');
    expect(
      (screen.getByLabelText('Live Meta') as HTMLInputElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByText('Run Demo'));
    await screen.findByText('MISSING_CONDITION');
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toContain(
      '215 seconds',
    );
    expect(screen.getByText('Last safe correction in').nextElementSibling?.textContent).toBe(
      '197 seconds',
    );

    fireEvent.click(screen.getByLabelText(/missing-condition-climb-0/));
    await screen.findByText('VERIFIED');

    fireEvent.click(screen.getByText('Pilot Correction'));
    await screen.findByText('Applied');

    // Every panel describes the corrected state.
    const matrix = screen.getByText('Clearance Integrity Matrix').closest('section');
    expect(matrix).not.toBeNull();
    expect(within(matrix as HTMLElement).getByText('agree')).not.toBeNull();
    expect(screen.getByText('Conflict predicted in').nextElementSibling?.textContent).toBe(
      'No conflict predicted',
    );
    expect(screen.getByText('Display id').nextElementSibling?.textContent).toBe('aaaabbbb');
    expect(screen.getByText('All agree').nextElementSibling?.textContent).toBe('Yes');
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

    fireEvent.click(screen.getByText('Reset'));
    await screen.findByText('Run the demo to load the ATC clearance.');
    expect(screen.queryByText('missing-condition-climb-0')).toBeNull();
    expect(screen.queryByText('Applied')).toBeNull();
    expect(screen.getByText('No audit events recorded.')).not.toBeNull();
    expect(screen.getByText('Length').nextElementSibling?.textContent).toBe('0');
  });

  it('clears demo state when the scenario changes', async () => {
    installFetch({ live: false });
    render(<App />);
    await screen.findByText('Backend connected');
    fireEvent.click(screen.getByText('Run Demo'));
    await screen.findByText('MISSING_CONDITION');

    const select = screen.getByLabelText('Scenario') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'altitude-value' } });
    await screen.findByText('Run the demo to load the ATC clearance.');
    expect(screen.queryByText('MISSING_CONDITION')).toBeNull();
  });

  it('keeps the live coordinator result after the pilot applies the candidate', async () => {
    const counts = installFetch({ live: true });
    render(<App />);
    await screen.findByText('Backend connected');

    fireEvent.click(screen.getByLabelText('Live Meta'));
    fireEvent.click(screen.getByText('Run Demo'));
    await screen.findByText('MISSING_CONDITION');
    expect(screen.getByText(/Live Meta API/)).not.toBeNull();

    fireEvent.click(screen.getByLabelText(/missing-condition-climb-0/));
    await screen.findByText('VERIFIED');

    fireEvent.click(screen.getByText('Pilot Correction'));
    await screen.findByText('Applied');

    // No rerun: the live recommendation, provenance, and tool trace remain.
    expect(counts.coordinateCalls).toBe(1);
    expect(screen.getByText(/Live Meta API/)).not.toBeNull();
    const liveBlock = screen.getByText('Final resolution state').closest('div');
    if (liveBlock === null) throw new Error('Missing final resolution block.');
    const liveScoped = within(liveBlock);
    const liveValueOf = (label: string): string | null =>
      liveScoped.getByText(label).nextElementSibling?.textContent ?? null;
    expect(liveValueOf('Original coordinator recommendation')).toBe('missing-condition-climb-0');
    expect(screen.getByText('Step 1:', { exact: false })).not.toBeNull();
    expect(screen.queryByText(/No verified correction available/)).toBeNull();
    // Corrected views still refresh around the preserved coordination.
    expect(liveValueOf('Conflict status')).toBe('CLEARED');
    expect(liveValueOf('Intent fingerprints')).toBe('ALL AGREE');
    expect(liveValueOf('Resolution status')).toBe('VERIFIED AND APPLIED');
  });
});
