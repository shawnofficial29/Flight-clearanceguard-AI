/** Map, playback, and scenario-clarity coverage. */

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { createRef } from 'react';
import type { TileLayer as LeafletTileLayer } from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayback } from './hooks/usePlayback';
import { AlertCard } from './components/AlertCard';
import { AltitudeChart } from './components/AltitudeChart';
import { ClearanceSummary } from './components/ClearanceSummary';
import { RouteView } from './components/RouteView';
import { SideView } from './components/SideView';
import { MISSING_KEY_MESSAGE, SimMap } from './components/SimMap';
import { TRUSTED_TILE_URL, buildCartoTileUrl } from './geo/tiles';
import type {
  ClearanceAction,
  ComparisonMatrix,
  Finding,
} from './api/types';
import {
  advanceTime,
  labelLayout,
  meritAfterTrafficS,
  sampleProfile,
  zoneOpacity,
} from './utils/playbackMath';
import { BG_TRAFFIC_COUNT } from './utils/backgroundTraffic';
import { describeError, describeResolved } from './utils/errorSentence';
import {
  makeClearConflict,
  makeDemoResult,
  makeMismatchConflict,
  makeSyncClearConflict,
  makeSyncConflict,
} from './test/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

beforeEach(() => {
  // Tile probe stays neutral unless a test overrides fetch.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});

function descendAction(value: number): ClearanceAction {
  return {
    action_type: 'DESCEND',
    target_fix: null,
    numeric_value: value,
    unit: 'FT',
    trigger_type: 'IMMEDIATE',
    trigger_value: null,
    evidence: 'descend',
    confidence: 0.95,
  };
}

function altitudeInputs(fmsAltFt: number, overall: ComparisonMatrix['overall']) {
  const demo = makeDemoResult();
  const finding: Finding = {
    category: 'CHANGED_VALUE',
    scope: 'atc_vs_pilot',
    action: 'DESCEND',
    detail: 'DESCEND value changed from 11,000 ft to 10,000 ft.',
  };
  return {
    atc: { ...demo.atc, actions: [descendAction(11000)] },
    pilot: { ...demo.pilot, actions: [descendAction(10000)] },
    fms: { ...demo.fms, cleared_alt_ft: fmsAltFt, cleared_fl: null },
    comparison: {
      rows: [],
      findings: [finding],
      overall,
      min_confidence: 0.9,
      missing_condition: false,
      missing_phrase: null,
    } satisfies ComparisonMatrix,
  };
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

describe('playback math', () => {
  it('interpolates profile positions and altitudes', () => {
    const profile = makeMismatchConflict().profile;
    const mid = sampleProfile(profile, 100);
    expect(mid).not.toBeNull();
    expect(mid?.ownX ?? 0).toBeGreaterThan(0);
    expect(mid?.ownFt).toBe(19500);
    expect(sampleProfile([], 10)).toBeNull();
  });

  it('interpolates speed and computes the MERIT sequencing from simulation output', () => {
    const before = makeMismatchConflict();
    expect(sampleProfile(before.profile, 0)?.ownKt).toBe(290);
    expect(sampleProfile(before.profile, 100)?.ownKt).toBe(250);
    expect(sampleProfile(before.profile, 100)?.tfcKt).toBe(250);
    // Timing is identical before and after: the slowdown loads as cleared.
    expect(meritAfterTrafficS(before)).toBeCloseTo(124.8, 2);
    expect(meritAfterTrafficS(makeClearConflict())).toBeCloseTo(124.8, 2);
    expect(meritAfterTrafficS({ ...before, intruder_merit_time_s: null })).toBeNull();
  });

  it('offsets aircraft and status labels so they never stack', () => {
    // Encounter: hero and traffic close, labels split top/bottom, tag sideways.
    expect(labelLayout(14.5, 0, 18, 2.4, 14.46, 18)).toEqual({
      heroDir: 'top',
      tfcDir: 'bottom',
      tagDir: 'left',
    });
    // Traffic far south extends its label further south, away from the hero.
    expect(labelLayout(0, 0, 18, -11.8, 14.46, 18)).toEqual({
      heroDir: 'top',
      tfcDir: 'bottom',
      tagDir: 'left',
    });
    // Traffic far north extends its label north, away from the hero.
    expect(labelLayout(33.6, 0, 18, 21.5, 14.46, 18)).toEqual({
      heroDir: 'top',
      tfcDir: 'top',
      tagDir: 'left',
    });
    // The tag sits opposite the traffic track, stable for the whole playback.
    expect(labelLayout(0, 0, 18, -11.8, 25, 18).tagDir).toBe('right');
  });

  it('advances, pauses at conflict, and ends exactly once', () => {
    expect(advanceTime(0, 1000, 30, 215, true, 430)).toEqual({
      t: 30,
      hitPause: false,
      hitEnd: false,
    });
    expect(advanceTime(210, 1000, 30, 215, true, 430)).toEqual({
      t: 215,
      hitPause: true,
      hitEnd: false,
    });
    expect(advanceTime(215, 1000, 30, 215, false, 430).hitPause).toBe(false);
    expect(advanceTime(429, 1000, 30, null, true, 430)).toEqual({
      t: 430,
      hitPause: false,
      hitEnd: true,
    });
  });

  it('ramps the conflict zone in and fades it after correction', () => {
    expect(zoneOpacity(0, 215, false)).toBe(0.25);
    expect(zoneOpacity(215, 215, false)).toBe(1);
    expect(zoneOpacity(300, 215, false)).toBe(1);
    expect(zoneOpacity(215, 215, true)).toBe(0.15);
    expect(zoneOpacity(0, null, false)).toBe(0);
  });
});

describe('error sentences', () => {
  it('states altitude before-correction values from backend data', () => {
    expect(describeError(altitudeInputs(10000, 'mismatch'))).toBe(
      'ATC assigned 11,000 ft; pilot read back 10,000 ft; FMS selected 10,000 ft.',
    );
  });

  it('states altitude agreement and FMS value after correction', () => {
    const after = altitudeInputs(11000, 'agree');
    expect(describeResolved({ fms: after.fms, comparison: after.comparison })).toBe(
      'ATC / Pilot / FMS agree. FMS selected: 11,000 ft.',
    );
    const before = altitudeInputs(10000, 'mismatch');
    expect(describeResolved({ fms: before.fms, comparison: before.comparison })).toBe('');
  });

  it('explains a dropped timing condition with correct altitude', () => {
    const demo = makeDemoResult();
    expect(
      describeError({ atc: demo.atc, pilot: demo.pilot, fms: demo.fms, comparison: demo.comparison }),
    ).toBe('Altitude 15,000 ft is correct; the after passing MERIT timing was omitted.');
  });

  it('falls back to the backend finding detail for other categories', () => {
    const demo = makeDemoResult();
    const comparison: ComparisonMatrix = {
      ...demo.comparison,
      findings: [
        { category: 'EXTRA_ACTION', scope: 'pilot_vs_fms', action: 'HOLD', detail: 'Extra hold loaded.' },
      ],
    };
    expect(describeError({ atc: demo.atc, pilot: demo.pilot, fms: demo.fms, comparison })).toBe(
      'Extra hold loaded.',
    );
  });
});

describe('AlertCard clarity', () => {
  it('leads with the error sentence for altitude mismatch', () => {
    const inputs = altitudeInputs(10000, 'mismatch');
    const demo = makeDemoResult();
    render(
      <AlertCard
        demo={demo}
        correction={null}
        comparison={inputs.comparison}
        conflict={makeMismatchConflict()}
        atc={inputs.atc}
        pilot={inputs.pilot}
        fms={inputs.fms}
      />,
    );
    expect(
      screen.getByText('ATC assigned 11,000 ft; pilot read back 10,000 ft; FMS selected 10,000 ft.'),
    ).not.toBeNull();
  });
});

describe('ClearanceSummary', () => {
  it('shows altitude before-correction values prominently', () => {
    const inputs = altitudeInputs(10000, 'mismatch');
    render(
      <ClearanceSummary
        atc={inputs.atc}
        pilot={inputs.pilot}
        fms={inputs.fms}
        comparison={inputs.comparison}
        corrected={false}
      />,
    );
    expect(screen.getByText('ATC assigned')).not.toBeNull();
    expect(screen.getByText('11,000 ft')).not.toBeNull();
    expect(screen.getByText('Pilot readback')).not.toBeNull();
    expect(screen.getAllByText('10,000 ft').length).toBe(2);
    expect(screen.queryByText('Synchronized')).toBeNull();
  });

  it('shows synchronized altitude values after correction', () => {
    const inputs = altitudeInputs(11000, 'agree');
    render(
      <ClearanceSummary
        atc={inputs.atc}
        pilot={{ ...inputs.pilot, actions: [descendAction(11000)] }}
        fms={inputs.fms}
        comparison={inputs.comparison}
        corrected
      />,
    );
    expect(screen.getAllByText('11,000 ft').length).toBe(3);
    expect(screen.getByText('Pilot confirmed')).not.toBeNull();
    expect(screen.getByText('Synchronized')).not.toBeNull();
  });

  it('states dropped timing explicitly', () => {
    const demo = makeDemoResult();
    render(
      <ClearanceSummary
        atc={demo.atc}
        pilot={demo.pilot}
        fms={demo.fms}
        comparison={demo.comparison}
        corrected={false}
      />,
    );
    expect(screen.getByText('Altitude 15,000 ft matches.')).not.toBeNull();
    expect(screen.getByText('AFTER MERIT')).not.toBeNull();
    expect(screen.getByText('IMMEDIATE')).not.toBeNull();
  });

  it('renders nothing for non-altitude, non-timing mismatches', () => {
    const demo = makeDemoResult();
    const comparison: ComparisonMatrix = {
      ...demo.comparison,
      findings: [
        { category: 'EXTRA_ACTION', scope: 'pilot_vs_fms', action: 'HOLD', detail: 'Extra hold loaded.' },
      ],
    };
    const { container } = render(
      <ClearanceSummary
        atc={demo.atc}
        pilot={demo.pilot}
        fms={demo.fms}
        comparison={comparison}
        corrected={false}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('usePlayback', () => {
  function setup(pauseAt: number | null = 215) {
    vi.useFakeTimers();
    stubMatchMedia(false);
    const profile = makeMismatchConflict().profile;
    return renderHook(() => usePlayback(profile, pauseAt, true, 'demo', false));
  }

  it('plays, pauses, seeks, and replays', () => {
    const { result } = setup();
    expect(result.current.timeS).toBe(0);
    expect(result.current.playing).toBe(false);

    act(() => {
      result.current.play();
    });
    expect(result.current.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.timeS).toBeGreaterThan(0);

    act(() => {
      result.current.pause();
    });
    const frozen = result.current.timeS;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.timeS).toBe(frozen);

    act(() => {
      result.current.seek(100);
    });
    expect(result.current.timeS).toBe(100);

    act(() => {
      result.current.replay();
    });
    expect(result.current.timeS).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('auto-pauses at the conflict point and resumes on play', () => {
    const { result } = setup(215);
    act(() => {
      result.current.seek(210);
      result.current.play();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.timeS).toBe(215);
    expect(result.current.playing).toBe(false);
    expect(result.current.atConflict).toBe(true);

    act(() => {
      result.current.play();
    });
    expect(result.current.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.timeS).toBeGreaterThan(215);
  });

  it('ends exactly at the profile end', () => {
    // Fixture profile ends at t=432 s.
    const { result } = setup(null);
    act(() => {
      result.current.seek(431);
      result.current.play();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.timeS).toBe(432);
    expect(result.current.ended).toBe(true);
    expect(result.current.playing).toBe(false);
  });
});

describe('RouteView map', () => {
  function renderMismatch() {
    return render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
  }

  it('renders tiles, attribution, badge, controls, and transport', () => {
    const { container } = renderMismatch();
    expect(container.querySelector('.leaflet-container')).not.toBeNull();
    expect(screen.getByText('SIMULATION — NOT LIVE TRAFFIC')).not.toBeNull();
    expect(screen.getByText('© OpenStreetMap contributors', { exact: false })).not.toBeNull();
    expect(screen.getByText('© CARTO', { exact: false })).not.toBeNull();
    expect(container.querySelector('.leaflet-control-zoom')).not.toBeNull();
    expect(container.querySelector('.leaflet-control-scale')).not.toBeNull();
    expect(screen.getByLabelText('Fit trajectories')).not.toBeNull();
    expect(screen.getByLabelText('Focus airport')).not.toBeNull();
    expect(screen.getByLabelText('Play simulation')).not.toBeNull();
    expect(screen.getByLabelText('Replay simulation')).not.toBeNull();
    expect(screen.getByText(/SIM ×30/)).not.toBeNull();
  });

  it('renders routes, waypoints, aircraft, and the conflict zone', () => {
    const { container } = renderMismatch();
    const paths = container.querySelectorAll('.leaflet-overlay-pane path');
    expect(paths.length).toBeGreaterThanOrEqual(3);
    // Fix names also label the side view axis; scope the map check to markers.
    const waypointNames = [...container.querySelectorAll('.wp-marker')].map(
      (el) => el.textContent ?? '',
    );
    expect(waypointNames.some((text) => text.includes('MERIT'))).toBe(true);
    expect(waypointNames.some((text) => text.includes('PONCT'))).toBe(true);
    expect(container.querySelectorAll('.ac-marker').length).toBe(2);
    expect(screen.getByText('META 452')).not.toBeNull();
    expect(screen.getByText('Conflict · 15,000 ft')).not.toBeNull();
    expect(screen.queryByText('Predicted conflict')).toBeNull();
  });

  it('shows only backend-supported information on aircraft tags', () => {
    const { container } = renderMismatch();
    const tags = container.querySelectorAll('.ac-tag');
    expect(tags.length).toBe(2);
    const text = container.textContent ?? '';
    expect(text).toContain('META 452');
    expect(text).toContain('23,000 ft');
    expect(text).toContain('15,000 ft');
    expect(text).not.toContain('KTS');
    expect(text).not.toContain('HDG');
    expect(text).not.toMatch(/heading \d/i);
    expect(text).not.toContain('knots');
    expect(text).not.toContain('cleared to land');
  });

  it('shows live speed on both aircraft tags and no ghost plane', () => {
    const { container } = renderMismatch();
    const text = container.textContent ?? '';
    expect(text).toContain('290 kt');
    expect(text).toContain('250 kt');
    expect(container.querySelectorAll('.fms-ghost').length).toBe(0);
    expect(screen.queryByText(/FMS path/)).toBeNull();
    expect(container.querySelectorAll('.ac-marker').length).toBe(2);
    expect(container.querySelectorAll('.ac-tag').length).toBe(2);
  });

  it('renders airliner markers as a single silhouette path', () => {
    const { container } = renderMismatch();
    const planes = container.querySelectorAll('.ac-marker .ac-svg');
    expect(planes.length).toBe(2);
    for (const svg of planes) {
      const paths = svg.querySelectorAll('path');
      expect(paths.length).toBe(1);
      // Nose at +x with swept wings and tail (airliner, not a dart).
      expect(paths[0].getAttribute('d')).toMatch(/^M12,0 L-2\.4,-2\.9 L-7\.8,-9 /);
    }
    expect(container.querySelector('.ac-marker .fold')).toBeNull();
  });

  it('renders the airliner glyph on background markers too', () => {
    const { container } = renderMismatch();
    const bg = container.querySelectorAll('.bg-marker .ac-svg');
    expect(bg.length).toBe(BG_TRAFFIC_COUNT);
    for (const svg of bg) {
      const paths = svg.querySelectorAll('path');
      expect(paths.length).toBe(1);
      expect(paths[0].getAttribute('d')).toMatch(/^M12,0 /);
    }
  });

  it('preserves history, the corrected route, and a faded zone after correction', () => {
    const { container } = render(
      <RouteView
        conflict={makeClearConflict()}
        history={makeMismatchConflict()}
        corrected
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
    expect(container.querySelector('.trail-history')).not.toBeNull();
    expect(container.querySelector('.route-corrected')).not.toBeNull();
    expect(container.querySelectorAll('.route-fms').length).toBe(0);
    expect(screen.getByText('Historical FMS trace')).not.toBeNull();
    // The verified tag replaces the conflict tag; the two never coexist.
    expect(screen.getByText('8,000 ft above traffic ✓')).not.toBeNull();
    expect(screen.queryByText('Predicted conflict')).toBeNull();
    expect(screen.queryByText('Conflict · 15,000 ft')).toBeNull();
  });

  it('supports keyboard transport controls', () => {
    renderMismatch();
    const scrub = screen.getByLabelText('Simulation timeline') as HTMLInputElement;
    expect(scrub.type).toBe('range');
    scrub.focus();
    expect(document.activeElement).toBe(scrub);
    fireEvent.change(scrub, { target: { value: '100' } });
    expect(screen.getByText(/T\+100s · SIM ×30/)).not.toBeNull();

    // Space on the scrubber toggles playback.
    fireEvent.keyDown(scrub, { key: ' ' });
    expect(screen.getByLabelText('Pause simulation')).not.toBeNull();
    fireEvent.keyDown(scrub, { key: ' ' });
    expect(screen.getByLabelText('Play simulation')).not.toBeNull();

    // Arrows on transport buttons scrub in 10-second steps.
    const play = screen.getByLabelText('Play simulation');
    fireEvent.keyDown(play, { key: 'ArrowRight' });
    expect(screen.getByText(/T\+110s · SIM ×30/)).not.toBeNull();
    fireEvent.keyDown(play, { key: 'ArrowLeft' });
    expect(screen.getByText(/T\+100s · SIM ×30/)).not.toBeNull();
  });

  it('reports playback time so charts stay in sync', () => {
    const onTime = vi.fn();
    render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
        onPlaybackTime={onTime}
      />,
    );
    const scrub = screen.getByLabelText('Simulation timeline');
    fireEvent.change(scrub, { target: { value: '100' } });
    expect(onTime).toHaveBeenCalledWith(100);
  });
});

describe('RouteView before/after presentation', () => {
  function renderMismatch() {
    return render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
  }

  function renderCorrected() {
    return render(
      <RouteView
        conflict={makeClearConflict()}
        history={makeMismatchConflict()}
        corrected
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
  }

  it('disables the After toggle until a correction exists', () => {
    renderMismatch();
    expect(screen.getByRole('button', { name: 'Before' })).not.toBeNull();
    const after = screen.getByRole('button', { name: 'After' }) as HTMLButtonElement;
    expect(after.disabled).toBe(true);
  });

  it('crossfades the map tags between before and after without overlap', () => {
    renderCorrected();
    expect(screen.getByText('8,000 ft above traffic ✓')).not.toBeNull();
    expect(screen.queryByText('Conflict · 15,000 ft')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    expect(screen.getByText('Conflict · 15,000 ft')).not.toBeNull();
    expect(screen.queryByText(/Conflict cleared/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'After' }));
    expect(screen.getByText('8,000 ft above traffic ✓')).not.toBeNull();
    expect(screen.queryByText('Conflict · 15,000 ft')).toBeNull();
  });

  it('renders the cleared tag on the green style, never the conflict style', () => {
    const { container } = renderCorrected();
    expect(screen.getByText('8,000 ft above traffic ✓')).not.toBeNull();
    expect(container.querySelectorAll('.cf-cleared').length).toBe(1);
    expect(container.querySelectorAll('.cf-tag').length).toBe(0);
  });

  it('marks the conflict flash on the side view before correction', () => {
    const { container } = render(
      <SideView before={makeMismatchConflict()} after={null} view="before" timeS={0} />,
    );
    expect(screen.getByText('Side view (vertical profile)')).not.toBeNull();
    expect(screen.getByText('MERIT')).not.toBeNull();
    expect(screen.getByText('PONCT')).not.toBeNull();
    expect(container.querySelector('.sv-flash')).not.toBeNull();
    expect(container.querySelector('.sv-bracket')).toBeNull();
  });

  it('shows the separation bracket on the side view after correction', () => {
    const { container } = render(
      <SideView
        before={makeMismatchConflict()}
        after={makeClearConflict()}
        view="after"
        timeS={0}
      />,
    );
    expect(screen.getByText('Side view (vertical profile)')).not.toBeNull();
    expect(screen.getByText('8,000 ft separation')).not.toBeNull();
    expect(container.querySelector('.sv-bracket')).not.toBeNull();
    // The bracket sits at the closest lateral approach (fixture x=14.11 NM),
    // not at the level-off far past the crossing where vertical gap is smallest.
    const bracketLine = container.querySelector('.sv-bracket-line');
    expect(bracketLine?.getAttribute('x1')).toBe('218.3');
  });

  it('keeps the familiar 14,000–24,000 framing for wide descents', () => {
    render(
      <SideView
        before={makeMismatchConflict()}
        after={makeClearConflict()}
        view="after"
        timeS={0}
      />,
    );
    expect(screen.getByText('14,000')).not.toBeNull();
    expect(screen.getByText('24,000')).not.toBeNull();
  });

  it('frames the landing descent while keeping the separation bracket', () => {
    render(
      <SideView
        before={makeSyncConflict()}
        after={makeSyncClearConflict()}
        view="after"
        timeS={0}
      />,
    );
    expect(screen.getByText('10,000')).not.toBeNull();
    expect(screen.getByText('30,000')).not.toBeNull();
    expect(screen.getByText('7,000 ft separation')).not.toBeNull();
  });

  it('reports view changes so the rail side view follows the map', () => {
    const onMapViewChange = vi.fn();
    render(
      <RouteView
        conflict={makeClearConflict()}
        history={makeMismatchConflict()}
        corrected
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
        onMapViewChange={onMapViewChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    expect(onMapViewChange).toHaveBeenCalledWith('before');
  });

  it('omits the lateral-offset readability note', () => {
    const { container } = renderCorrected();
    expect(container.textContent ?? '').not.toContain('Lateral offsets');
  });
});

describe('AltitudeChart playback cursor', () => {
  it('shows a cursor at the shared playback time', () => {
    const { container } = render(
      <AltitudeChart conflict={makeMismatchConflict()} reference={null} safety={null} timeS={100} />,
    );
    expect(container.querySelector('.alt-cursor')).not.toBeNull();
    expect(container.querySelector('.alt-cursor-dot')).not.toBeNull();
  });

  it('omits the cursor without playback time', () => {
    const { container } = render(
      <AltitudeChart conflict={makeMismatchConflict()} reference={null} safety={null} />,
    );
    expect(container.querySelector('.alt-cursor')).toBeNull();
  });
});

function renderMap(tileUrl?: string | null) {
  const tileLayerRef = createRef<LeafletTileLayer>();
  const rendered = render(
    <SimMap
      conflict={makeMismatchConflict()}
      history={null}
      corrected={false}
      callsign="META 452"
      fixes={['MERIT', 'PONCT']}
      atcVia="MERIT"
      timeS={0}
      fitKey="demo"
      tileUrl={tileUrl}
      tileLayerRef={tileLayerRef}
    />,
  );
  return { ...rendered, tileLayerRef };
}

function fireError(tileLayerRef: React.RefObject<LeafletTileLayer | null>, times: number): void {
  for (let i = 0; i < times; i += 1) {
    act(() => {
      tileLayerRef.current?.fire('tileerror', {});
    });
  }
}

/** Trusted keyed URL for behavior tests (never hits the network in jsdom). */
const TRUSTED_KEYED = buildCartoTileUrl('test-map-key') as string;

describe('tile failure', () => {
  it('renders routes and aircraft without any tiles loaded', () => {
    const { container } = renderMap(TRUSTED_KEYED);
    // jsdom never loads raster tiles; vectors must still render.
    expect(container.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.ac-marker').length).toBe(2);
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
  });

  it('never probes the trusted keyed CARTO URL', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([9, 9, 9]).buffer),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { tileLayerRef } = renderMap(TRUSTED_KEYED);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tileLayerRef.current).not.toBeNull();
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
  });

  it('never probes the bare trusted CARTO base URL', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const { tileLayerRef } = renderMap(TRUSTED_TILE_URL);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tileLayerRef.current).not.toBeNull();
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
  });

  it('falls back when a custom URL serves byte-identical placeholders', async () => {
    const buffer = new Uint8Array([9, 9, 9]).buffer;
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buffer) } as Response),
    );
    const { container } = renderMap('https://tiles.example.com/{z}/{x}/{y}.png');
    await screen.findByText('Basemap unavailable — vector data unaffected.');
    await waitFor(() => {
      expect(container.querySelectorAll('.leaflet-tile').length).toBe(0);
    });
    expect(container.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('© OpenStreetMap contributors', { exact: false })).not.toBeNull();
  });

  it('requires several tile errors before fallback', () => {
    const { tileLayerRef } = renderMap(TRUSTED_KEYED);
    fireError(tileLayerRef, 2);
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
    fireError(tileLayerRef, 1);
    expect(screen.getByText('Basemap unavailable — vector data unaffected.')).not.toBeNull();
  });

  it('resets the error count on successful tile loads', () => {
    const { tileLayerRef } = renderMap(TRUSTED_KEYED);
    fireError(tileLayerRef, 2);
    act(() => {
      tileLayerRef.current?.fire('tileload', {});
    });
    fireError(tileLayerRef, 2);
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
  });

  it('retries and restores the tile layer with vectors intact', () => {
    const { container, tileLayerRef } = renderMap(TRUSTED_KEYED);
    fireError(tileLayerRef, 3);
    expect(screen.getByText('Basemap unavailable — vector data unaffected.')).not.toBeNull();
    fireEvent.click(screen.getByText('Retry basemap'));
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
    expect(tileLayerRef.current).not.toBeNull();
    expect(container.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.ac-marker').length).toBe(2);
    expect(screen.getByText('SIMULATION — NOT LIVE TRAFFIC')).not.toBeNull();
  });
});

describe('basemap key', () => {
  it('falls back to vectors with a key message when no key is configured', async () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_KEY', '');
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const { container, tileLayerRef } = renderMap();
    await screen.findByText(MISSING_KEY_MESSAGE);
    // No tile layer mounts, so no unauthenticated tile is requested.
    expect(tileLayerRef.current).toBeNull();
    expect(container.querySelectorAll('.leaflet-tile').length).toBe(0);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    // Vectors, attribution, and simulation badge stay intact.
    expect(container.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.ac-marker').length).toBe(2);
    expect(screen.getByText('© OpenStreetMap contributors', { exact: false })).not.toBeNull();
    expect(screen.getByText('SIMULATION — NOT LIVE TRAFFIC')).not.toBeNull();
    expect(screen.queryByText('Retry basemap')).toBeNull();
  });

  it('treats a blank key as missing and explicit null as forced fallback', async () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_KEY', '   ');
    const { unmount } = renderMap();
    await screen.findByText(MISSING_KEY_MESSAGE);
    unmount();
    cleanup();
    vi.stubEnv('VITE_CARTO_BASEMAP_KEY', 'ignored-when-null-prop');
    const forced = renderMap(null);
    await screen.findByText(MISSING_KEY_MESSAGE);
    expect(forced.tileLayerRef.current).toBeNull();
  });

  it('mounts the trusted keyed URL from the environment without probing', async () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_KEY', 'demo-key-1');
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const { tileLayerRef } = renderMap();
    expect(tileLayerRef.current).not.toBeNull();
    const layerUrl = (tileLayerRef.current as unknown as { _url: string })._url;
    expect(layerUrl).toBe(`${TRUSTED_TILE_URL}?key=demo-key-1`);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(MISSING_KEY_MESSAGE)).toBeNull();
    expect(screen.queryByText(/Basemap unavailable/)).toBeNull();
  });

  it('never exposes the key in visible UI text or failure messages', () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_KEY', 's3cret-k3y-9');
    const { container, tileLayerRef } = renderMap();
    expect(tileLayerRef.current).not.toBeNull();
    fireError(tileLayerRef, 3);
    expect(screen.getByText('Basemap unavailable — vector data unaffected.')).not.toBeNull();
    // The key lives only in tile request URLs, never in rendered text.
    expect(container.textContent ?? '').not.toContain('s3cret-k3y-9');
  });
});

describe('scenario projection', () => {
  function markerX(el: Element | null): number {
    if (el === null) return Number.NaN;
    const html = el as HTMLElement;
    const match = /translate3d\((-?[\d.]+)px/.exec(html.style.transform);
    if (match !== null) return Number(match[1]);
    if (html.style.left !== '') return Number.parseFloat(html.style.left);
    return Number.NaN;
  }

  it('places ownship west with MERIT, conflict, and PONCT sharing one projection', () => {
    const { container } = render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
    const own = container.querySelectorAll('.ac-marker')[0] ?? null;
    const waypoint = (name: string): Element | null =>
      [...container.querySelectorAll('.wp-marker')].find((el) =>
        (el.textContent ?? '').includes(name),
      ) ?? null;
    const ownX = markerX(own);
    const meritX = markerX(waypoint('MERIT'));
    const ponctX = markerX(waypoint('PONCT'));
    expect(Number.isNaN(ownX)).toBe(false);
    expect(ownX).toBeLessThan(meritX);
    expect(meritX).toBeLessThan(ponctX);
    expect(ponctX - ownX).toBeGreaterThan(10);
    // Conflict marker sits on the same projected track, near MERIT.
    const conflictX = markerX(container.querySelector('.cf-marker'));
    expect(Math.abs(conflictX - meritX)).toBeLessThan(ponctX - meritX);
  });
});

describe('reduced motion', () => {
  it('jumps to the conflict beat instead of looping', () => {
    stubMatchMedia(true);
    render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
    fireEvent.click(screen.getByLabelText('Play simulation'));
    expect(screen.getByText(/T\+205s · SIM ×30/)).not.toBeNull();
    expect(screen.getByText('Paused at predicted conflict')).not.toBeNull();
    expect(screen.getByLabelText('Play simulation')).not.toBeNull();
  });

  it('keeps full tracks and the zone visible statically', () => {
    stubMatchMedia(true);
    const { container } = render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
    expect(container.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Conflict · 15,000 ft')).not.toBeNull();
  });

  it('jumps the corrected replay to the end state', () => {
    stubMatchMedia(true);
    const { container } = render(
      <RouteView
        conflict={makeClearConflict()}
        history={makeMismatchConflict()}
        corrected
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
    fireEvent.click(screen.getByLabelText('Replay simulation'));
    expect(screen.getByText(/T\+432s · SIM ×30/)).not.toBeNull();
    expect(container.querySelector('.trail-history')).not.toBeNull();
  });
});

describe('background traffic', () => {
  function renderTraffic(timeS: number) {
    return render(
      <SimMap
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
        timeS={timeS}
        fitKey="demo"
      />,
    );
  }

  function bgPositions(container: Element): string[] {
    return [...container.querySelectorAll('.bg-marker')].map((el) => {
      const anyEl = el as HTMLElement & { _leaflet_pos?: { x: number; y: number } };
      const cached = anyEl._leaflet_pos;
      if (cached !== undefined) return `${cached.x},${cached.y}`;
      return anyEl.style.transform || `${anyEl.style.left},${anyEl.style.top}`;
    });
  }

  it('renders muted planes with a hero-ringed ownship and no permanent bg labels', () => {
    const { container } = renderTraffic(0);
    expect(container.querySelectorAll('.bg-marker').length).toBe(BG_TRAFFIC_COUNT);
    // META 452 keeps the hero treatment: own icon plus a glowing ring.
    expect(container.querySelector('.ac-own .ac-hero')).not.toBeNull();
    // Only the two scenario tags are permanent; bg tooltips open on hover.
    expect(container.querySelectorAll('.ac-tag').length).toBe(2);
    expect(screen.getByText('SIMULATION — NOT LIVE TRAFFIC')).not.toBeNull();
  });

  it('moves with playback time and returns on scrub-back', () => {
    const rendered = renderTraffic(0);
    const atZero = bgPositions(rendered.container);
    expect(atZero.length).toBe(BG_TRAFFIC_COUNT);

    rendered.rerender(
      <SimMap
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
        timeS={120}
        fitKey="demo"
      />,
    );
    const atLater = bgPositions(rendered.container);
    expect(atLater.length).toBe(BG_TRAFFIC_COUNT);
    // DOM order follows marker remounts on cycle change; compare as sets.
    expect([...atLater].sort()).not.toEqual([...atZero].sort());

    rendered.rerender(
      <SimMap
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
        timeS={0}
        fitKey="demo"
      />,
    );
    expect([...bgPositions(rendered.container)].sort()).toEqual([...atZero].sort());
  });

  it('shows a plain callsign tooltip on hover, with no alarming words', () => {
    const { container } = renderTraffic(0);
    const first = container.querySelector('.bg-marker') as HTMLElement | null;
    expect(first).not.toBeNull();
    fireEvent.mouseOver(first as HTMLElement);
    const tips = [...container.querySelectorAll('.leaflet-tooltip')].map(
      (el) => el.textContent ?? '',
    );
    const bgTip = tips.find((text) => text.startsWith('SIM ')) ?? '';
    expect(bgTip).toMatch(/^SIM [1-8]\d\d · [\d,]+ ft$/);
    const lowered = bgTip.toLowerCase();
    for (const word of ['conflict', 'collision', 'intruder', 'separation']) {
      expect(lowered).not.toContain(word);
    }
  });

  it('stays off the side view and altitude chart', () => {
    const side = render(
      <SideView before={makeMismatchConflict()} after={null} view="before" timeS={0} />,
    );
    expect(side.container.querySelector('.bg-marker')).toBeNull();
    side.unmount();
    cleanup();
    const chart = render(
      <AltitudeChart conflict={makeMismatchConflict()} reference={null} safety={null} timeS={0} />,
    );
    expect(chart.container.querySelector('.bg-marker')).toBeNull();
  });

  it('labels the ambient layer plainly in the legend', () => {
    render(
      <RouteView
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
      />,
    );
    const entry = screen.getByText('Background traffic (illustrative)');
    expect(entry).not.toBeNull();
    const lowered = (entry.textContent ?? '').toLowerCase();
    for (const word of ['conflict', 'collision', 'intruder', 'separation']) {
      expect(lowered).not.toContain(word);
    }
  });

  it('renders three parked gate aircraft that never move', () => {
    const parkedPositions = (container: Element): string[] =>
      [...container.querySelectorAll('.bg-parked')].map((el) => {
        const anyEl = el as HTMLElement & { _leaflet_pos?: { x: number; y: number } };
        const cached = anyEl._leaflet_pos;
        if (cached !== undefined) return `${cached.x},${cached.y}`;
        return anyEl.style.transform || `${anyEl.style.left},${anyEl.style.top}`;
      });
    const rendered = renderTraffic(0);
    expect(rendered.container.querySelectorAll('.bg-parked').length).toBe(3);
    expect(rendered.container.querySelectorAll('.bg-marker').length).toBe(BG_TRAFFIC_COUNT);
    const atZero = parkedPositions(rendered.container);
    rendered.rerender(
      <SimMap
        conflict={makeMismatchConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={['MERIT', 'PONCT']}
        atcVia="MERIT"
        timeS={600}
        fitKey="demo"
      />,
    );
    expect(rendered.container.querySelectorAll('.bg-parked').length).toBe(3);
    expect([...parkedPositions(rendered.container)].sort()).toEqual([...atZero].sort());
  });

  it('labels the illustrative airport without alarming words', () => {
    const { container } = renderTraffic(0);
    const label = container.querySelector('.apt-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('SFO');
  });
});
