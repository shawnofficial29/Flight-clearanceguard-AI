/** Pilot's Perspective page through the real App navigation. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { DemoResult } from './api/types';
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
    if (url.endsWith('/api/demo/run-custom')) return jsonResponse(makeCustomDemo());
    if (url.endsWith('/api/demo/correct')) return jsonResponse(correction);
    if (url.includes('/api/voice/transcribe'))
      return jsonResponse({
        transcript: CUSTOM_ATC_TEXT,
        provenance: 'live_meta_api',
        model: 'test-voice',
        source_file: 'atc-15000.wav',
        note: null,
      });
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

const CUSTOM_ATC_TEXT = 'META 452, decrease to 15,000 feet.';

/** Custom demo as the backend would build it for the transcribed clearance. */
function makeCustomDemo(): DemoResult {
  const demo = makeSyncDemo();
  const swapAlt = (n: number | null): number | null =>
    n === 23000 ? 15000 : n === 22000 ? 14000 : n;
  return {
    ...demo,
    atc_transcript: CUSTOM_ATC_TEXT,
    pilot_transcript: 'META 452, decrease to 14,000 feet.',
    atc: {
      ...demo.atc,
      raw_text: CUSTOM_ATC_TEXT,
      actions: demo.atc.actions.map((a) => ({ ...a, numeric_value: swapAlt(a.numeric_value) })),
    },
    pilot: {
      ...demo.pilot,
      raw_text: 'META 452, decrease to 14,000 feet.',
      actions: demo.pilot.actions.map((a) => ({
        ...a,
        numeric_value: swapAlt(a.numeric_value),
      })),
    },
    fms: { ...demo.fms, cleared_alt_ft: 14000, summary: 'Descend to 14,000 ft immediate' },
    conflict: {
      ...demo.conflict,
      profile: demo.conflict.profile.map((p) => ({
        ...p,
        meta_ft: swapAlt(p.meta_ft) ?? p.meta_ft,
        intruder_ft: 13400,
      })),
    },
  };
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
    expect(
      screen.getByText('Maintain 23,000 feet and start decreasing after 15 miles.'),
    ).not.toBeNull();
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

  it('runs a custom clearance from uploaded ATC audio', async () => {
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => 'blob:mock-audio';
      URL.revokeObjectURL = () => {};
    }
    installFetch();
    const { container } = render(<App />);
    fireEvent.click(await screen.findByText('▶ Run Demo'));
    await screen.findByText('Pilot Correction');
    fireEvent.click(screen.getByText("Pilot's Perspective"));
    await screen.findByText('CHECK ALTITUDE');
    const input = container.querySelector('.pv-fileinput') as HTMLInputElement;
    const file = new File(['fake audio'], 'atc-15000.wav', { type: 'audio/wav' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await screen.findByText(CUSTOM_ATC_TEXT);
    expect(screen.getByText('15,000 ✓')).not.toBeNull();
    expect(screen.getByText('14,000')).not.toBeNull();
    expect(screen.queryByText('23,000 ✓')).toBeNull();
    expect(
      screen.queryByText('Maintain 23,000 feet and start decreasing after 15 miles.'),
    ).toBeNull();
  });
});
