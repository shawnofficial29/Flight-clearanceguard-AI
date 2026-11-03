import { memo, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  ScaleControl,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { ConflictPrediction, ProfilePoint } from '../api/types';
import { AnimatedText } from './AnimatedText';
import { useReducedMotion } from '../hooks/usePlayback';
import { labelLayout, sampleProfile, trackAngleDeg, zoneOpacity } from '../utils/playbackMath';
import { PARKED_AIRCRAFT, backgroundTrafficAt, formatBgTip } from '../utils/backgroundTraffic';
import { ROUTE_DISPLAY_OFFSET_NM, SFO_ANCHOR, scenarioNmToLatLng } from '../geo/conversion';
import {
  TILE_ERROR_THRESHOLD,
  TRUSTED_TILE_URL,
  buildCartoTileUrl,
  isTrustedTileUrl,
  probeTiles,
} from '../geo/tiles';

export const TILE_URL = TRUSTED_TILE_URL;
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
export const MISSING_KEY_MESSAGE = 'Basemap key not configured.';

/** Trusted raster URL from the configured key, or null when no key is set. */
function defaultTileUrl(): string | null {
  return buildCartoTileUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY as string | undefined);
}

/** Fix anchors in backend NM, shared with the previous schematic view. */
const FIX_ANCHORS: Record<string, { x: number; y: number }> = {
  MERIT: { x: 20, y: 0 },
  PONCT: { x: 60, y: 0 },
};

/**
 * Illustrative SFO airport (NM, scenario frame): the arrival route ends at
 * PONCT on the runway, so traffic visibly connects to the strip. Display
 * only; not a real place, procedure, or clearance.
 */
const RUNWAY_X0_NM = 55;
const RUNWAY_X1_NM = 63;
const SFO_LABEL_NM = { x: 64.5, y: 0 };

function formatAltFt(ft: number): string {
  return `${Math.round(ft).toLocaleString('en-US')} ft`;
}

function formatKt(kt: number): string {
  return `${Math.round(kt)} kt`;
}

/** Before/after comparison view for the route presentation. */
export type MapViewMode = 'before' | 'after';

/** Airliner marker: fuselage, swept wings and tail, nose +x at rotation 0. */
const AIRCRAFT_PATH =
  'M12,0 L-2.4,-2.9 L-7.8,-9 L-10.2,-9 L-6.2,-1.4 L-10.2,-1.4 L-10.2,1.4 L-6.2,1.4 L-10.2,9 L-7.8,9 L-2.4,2.9 Z';
const FIX_STAR = 'M0,-7 L1.8,-1.8 L7,0 L1.8,1.8 L0,7 L-1.8,1.8 L-7,0 L-1.8,-1.8 Z';

function aircraftIcon(rotationDeg: number, traffic: boolean, hero = false): L.DivIcon {
  const glyph = `<div class="ac-rot" style="transform: rotate(${rotationDeg}deg)"><svg width="28" height="28" viewBox="-14 -14 28 28" class="ac-svg" aria-hidden="true"><path d="${AIRCRAFT_PATH}"/></svg></div>`;
  return L.divIcon({
    className: traffic ? 'ac-marker ac-tfc' : 'ac-marker ac-own',
    html: hero ? `<div class="ac-hero">${glyph}</div>` : glyph,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Small muted glyph for ambient traffic; own class keeps scenario counts stable. */
function bgAircraftIcon(rotationDeg: number, className = 'bg-marker'): L.DivIcon {
  return L.divIcon({
    className,
    html: `<div class="ac-rot ac-bg-rot" style="transform: rotate(${rotationDeg}deg)"><svg width="18" height="18" viewBox="-14 -14 28 28" class="ac-svg" aria-hidden="true"><path d="${AIRCRAFT_PATH}"/></svg></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const APT_LABEL_ICON = L.divIcon({
  className: 'apt-label',
  html: '<span>SFO</span>',
  iconSize: [34, 16],
  iconAnchor: [17, 8],
});

function waypointIcon(name: string): L.DivIcon {
  const root = document.createElement('div');
  root.setAttribute('class', 'wp-inner');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '-8 -8 16 16');
  svg.setAttribute('class', 'wp-star');
  svg.setAttribute('aria-hidden', 'true');
  const star = document.createElementNS(svgNS, 'path');
  star.setAttribute('d', FIX_STAR);
  svg.appendChild(star);
  const label = document.createElement('span');
  label.textContent = name;
  root.append(svg, label);
  return L.divIcon({ className: 'wp-marker', html: root, iconSize: [64, 20], iconAnchor: [8, 10] });
}

const CONFLICT_ICON = L.divIcon({
  className: 'cf-marker',
  html: '<div class="cf-dot" aria-hidden="true"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const CLEARED_ICON = L.divIcon({
  className: 'cf-marker cf-clear',
  html: '<div class="cf-check" aria-hidden="true">✓</div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function profileLatLngs(profile: ProfilePoint[], northOffset: number): Array<[number, number]> {
  return profile.map((point) => {
    const at = scenarioNmToLatLng(point.meta_x_nm, northOffset);
    return [at.lat, at.lng];
  });
}

function intruderLatLngs(profile: ProfilePoint[]): Array<[number, number]> {
  return profile.map((point) => {
    const at = scenarioNmToLatLng(point.intruder_x_nm, point.intruder_y_nm);
    return [at.lat, at.lng];
  });
}

/**
 * Draws a Leaflet path along its length over ~1s. Returns an effect cleanup,
 * or undefined when static (no animation APIs, as in tests). The caller
 * decides when the draw is skipped via `skip`.
 */
function drawPath(layer: L.Polyline | null, skip: boolean): (() => void) | undefined {
  if (skip) return undefined;
  const path = layer?.getElement() as SVGPathElement | undefined;
  if (path === undefined || typeof path.getTotalLength !== 'function') return undefined;
  if (typeof path.animate !== 'function') return undefined;
  let length = 0;
  try {
    length = path.getTotalLength();
  } catch {
    return undefined;
  }
  if (!(length > 0)) return undefined;
  // Inline dash state overrides the route's own dash while drawing; the
  // cleanup restores it, so dashed routes end dashed again.
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;
  const animation = path.animate(
    [{ strokeDashoffset: `${length}` }, { strokeDashoffset: '0' }],
    { duration: 1000, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' },
  );
  return () => {
    animation.cancel();
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
  };
}

const FIT_PADDING: [number, number] = [40, 40];
const FIT_MAX_ZOOM = 12;

function FitOnLoad({ bounds, fitKey }: { bounds: L.LatLngBoundsExpression; fitKey: string }): null {
  const map = useMap();
  const reduced = useReducedMotion();
  const fittedRef = useRef<string | null>(null);
  useEffect(() => {
    // Fit once per trajectory; never steal the view during playback or pans.
    if (fittedRef.current === fitKey) return;
    // jsdom reports a zero-size map; skip fitting there (tests assert content).
    const size = map.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    fittedRef.current = fitKey;
    const pts = (bounds as Array<[number, number]>).filter(
      (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]),
    );
    const distinct = pts.filter(
      (p, i) => i === 0 || p[0] !== pts[0][0] || p[1] !== pts[0][1],
    );
    if (distinct.length < 2) {
      // Single-point bounds degenerate fitBounds math; center instead.
      map.setView([SFO_ANCHOR.lat, SFO_ANCHOR.lng], 9, { animate: false });
      return;
    }
    // Re-read the container size first so a late-applied layout still fits.
    map.invalidateSize();
    map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: !reduced });
  }, [map, bounds, fitKey, reduced]);
  return null;
}

function MapControls(props: { bounds: L.LatLngBoundsExpression }): React.JSX.Element {
  const map = useMap();
  return (
    <div className="map-controls">
      <button
        type="button"
        title="Fit trajectories"
        aria-label="Fit trajectories"
        onClick={() => map.fitBounds(props.bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: false })}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="ctl-icon">
          <path
            d="M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        title="Focus airport (SFO)"
        aria-label="Focus airport"
        onClick={() => map.setView([SFO_ANCHOR.lat, SFO_ANCHOR.lng], 14, { animate: false })}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="ctl-icon">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

export interface SimMapProps {
  conflict: ConflictPrediction | null;
  history: ConflictPrediction | null;
  corrected: boolean;
  callsign: string | null;
  fixes: string[];
  atcVia: string | null;
  timeS: number;
  fitKey: string;
  /** Before/after comparison view; defaults to the pre-verification state. */
  view?: MapViewMode;
  /** Enables the Before/After toggle when provided. */
  onViewChange?: (view: MapViewMode) => void;
  /** Override the basemap URL, or pass null to force the missing-key fallback. */
  tileUrl?: string | null;
  tileLayerRef?: React.Ref<L.TileLayer>;
}

export const SimMap = memo(function SimMap(props: SimMapProps): React.JSX.Element {
  const {
    conflict,
    history,
    corrected,
    callsign,
    fixes,
    atcVia,
    timeS,
    fitKey,
    view = 'before',
    onViewChange,
    tileUrl: tileUrlProp,
    tileLayerRef,
  } = props;
  const reduced = useReducedMotion();
  const [tilesFailed, setTilesFailed] = useState(false);
  const tileErrorsRef = useRef(0);
  const afterFullRef = useRef<L.Polyline | null>(null);

  // Presentation only: the before profile is what the wrong setting would do,
  // the after profile is the corrected route once verification exists.
  const beforeProfile: ProfilePoint[] = (corrected ? history?.profile : conflict?.profile) ?? [];
  const afterProfile: ProfilePoint[] | null =
    corrected && conflict !== null && history !== null ? conflict.profile : null;
  const canShowAfter = afterProfile !== null && afterProfile.length > 0 && beforeProfile.length > 0;
  const showingAfter = view === 'after' && canShowAfter;
  const resolved =
    corrected &&
    conflict !== null &&
    conflict.conflict === false &&
    (history?.conflict ?? false);
  const clearedView = resolved && showingAfter;
  const visibleProfile = showingAfter && afterProfile !== null ? afterProfile : beforeProfile;
  // Explicit null forces the missing-key fallback (tests); undefined reads env.
  const tileUrl = tileUrlProp === undefined ? defaultTileUrl() : tileUrlProp;

  useEffect(() => {
    // Placeholder-probe custom tile URLs only; the trusted CARTO provider
    // (with or without a key) is never rejected by probing.
    if (tileUrl === null || isTrustedTileUrl(tileUrl)) return;
    let live = true;
    void probeTiles(tileUrl).then((result) => {
      if (live && result === 'placeholder') setTilesFailed(true);
    });
    return () => {
      live = false;
    };
  }, [tileUrl]);

  function handleTileError(): void {
    tileErrorsRef.current += 1;
    if (tileErrorsRef.current >= TILE_ERROR_THRESHOLD) setTilesFailed(true);
  }

  function handleTileLoad(): void {
    tileErrorsRef.current = 0;
  }

  function retryTiles(): void {
    tileErrorsRef.current = 0;
    setTilesFailed(false);
  }

  // Static geometry: both route states plus the intruder track, so the
  // Before/After toggle never reframes the map.
  const geometry = useMemo(() => {
    if (conflict === null || beforeProfile.length === 0) return null;
    const atcXs = atcVia === 'MERIT' ? [-4, 20, 60] : [-4, 60];
    const atc = atcXs.map((x): [number, number] => {
      const at = scenarioNmToLatLng(x, ROUTE_DISPLAY_OFFSET_NM);
      return [at.lat, at.lng];
    });
    const beforeFull = profileLatLngs(beforeProfile, 0);
    const afterFull = afterProfile === null ? [] : profileLatLngs(afterProfile, 0);
    const tfcFull = intruderLatLngs(conflict.profile);
    return { atc, beforeFull, afterFull, tfcFull };
  }, [conflict, beforeProfile, afterProfile, atcVia]);

  const model = useMemo(() => {
    if (geometry === null || visibleProfile.length === 0 || conflict === null) return null;
    const beforeTraveledPts = beforeProfile.filter((point) => point.t_s <= timeS);
    const beforeTraveled =
      beforeTraveledPts.length >= 2 ? profileLatLngs(beforeTraveledPts, 0) : [];
    const afterTraveledPts = (afterProfile ?? []).filter((point) => point.t_s <= timeS);
    const afterTraveled =
      afterTraveledPts.length >= 2 ? profileLatLngs(afterTraveledPts, 0) : [];
    const tfcTraveledPts = conflict.profile.filter((point) => point.t_s <= timeS);
    const tfcTraveled = tfcTraveledPts.length >= 2 ? intruderLatLngs(tfcTraveledPts) : [];
    const sample = sampleProfile(visibleProfile, timeS);
    const first = visibleProfile[0];
    const last = visibleProfile[visibleProfile.length - 1];
    const ownAngle = trackAngleDeg(first.meta_x_nm, 0, last.meta_x_nm, 0);
    const tfcFirst = conflict.profile[0];
    const tfcLast = conflict.profile[conflict.profile.length - 1];
    const tfcAngle = trackAngleDeg(
      tfcFirst.intruder_x_nm, -tfcFirst.intruder_y_nm,
      tfcLast.intruder_x_nm, -tfcLast.intruder_y_nm,
    );
    return { beforeTraveled, afterTraveled, tfcTraveled, sample, ownAngle, tfcAngle };
  }, [geometry, visibleProfile, conflict, beforeProfile, afterProfile, timeS]);

  const bounds = useMemo<L.LatLngBoundsExpression>(() => {
    const pts: Array<[number, number]> = [[SFO_ANCHOR.lat, SFO_ANCHOR.lng]];
    if (geometry !== null) {
      pts.push(...geometry.atc, ...geometry.beforeFull, ...geometry.afterFull, ...geometry.tfcFull);
    }
    // Keep the illustrative airport inside the initial fit.
    for (const [xNm, yNm] of [
      [RUNWAY_X0_NM, 0],
      [RUNWAY_X1_NM, 0],
      [SFO_LABEL_NM.x, SFO_LABEL_NM.y],
      ...PARKED_AIRCRAFT.map((ac) => [ac.xNm, ac.yNm] as [number, number]),
    ]) {
      const at = scenarioNmToLatLng(xNm, yNm);
      pts.push([at.lat, at.lng]);
    }
    for (const name of Object.keys(FIX_ANCHORS)) {
      if (!fixes.includes(name)) continue;
      const anchor = FIX_ANCHORS[name];
      const at = scenarioNmToLatLng(anchor.x, anchor.y);
      pts.push([at.lat, at.lng]);
    }
    return pts;
  }, [geometry, fixes]);

  // The corrected route draws itself along the path when the after state
  // appears. Static without animation APIs (tests) or reduced motion.
  useEffect(() => drawPath(afterFullRef.current, !showingAfter || reduced), [showingAfter, reduced, fitKey]);

  const ownIcon = useMemo(
    () => aircraftIcon(model?.ownAngle ?? 0, false, true),
    [model?.ownAngle],
  );
  // Ambient traffic is a pure function of playback time: pause freezes it,
  // scrubbing moves it, reset restarts it. Icons memo on rounded headings so
  // straight-and-level flight does not churn marker DOM every tick.
  const bgTraffic = useMemo(() => backgroundTrafficAt(timeS), [timeS]);
  const bgHeadingKey = bgTraffic.map((ac) => Math.round(ac.headingDeg)).join(',');
  const bgIcons = useMemo(
    () => bgTraffic.map((ac) => bgAircraftIcon(Math.round(ac.headingDeg))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bgHeadingKey],
  );
  const tfcIcon = useMemo(
    () => aircraftIcon(model?.tfcAngle ?? -90, true),
    [model?.tfcAngle],
  );
  // Parked gate aircraft never move; icons and positions are static.
  const parkedIcons = useMemo(
    () => PARKED_AIRCRAFT.map((ac) => bgAircraftIcon(ac.headingDeg, 'bg-parked')),
    [],
  );
  const runwayEnds = useMemo<Array<[number, number]>>(() => {
    const west = scenarioNmToLatLng(RUNWAY_X0_NM, 0);
    const east = scenarioNmToLatLng(RUNWAY_X1_NM, 0);
    return [
      [west.lat, west.lng],
      [east.lat, east.lng],
    ];
  }, []);
  const sfoLabelAt = useMemo(() => scenarioNmToLatLng(SFO_LABEL_NM.x, SFO_LABEL_NM.y), []);
  const fixIcons = useMemo(() => {
    const icons = new Map<string, L.DivIcon>();
    for (const name of Object.keys(FIX_ANCHORS)) {
      if (fixes.includes(name)) icons.set(name, waypointIcon(name));
    }
    return icons;
  }, [fixes]);

  // One conflict marker that morphs on verification: the red zone and tag
  // show for a live conflict or the before view; the cleared tag replaces
  // them (never alongside) once the after view is verified.
  const activePoint = conflict?.conflict === true ? conflict.conflict_point_nm : null;
  const beforePoint =
    (corrected ? history : conflict)?.conflict === true
      ? (corrected ? history : conflict)?.conflict_point_nm ?? null
      : null;
  const zonePoint = activePoint ?? (showingAfter ? null : beforePoint);
  const zoneT =
    activePoint !== null
      ? conflict?.first_conflict_time_s ?? null
      : ((corrected ? history : conflict)?.first_conflict_time_s ?? null);
  const zoneCenter =
    zonePoint === null
      ? null
      : scenarioNmToLatLng(zonePoint['x_nm'] ?? 0, zonePoint['y_nm'] ?? 0);
  const clearedCenter =
    clearedView && beforePoint !== null
      ? scenarioNmToLatLng(beforePoint['x_nm'] ?? 0, beforePoint['y_nm'] ?? 0)
      : null;
  const tagCenter = clearedView ? clearedCenter : zoneCenter;
  const ringCenter = clearedView ? (clearedCenter ?? zoneCenter) : zoneCenter;
  const zoneOpacityValue = zonePoint === null ? 0 : zoneOpacity(timeS, zoneT, false);
  const thresholdNm = conflict?.lateral_threshold_nm ?? history?.lateral_threshold_nm ?? 5;

  const intruderAltFt =
    beforeProfile[0]?.intruder_ft ?? conflict?.profile[0]?.intruder_ft ?? null;
  const beforeTag =
    intruderAltFt === null ? 'Conflict' : `Conflict · ${formatAltFt(intruderAltFt)}`;
  const clearedTag =
    conflict === null
      ? 'Conflict cleared ✓'
      : `${Math.round(conflict.min_vertical_ft).toLocaleString('en-US')} ft above traffic ✓`;

  const sample = model?.sample ?? null;
  const ownAt = sample === null ? null : scenarioNmToLatLng(sample.ownX, 0);
  const tfcAt = sample === null ? null : scenarioNmToLatLng(sample.tfcX, sample.tfcY);
  // Label placement follows the live geometry so the hero tag, traffic tag,
  // and status tag never stack, at any playback time.
  const tagXNm = clearedView
    ? (beforePoint?.['x_nm'] ?? null)
    : (zonePoint?.['x_nm'] ?? null);
  const tfcTrackXNm =
    conflict?.profile[0]?.intruder_x_nm ?? history?.profile[0]?.intruder_x_nm ?? null;
  const layout =
    sample === null || tagXNm === null || tfcTrackXNm === null
      ? null
      : labelLayout(sample.ownX, 0, sample.tfcX, sample.tfcY, tagXNm, tfcTrackXNm);
  const clock = `T+${Math.round(timeS)}s`;
  const ownLabel = callsign ?? 'Ownship';
  const missingKey = tileUrl === null;

  return (
    <>
      <div className="sim-badge" role="note" aria-label="Simulation, not live traffic">
        SIMULATION — NOT LIVE TRAFFIC
      </div>
      {missingKey ? (
        <div className="tile-fallback" role="status">
          <span>{MISSING_KEY_MESSAGE}</span>
        </div>
      ) : null}
      {tilesFailed ? (
        <div className="tile-fallback" role="status">
          <span>Basemap unavailable — vector data unaffected.</span>
          <button type="button" className="retry-basemap" onClick={retryTiles}>
            Retry basemap
          </button>
        </div>
      ) : null}
      {onViewChange !== undefined && conflict !== null ? (
        <div className="map-view-toggle" role="group" aria-label="Before and after comparison">
          <button
            type="button"
            className={view === 'before' ? 'is-active' : undefined}
            aria-pressed={view === 'before'}
            onClick={() => onViewChange('before')}
          >
            Before
          </button>
          <button
            type="button"
            className={view === 'after' ? 'is-active' : undefined}
            aria-pressed={view === 'after'}
            disabled={!canShowAfter}
            title={canShowAfter ? 'Show the verified corrected route' : 'Verify a correction to compare'}
            onClick={() => onViewChange('after')}
          >
            After
          </button>
        </div>
      ) : null}
      <MapContainer
        className={`sim-map ${showingAfter ? 'view-after' : 'view-before'}`}
        center={[SFO_ANCHOR.lat, SFO_ANCHOR.lng]}
        zoom={9}
        scrollWheelZoom
        zoomControl={false}
        zoomAnimation={!reduced}
        fadeAnimation={!reduced}
        markerZoomAnimation={!reduced}
      >
        {tileUrl !== null && !tilesFailed ? (
          <TileLayer
            ref={tileLayerRef}
            url={tileUrl}
            attribution={TILE_ATTRIBUTION}
            maxZoom={19}
            eventHandlers={{ tileerror: handleTileError, tileload: handleTileLoad }}
          />
        ) : (
          <div className="leaflet-control-attribution leaflet-control static-attribution">
            {TILE_ATTRIBUTION}
          </div>
        )}
        <ZoomControl position="topright" />
        <ScaleControl position="bottomleft" />
        <FitOnLoad bounds={bounds} fitKey={fitKey} />
        <MapControls bounds={bounds} />
        <Polyline positions={runwayEnds} color="#44403c" weight={8} opacity={0.9} />
        <Polyline
          positions={runwayEnds}
          color="#e8e0d0"
          weight={1.5}
          opacity={0.9}
          dashArray="8 6"
        />
        <Marker position={[sfoLabelAt.lat, sfoLabelAt.lng]} icon={APT_LABEL_ICON} keyboard={false} />
        {PARKED_AIRCRAFT.map((ac, index) => {
          const at = scenarioNmToLatLng(ac.xNm, ac.yNm);
          return (
            <Marker
              key={`park-${ac.slot}`}
              position={[at.lat, at.lng]}
              icon={parkedIcons[index]}
              keyboard={false}
            >
              <Tooltip direction="top" offset={[0, -12]} className="ac-tag">
                {formatBgTip(ac)}
              </Tooltip>
            </Marker>
          );
        })}
        {bgTraffic.map((ac, index) => {
          const at = scenarioNmToLatLng(ac.xNm, ac.yNm);
          return (
            <Marker
              key={`${ac.slot}-${ac.cycle}`}
              position={[at.lat, at.lng]}
              icon={bgIcons[index]}
              keyboard={false}
            >
              <Tooltip direction="top" offset={[0, -12]} className="ac-tag">
                {formatBgTip(ac)}
              </Tooltip>
            </Marker>
          );
        })}
        {model !== null && geometry !== null ? (
          <>
            <Polyline positions={geometry.atc} color="#8b5a2b" weight={3} />
            <Polyline
              positions={geometry.beforeFull}
              color="#b3261e"
              weight={3}
              opacity={0.55}
              dashArray="6 4"
              className={showingAfter ? 'route-before trail-history' : 'route-before'}
            />
            {model.beforeTraveled.length > 0 ? (
              <Polyline
                positions={model.beforeTraveled}
                color="#b3261e"
                weight={4}
                dashArray="6 4"
                className="layer-before"
              />
            ) : null}
            {geometry.afterFull.length > 0 ? (
              <Polyline
                ref={afterFullRef}
                positions={geometry.afterFull}
                color="#1e7e34"
                weight={3}
                opacity={0.55}
                className="layer-after route-corrected route-draw"
              />
            ) : null}
            {model.afterTraveled.length > 0 ? (
              <Polyline
                positions={model.afterTraveled}
                color="#1e7e34"
                weight={4}
                className="layer-after"
              />
            ) : null}
            <Polyline
              positions={geometry.tfcFull}
              color="#7d6c58"
              weight={2}
              opacity={0.5}
              dashArray="2 3"
            />
            {model.tfcTraveled.length > 0 ? (
              <Polyline positions={model.tfcTraveled} color="#7d6c58" weight={3} />
            ) : null}
          </>
        ) : null}
        {[...fixIcons.entries()].map(([name, icon]) => {
          const anchor = FIX_ANCHORS[name];
          const at = scenarioNmToLatLng(anchor.x, anchor.y);
          return <Marker key={name} position={[at.lat, at.lng]} icon={icon} keyboard={false} />;
        })}
        {ringCenter !== null ? (
          <>
            <Circle
              center={[ringCenter.lat, ringCenter.lng]}
              radius={thresholdNm * 1852}
              color="#b3261e"
              weight={1.5}
              dashArray="4 3"
              opacity={zoneOpacityValue}
              fillColor="#b3261e"
              fillOpacity={0.06 * zoneOpacityValue}
              pathOptions={{
                opacity: zoneOpacityValue,
                fillOpacity: 0.06 * zoneOpacityValue,
                dashArray: '4 3',
              }}
              className={clearedView ? 'conflict-ring is-cleared' : 'conflict-ring'}
            />
            {tagCenter !== null ? (
              <Marker
                position={[tagCenter.lat, tagCenter.lng]}
                icon={clearedView ? CLEARED_ICON : CONFLICT_ICON}
                keyboard={false}
                opacity={clearedView ? 1 : zoneOpacityValue}
              >
                <Tooltip
                  permanent
                  direction="bottom"
                  offset={[-70, 42]}
                  className={clearedView ? 'cf-cleared' : 'cf-tag'}
                >
                  {clearedView ? clearedTag : beforeTag}
                </Tooltip>
              </Marker>
            ) : null}
          </>
        ) : null}
        {ownAt !== null && sample !== null ? (
          <Marker position={[ownAt.lat, ownAt.lng]} icon={ownIcon} keyboard={false} title={ownLabel}>
            <Tooltip
              permanent
              direction={layout?.heroDir ?? 'top'}
              offset={(layout?.heroDir ?? 'top') === 'bottom' ? [0, 12] : [0, -16]}
              className="ac-tag"
            >
              <div className="ac-tag-name">{ownLabel}</div>
              <div>
                <AnimatedText value={sample.ownFt} format={formatAltFt} />
                {sample.ownKt !== null ? (
                  <>
                    {' '}· <AnimatedText value={sample.ownKt} format={formatKt} />
                  </>
                ) : null}{' '}
                · {clock}
              </div>
            </Tooltip>
          </Marker>
        ) : null}
        {tfcAt !== null && sample !== null ? (
          <Marker position={[tfcAt.lat, tfcAt.lng]} icon={tfcIcon} keyboard={false} title="Intruder">
            <Tooltip
              permanent
              direction={layout?.tfcDir ?? 'top'}
              offset={(layout?.tfcDir ?? 'top') === 'bottom' ? [0, 12] : [0, -16]}
              className="ac-tag"
            >
              <div className="ac-tag-name">Intruder</div>
              <div>
                <AnimatedText value={sample.tfcFt} format={formatAltFt} />
                {sample.tfcKt !== null ? (
                  <>
                    {' '}· <AnimatedText value={sample.tfcKt} format={formatKt} />
                  </>
                ) : null}{' '}
                · {clock}
              </div>
            </Tooltip>
          </Marker>
        ) : null}
      </MapContainer>
    </>
  );
});
