/** Pilot's Perspective page through the real App navigation. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  makeSyncSafetyWindow,
} from './test/fixtures';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(): void {
  const demo = makeSyncDemo();
  const correction = makeSyncCorrection();
  const handler = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/health')) return jsonResponse(makeHealth(false));
    if (url.endsWith('/api/scenarios')) return jsonResponse({ scenarios: makeScenarios() });
    if (url.endsWith('/api/demo/run')) return jsonResponse(demo);
    if (url.endsWith('/api/demo/correct')) return jsonResponse(correction);
    if (url.endsWith('/api/safety/window')) return jsonResponse(makeSyncSafetyWindow());
    if (url.endsWith('/api/resolutions/enumerate')) return jsonResponse(makeSyncCandidates());
    if (url.endsWith('/api/fingerprints')) return jsonResponse(makeFingerprints(false));
    if (url.endsWith('/api/coordinate')) return jsonResponse(makeSyncCoordination());
    if (url.endsWith('/api/audit/events')) return jsonResponse(makeAuditEvents());
    if (url.endsWith('/api/audit/verify')) return jsonResponse(makeAuditVerify(7));
    throw new Error(`Unexpected fetch: ${url}`);
  };
  vi.stubGlobal('fetch', handler);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("pilot's perspective page", () => {
  it('shows the tablet, map, and photo before the demo runs', async () => {
    installFetch();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByText("Pilot's Perspective"));
    expect(screen.getByText('ClearanceGuard')).not.toBeNull();
    expect(screen.getByText('Decrease to 23,000 feet.')).not.toBeNull();
    expect(container.querySelector('.pv-mapwrap .leaflet-container')).not.toBeNull();
    expect(container.querySelector('.pp-bottom img.pp-photo')).not.toBeNull();
  });

  it('shows the live tablet after the demo runs', async () => {
    installFetch();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByText('▶ Run Demo'));
    await screen.findByText('Pilot Correction');
    fireEvent.click(screen.getByText("Pilot's Perspective"));
    expect(screen.getByText('CHECK ALTITUDE')).not.toBeNull();
    expect(container.querySelector('.pv-mapwrap .leaflet-container')).not.toBeNull();
  });

  it('manually verifies and notifies ATC from the tablet', async () => {
    installFetch();
    render(<App />);
    fireEvent.click(await screen.findByText('▶ Run Demo'));
    await screen.findByText('Pilot Correction');
    fireEvent.click(screen.getByText("Pilot's Perspective"));
    fireEvent.click(await screen.findByText('23,000 ✓'));
    fireEvent.click(await screen.findByText('VERIFY', undefined, { timeout: 3000 }));
    await screen.findByText('Notification sent to ATC2 for verification.');
  });
});
