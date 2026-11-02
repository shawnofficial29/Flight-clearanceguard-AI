import { memo, useMemo } from 'react';
import type { ConflictPrediction } from '../api/types';

/**
 * Documented demo airspace fixes (backend/app/services/conflict.py):
 * META 452 flies east toward MERIT (20, 0) then PONCT (60, 0).
 * These are display anchors only; all safety math stays in the backend.
 */
const MERIT_NM = { x: 20, y: 0 };
const PONCT_NM = { x: 60, y: 0 };

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

interface RouteViewProps {
  conflict: ConflictPrediction | null;
  corrected: boolean;
}

export const RouteView = memo(function RouteView(props: RouteViewProps): React.JSX.Element {
  const { conflict, corrected } = props;

  const model = useMemo(() => {
    if (conflict === null) return null;
    const metaXs = conflict.profile.map((point) => point.meta_x_nm);
    const intruder = conflict.profile
      .map((point) => `${round1(scaleX(point.intruder_x_nm))},${round1(scaleY(point.intruder_y_nm))}`)
      .join(' ');
    return { metaXs, intruder };
  }, [conflict]);

  if (conflict === null || model === null) {
    return (
      <section className="panel">
        <h2>Route view (top-down, NM)</h2>
        <p className="empty">Run the demo to load the route geometry.</p>
      </section>
    );
  }

  const point = conflict.conflict ? conflict.conflict_point_nm : null;
  const intruderStart = conflict.profile[0];
  const gridX = [0, 10, 20, 30, 40, 50, 60];
  const gridY = [-20, -15, -10, -5, 0];

  return (
    <section className="panel">
      <h2>Route view (top-down, NM)</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Top-down route view">
        {gridX.map((x) => (
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
        {gridY.map((y) => (
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

        {/* ATC cleared route: eastbound via MERIT gate to PONCT. */}
        <polyline points={toPoints([X_MIN, MERIT_NM.x, PONCT_NM.x], 1.1)} className="route-atc" />
        {/* Executed FMS route from the backend profile (y = 0 demo axis). */}
        <polyline
          points={toPoints(model.metaXs, -1.1)}
          className={corrected ? 'route-corrected' : 'route-fms'}
        />
        {/* Intruder track from the backend profile. */}
        <polyline points={model.intruder} className="route-intruder" />

        <circle cx={round1(scaleX(0))} cy={round1(scaleY(0))} r={4} className="fix-start" />
        <text x={round1(scaleX(0)) + 6} y={round1(scaleY(0)) - 6} className="label">
          META 452
        </text>
        {intruderStart !== undefined ? (
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
              Intruder
            </text>
          </g>
        ) : null}
        <rect
          x={round1(scaleX(MERIT_NM.x)) - 4}
          y={round1(scaleY(MERIT_NM.y)) - 4}
          width={8}
          height={8}
          className="fix"
        />
        <text x={round1(scaleX(MERIT_NM.x)) + 6} y={round1(scaleY(MERIT_NM.y)) - 8} className="label">
          MERIT
        </text>
        <rect
          x={round1(scaleX(PONCT_NM.x)) - 4}
          y={round1(scaleY(PONCT_NM.y)) - 4}
          width={8}
          height={8}
          className="fix"
        />
        <text x={round1(scaleX(PONCT_NM.x)) - 34} y={round1(scaleY(PONCT_NM.y)) - 8} className="label">
          PONCT
        </text>
        {point !== null ? (
          <g>
            <circle
              cx={round1(scaleX(point['x_nm'] ?? 0))}
              cy={round1(scaleY(point['y_nm'] ?? 0))}
              r={6}
              className="conflict-dot"
            />
            <text
              x={round1(scaleX(point['x_nm'] ?? 0)) + 8}
              y={round1(scaleY(point['y_nm'] ?? 0)) + 16}
              className="label"
            >
              Conflict
            </text>
          </g>
        ) : null}
      </svg>
      <ul className="legend">
        <li><span className="swatch sw-atc" /> ATC route (via MERIT)</li>
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
