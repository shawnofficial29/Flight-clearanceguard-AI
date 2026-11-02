import { memo, useMemo } from 'react';
import type { ConflictPrediction } from '../api/types';

/**
 * Documented demo airspace anchors (backend/app/services/conflict.py):
 * META 452 flies east toward MERIT (20, 0) then PONCT (60, 0).
 * Fix markers render only when the backend data names them; all safety math
 * stays in the backend. Positions are display anchors only.
 */
const FIX_ANCHORS: Record<string, { x: number; y: number }> = {
  MERIT: { x: 20, y: 0 },
  PONCT: { x: 60, y: 0 },
};

const WIDTH = 680;
const HEIGHT = 300;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const X_MIN = -2;
const X_MAX = 64;
const Y_MIN = -20;
const Y_MAX = 5;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function scaleX(xNm: number): number {
  return PAD_LEFT + ((xNm - X_MIN) / (X_MAX - X_MIN)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
}

function scaleY(yNm: number): number {
  return PAD_TOP + ((Y_MAX - yNm) / (Y_MAX - Y_MIN)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
}

function toPoints(xs: number[], yNm: number): string {
  return xs.map((x) => `${round1(scaleX(x))},${round1(scaleY(yNm))}`).join(' ');
}

function formatAltFt(ft: number): string {
  return `${Math.round(ft).toLocaleString('en-US')} ft`;
}

const GRID_X = [0, 10, 20, 30, 40, 50, 60];
const GRID_Y = [-20, -15, -10, -5, 0];

function RadarGrid(): React.JSX.Element {
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
}

function SimContext(): React.JSX.Element {
  const x = round1(scaleX(-1));
  const y = round1(scaleY(-17.5));
  return (
    <g aria-label="Simulated terminal airspace context">
      <rect x={x} y={y} width={118} height={26} className="sim-box" />
      <text x={x + 6} y={y + 11} className="label sim-label">
        SIM RWY ▭ APT
      </text>
      <text x={x + 6} y={y + 21} className="tick sim-label">
        SIMULATED TERMINAL AIRSPACE
      </text>
    </g>
  );
}

interface RouteViewProps {
  conflict: ConflictPrediction | null;
  corrected: boolean;
  /** Callsign from backend clearance/FMS data. */
  callsign: string | null;
  /** Waypoint names collected from backend clearance/FMS data. */
  fixes: string[];
  /** ATC via-fix from backend actions, when the clearance names one. */
  atcVia: string | null;
}

export const RouteView = memo(function RouteView(props: RouteViewProps): React.JSX.Element {
  const { conflict, corrected, callsign, fixes, atcVia } = props;

  const model = useMemo(() => {
    if (conflict === null) return null;
    const metaXs = conflict.profile.map((point) => point.meta_x_nm);
    const intruder = conflict.profile
      .map((point) => `${round1(scaleX(point.intruder_x_nm))},${round1(scaleY(point.intruder_y_nm))}`)
      .join(' ');
    const first = conflict.profile[0];
    return { metaXs, intruder, first };
  }, [conflict]);

  if (conflict === null || model === null || model.first === undefined) {
    return (
      <section className="panel radar" aria-label="Route view">
        <h2>Route view (top-down, NM)</h2>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Empty radar shell">
          <RadarGrid />
          <SimContext />
        </svg>
      </section>
    );
  }

  const point = conflict.conflict ? conflict.conflict_point_nm : null;
  const intruderStart = model.first;
  const ownLabel = callsign ?? 'Ownship';
  const shownFixes = Object.keys(FIX_ANCHORS).filter((name) => fixes.includes(name));

  return (
    <section className="panel radar" aria-label="Route view">
      <h2>Route view (top-down, NM)</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Top-down route view">
        <RadarGrid />
        <SimContext />

        {/* ATC cleared route: eastbound via the backend-named gate. */}
        <polyline points={toPoints([X_MIN, 20, 60], 1.1)} className="route-atc" />
        {/* Executed route from the backend profile (y = 0 demo axis). */}
        <polyline
          points={toPoints(model.metaXs, -1.1)}
          className={corrected ? 'route-corrected' : 'route-fms'}
        />
        {/* Intruder track from the backend profile. */}
        <polyline points={model.intruder} className="route-intruder" />

        <circle cx={round1(scaleX(0))} cy={round1(scaleY(0))} r={4} className="fix-start" />
        <text x={round1(scaleX(0)) + 6} y={round1(scaleY(0)) - 6} className="label">
          {ownLabel} · {formatAltFt(model.first.meta_ft)}
        </text>
        <g>
          <circle
            cx={round1(scaleX(intruderStart.intruder_x_nm))}
            cy={round1(scaleY(intruderStart.intruder_y_nm))}
            r={4}
            className="fix-start"
          />
          <text
            x={round1(scaleX(intruderStart.intruder_x_nm)) + 6}
            y={round1(scaleY(intruderStart.intruder_y_nm)) - 6}
            className="label"
          >
            Intruder · {formatAltFt(intruderStart.intruder_ft)}
          </text>
        </g>
        {shownFixes.map((name) => {
          const anchor = FIX_ANCHORS[name];
          return (
            <g key={name}>
              <rect
                x={round1(scaleX(anchor.x)) - 4}
                y={round1(scaleY(anchor.y)) - 4}
                width={8}
                height={8}
                className="fix"
              />
              <text
                x={round1(scaleX(anchor.x)) + 6}
                y={round1(scaleY(anchor.y)) - 8}
                className="label"
              >
                {name}
              </text>
            </g>
          );
        })}
        {point !== null ? (
          <g>
            <rect
              x={round1(scaleX(point['x_nm'] ?? 0)) - 22}
              y={round1(scaleY(point['y_nm'] ?? 0)) - 22}
              width={44}
              height={44}
              className="conflict-zone"
            />
            <circle
              cx={round1(scaleX(point['x_nm'] ?? 0))}
              cy={round1(scaleY(point['y_nm'] ?? 0))}
              r={6}
              className="conflict-dot"
            />
            <text
              x={round1(scaleX(point['x_nm'] ?? 0)) + 8}
              y={round1(scaleY(point['y_nm'] ?? 0)) + 28}
              className="label"
            >
              Conflict
            </text>
          </g>
        ) : null}
      </svg>
      <ul className="legend">
        <li>
          <span className="swatch sw-atc" /> {atcVia === null ? 'ATC route (cleared)' : `ATC route (via ${atcVia})`}
        </li>
        {corrected ? (
          <li><span className="swatch sw-corrected" /> Corrected route (executed)</li>
        ) : (
          <li><span className="swatch sw-fms" /> FMS route (executed)</li>
        )}
        <li><span className="swatch sw-intruder" /> Intruder track</li>
        <li>Lateral offsets separate overlapping tracks for readability.</li>
      </ul>
    </section>
  );
});
