import { memo, useMemo } from 'react';
import type { ConflictPrediction } from '../api/types';
import { sampleProfile, trackAngleDeg, zoneOpacity } from '../utils/playbackMath';

/**
 * Fictional terminal-area geography. All airport/runway/terrain shapes are
 * decorative context, explicitly labelled simulated. Only route geometry,
 * aircraft positions, waypoint names, and the conflict point come from
 * backend data. Nothing here is a real place, procedure, or clearance.
 */
const WIDTH = 760;
const HEIGHT = 360;
const PAD_LEFT = 40;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;
const X_MIN = -4;
const X_MAX = 86;
const Y_MIN = -26;
const Y_MAX = 6;

/** Fictional airport reference point (NM): east of PONCT, an arrival. */
const APT = { x: 76, y: 0 };

const FIX_ANCHORS: Record<string, { x: number; y: number }> = {
  MERIT: { x: 20, y: 0 },
  PONCT: { x: 60, y: 0 },
};

const GRID_X = [0, 10, 20, 30, 40, 50, 60, 70, 80];
const GRID_Y = [-25, -20, -15, -10, -5, 0];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function scaleX(xNm: number): number {
  return PAD_LEFT + ((xNm - X_MIN) / (X_MAX - X_MIN)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
}

function scaleY(yNm: number): number {
  return PAD_TOP + ((Y_MAX - yNm) / (Y_MAX - Y_MIN)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
}

function nmToPxX(nm: number): number {
  return (nm / (X_MAX - X_MIN)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
}

function nmToPxY(nm: number): number {
  return (nm / (Y_MAX - Y_MIN)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
}

function formatAltFt(ft: number): string {
  return `${Math.round(ft).toLocaleString('en-US')} ft`;
}

/** Minimal custom top-down aircraft glyph, pointing east (0 deg). */
const AIRCRAFT_PATH =
  'M10,0 L-2,-2.4 L-6.5,-7.5 L-8.5,-7.5 L-5.2,-1.2 L-8.5,-1.2 L-8.5,1.2 L-5.2,1.2 L-8.5,7.5 L-6.5,7.5 L-2,2.4 Z';

/** Four-point fix star for named waypoints. */
const FIX_STAR_PATH = 'M0,-7 L1.8,-1.8 L7,0 L1.8,1.8 L0,7 L-1.8,1.8 L-7,0 L-1.8,-1.8 Z';

const MapGrid = memo(function MapGrid(): React.JSX.Element {
  return (
    <g aria-hidden="true">
      {GRID_X.map((x) => (
        <g key={`gx-${x}`}>
          <line
            x1={round1(scaleX(x))}
            y1={round1(scaleY(Y_MIN))}
            x2={round1(scaleX(x))}
            y2={round1(scaleY(Y_MAX))}
            className="grid"
          />
          <text x={round1(scaleX(x))} y={HEIGHT - 8} className="tick">
            {x}
          </text>
        </g>
      ))}
      {GRID_Y.map((y) => (
        <g key={`gy-${y}`}>
          <line
            x1={round1(scaleX(X_MIN))}
            y1={round1(scaleY(y))}
            x2={round1(scaleX(X_MAX))}
            y2={round1(scaleY(y))}
            className="grid"
          />
          <text x={4} y={round1(scaleY(y)) + 4} className="tick">
            {y}
          </text>
        </g>
      ))}
    </g>
  );
});

const MapTerrain = memo(function MapTerrain(): React.JSX.Element {
  return (
    <g aria-hidden="true">
      <polygon
        points={`${round1(scaleX(X_MIN))},${round1(scaleY(-14))} ${round1(scaleX(18))},${round1(scaleY(-16))} ${round1(scaleX(34))},${round1(scaleY(-13))} ${round1(scaleX(30))},${round1(scaleY(Y_MIN))} ${round1(scaleX(X_MIN))},${round1(scaleY(Y_MIN))}`}
        className="terrain"
      />
      <polygon
        points={`${round1(scaleX(44))},${round1(scaleY(Y_MAX))} ${round1(scaleX(62))},${round1(scaleY(Y_MAX))} ${round1(scaleX(58))},${round1(scaleY(-6))} ${round1(scaleX(46))},${round1(scaleY(-8))}`}
        className="terrain"
      />
      <polyline
        points={`${round1(scaleX(-2))},${round1(scaleY(-19))} ${round1(scaleX(24))},${round1(scaleY(-21))} ${round1(scaleX(52))},${round1(scaleY(-18))} ${round1(scaleX(70))},${round1(scaleY(-20))}`}
        className="road"
      />
      <polyline
        points={`${round1(scaleX(8))},${round1(scaleY(-24))} ${round1(scaleX(12))},${round1(scaleY(-12))} ${round1(scaleX(10))},${round1(scaleY(-4))}`}
        className="road"
      />
    </g>
  );
});

const SimAirport = memo(function SimAirport(): React.JSX.Element {
  const x0 = round1(scaleX(64));
  const x1 = round1(scaleX(84));
  const yTop = round1(scaleY(4.5));
  const yBot = round1(scaleY(-8));
  const rwyY0 = round1(scaleY(0.7));
  const rwyY1 = round1(scaleY(-0.7));
  const rwyX0 = round1(scaleX(68));
  const rwyX1 = round1(scaleX(81));
  const twyY = round1(scaleY(-2.8));
  return (
    <g aria-label="Simulated airport, fictional context">
      <rect x={x0} y={yTop} width={round1(x1 - x0)} height={round1(yBot - yTop)} className="apt-boundary" />
      <text x={round1(scaleX(65))} y={round1(scaleY(3.4))} className="tick sim-label">
        SIM AIRPORT (fictional)
      </text>
      <rect x={rwyX0} y={rwyY0} width={round1(rwyX1 - rwyX0)} height={round1(rwyY1 - rwyY0)} className="runway" />
      <line x1={rwyX0 + 8} y1={(rwyY0 + rwyY1) / 2} x2={rwyX1 - 8} y2={(rwyY0 + rwyY1) / 2} className="runway-center" />
      <text x={rwyX0 + 3} y={(rwyY0 + rwyY1) / 2 - 4} className="tick sim-label">
        09
      </text>
      <text x={rwyX1 - 15} y={(rwyY0 + rwyY1) / 2 - 4} className="tick sim-label">
        27
      </text>
      <line x1={round1(scaleX(66))} y1={twyY} x2={round1(scaleX(82))} y2={twyY} className="taxiway" />
      {[69, 74, 79].map((x) => (
        <line
          key={`twy-${x}`}
          x1={round1(scaleX(x))}
          y1={rwyY1}
          x2={round1(scaleX(x))}
          y2={twyY}
          className="taxiway"
        />
      ))}
      <rect x={round1(scaleX(70))} y={round1(scaleY(-4.2))} width={14} height={9} className="terminal" />
      <rect x={round1(scaleX(72.5))} y={round1(scaleY(-5))} width={20} height={11} className="terminal" />
      <rect x={round1(scaleX(76))} y={round1(scaleY(-4.2))} width={12} height={9} className="terminal" />
    </g>
  );
});

const MapFurniture = memo(function MapFurniture(): React.JSX.Element {
  const cx = round1(scaleX(APT.x));
  const cy = round1(scaleY(APT.y));
  const sbX0 = round1(scaleX(58));
  const sbX1 = round1(scaleX(68));
  const sbY = round1(scaleY(-23));
  const nx = WIDTH - 26;
  const ny = PAD_TOP + 18;
  return (
    <g aria-hidden="true">
      {[5, 10].map((nm) => (
        <g key={`ring-${nm}`}>
          <ellipse cx={cx} cy={cy} rx={round1(nmToPxX(nm))} ry={round1(nmToPxY(nm))} className="range-ring" />
          <text x={cx + 4} y={round1(cy - nmToPxY(nm)) - 3} className="tick sim-label">
            {nm} NM
          </text>
        </g>
      ))}
      <line x1={sbX0} y1={sbY} x2={sbX1} y2={sbY} className="scale-bar" />
      <line x1={sbX0} y1={sbY - 4} x2={sbX0} y2={sbY + 4} className="scale-bar" />
      <line x1={sbX1} y1={sbY - 4} x2={sbX1} y2={sbY + 4} className="scale-bar" />
      <text x={(sbX0 + sbX1) / 2 - 14} y={sbY + 14} className="tick">
        10 NM
      </text>
      <line x1={nx} y1={ny + 12} x2={nx} y2={ny - 8} className="north-arrow" />
      <polygon points={`${nx},${ny - 14} ${nx - 5},${ny - 5} ${nx + 5},${ny - 5}`} className="north-arrow-head" />
      <text x={nx - 4} y={ny + 24} className="label">
        N
      </text>
      <text x={PAD_LEFT + 4} y={PAD_TOP + 12} className="label sim-banner">
        SIMULATED TERMINAL AIRSPACE
      </text>
    </g>
  );
});

export interface AirspaceMapProps {
  conflict: ConflictPrediction | null;
  history: ConflictPrediction | null;
  corrected: boolean;
  callsign: string | null;
  fixes: string[];
  atcVia: string | null;
  timeS: number;
}

export const AirspaceMap = memo(function AirspaceMap(props: AirspaceMapProps): React.JSX.Element {
  const { conflict, history, corrected, callsign, fixes, atcVia, timeS } = props;

  const model = useMemo(() => {
    if (conflict === null || conflict.profile.length === 0) return null;
    const toOwn = (x: number): string => `${round1(scaleX(x))},${round1(scaleY(-1.1))}`;
    const full = conflict.profile.map((point) => toOwn(point.meta_x_nm)).join(' ');
    const traveled = conflict.profile
      .filter((point) => point.t_s <= timeS)
      .map((point) => toOwn(point.meta_x_nm))
      .join(' ');
    const intruderFull = conflict.profile
      .map((point) => `${round1(scaleX(point.intruder_x_nm))},${round1(scaleY(point.intruder_y_nm))}`)
      .join(' ');
    const intruderTraveled = conflict.profile
      .filter((point) => point.t_s <= timeS)
      .map((point) => `${round1(scaleX(point.intruder_x_nm))},${round1(scaleY(point.intruder_y_nm))}`)
      .join(' ');
    const past = history === null ? null : history.profile.map((point) => toOwn(point.meta_x_nm)).join(' ');
    const sample = sampleProfile(conflict.profile, timeS);
    const before = sampleProfile(conflict.profile, Math.max(timeS - 3, 0));
    const after = sampleProfile(
      conflict.profile,
      Math.min(timeS + 3, conflict.profile[conflict.profile.length - 1].t_s),
    );
    let ownAngle = 0;
    let tfcAngle = -90;
    if (before !== null && after !== null) {
      ownAngle = trackAngleDeg(
        scaleX(before.ownX), scaleY(-1.1),
        scaleX(after.ownX), scaleY(-1.1),
      );
      tfcAngle = trackAngleDeg(
        scaleX(before.tfcX), scaleY(before.tfcY),
        scaleX(after.tfcX), scaleY(after.tfcY),
      );
    }
    return { full, traveled, intruderFull, intruderTraveled, past, sample, ownAngle, tfcAngle };
  }, [conflict, history, timeS]);

  const atcXs = atcVia === 'MERIT' ? [X_MIN, 20, 60] : [X_MIN, 60];
  const atcPoints = atcXs.map((x) => `${round1(scaleX(x))},${round1(scaleY(1.1))}`).join(' ');
  const shownFixes = Object.keys(FIX_ANCHORS).filter((name) => fixes.includes(name));

  const activePoint = conflict?.conflict === true ? conflict.conflict_point_nm : null;
  const historyPoint = history?.conflict === true ? history.conflict_point_nm : null;
  const zonePoint = activePoint ?? historyPoint;
  const zoneT =
    conflict?.conflict === true
      ? conflict.first_conflict_time_s
      : (history?.first_conflict_time_s ?? null);
  const zoneFaded = zonePoint !== null && conflict?.conflict !== true;
  const opacity = zonePoint === null ? 0 : zoneOpacity(timeS, zoneT, zoneFaded);

  const ownLabel = callsign ?? 'Ownship';
  const clock = `T+${Math.round(timeS)}s`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={conflict === null ? 'Empty simulated airspace map' : 'Simulated terminal airspace map'}
    >
      <MapTerrain />
      <MapGrid />
      <MapFurniture />
      <SimAirport />

      {conflict !== null ? <polyline points={atcPoints} className="route-atc" /> : null}
      {model?.past != null ? <polyline points={model.past} className="trail-history" /> : null}
      {model !== null ? (
        <g>
          <polyline points={model.full} className={corrected ? 'route-corrected route-base' : 'route-fms route-base'} />
          {model.traveled.length > 0 ? (
            <polyline
              points={model.traveled}
              className={corrected ? 'route-corrected traveled' : 'route-fms traveled'}
            />
          ) : null}
          <polyline points={model.intruderFull} className="route-intruder route-base" />
          {model.intruderTraveled.length > 0 ? (
            <polyline points={model.intruderTraveled} className="route-intruder traveled" />
          ) : null}
        </g>
      ) : null}

      {shownFixes.map((name) => {
        const anchor = FIX_ANCHORS[name];
        return (
          <g key={name} transform={`translate(${round1(scaleX(anchor.x))} ${round1(scaleY(anchor.y))})`}>
            <path d={FIX_STAR_PATH} className="fix-star" />
            <text x={9} y={-7} className="label">
              {name}
            </text>
          </g>
        );
      })}

      {zonePoint !== null ? (
        <g
          className={zoneFaded ? 'conflict-zone-g zone-faded' : 'conflict-zone-g'}
          opacity={round1(opacity)}
        >
          <circle
            cx={round1(scaleX(zonePoint['x_nm'] ?? 0))}
            cy={round1(scaleY(zonePoint['y_nm'] ?? 0))}
            r={24}
            className="conflict-zone"
          />
          <circle
            cx={round1(scaleX(zonePoint['x_nm'] ?? 0))}
            cy={round1(scaleY(zonePoint['y_nm'] ?? 0))}
            r={5}
            className="conflict-dot"
          />
          <text
            x={round1(scaleX(zonePoint['x_nm'] ?? 0)) + 10}
            y={round1(scaleY(zonePoint['y_nm'] ?? 0)) + 34}
            className="label"
          >
            Conflict
          </text>
        </g>
      ) : null}

      {model?.sample != null ? (
        <g>
          <g transform={`translate(${round1(scaleX(model.sample.ownX))} ${round1(scaleY(-1.1))}) rotate(${round1(model.ownAngle)})`}>
            <path d={AIRCRAFT_PATH} className="ac-own" />
          </g>
          <g className="tag" transform={`translate(${round1(scaleX(model.sample.ownX) + 14)} ${round1(scaleY(-1.1)) - 46})`}>
            <rect width={150} height={34} className="tag-box" />
            <text x={6} y={14} className="label">
              {ownLabel}
            </text>
            <text x={6} y={28} className="tick">
              {formatAltFt(model.sample.ownFt)} · {clock}
            </text>
          </g>
          <g transform={`translate(${round1(scaleX(model.sample.tfcX))} ${round1(scaleY(model.sample.tfcY))}) rotate(${round1(model.tfcAngle)})`}>
            <path d={AIRCRAFT_PATH} className="ac-tfc" />
          </g>
          <g className="tag" transform={`translate(${round1(scaleX(model.sample.tfcX) + 14)} ${round1(scaleY(model.sample.tfcY)) + 12})`}>
            <rect width={150} height={34} className="tag-box" />
            <text x={6} y={14} className="label">
              Intruder
            </text>
            <text x={6} y={28} className="tick">
              {formatAltFt(model.sample.tfcFt)} · {clock}
            </text>
          </g>
        </g>
      ) : null}
    </svg>
  );
});
