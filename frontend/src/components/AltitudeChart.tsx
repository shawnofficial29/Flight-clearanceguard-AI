import { memo, useMemo } from 'react';
import type { ConflictPrediction, SafetyWindow } from '../api/types';
import { sampleProfile } from '../utils/playbackMath';

const WIDTH = 680;
const HEIGHT = 300;
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

interface AltitudeChartProps {
  conflict: ConflictPrediction | null;
  reference: ConflictPrediction | null;
  safety: SafetyWindow | null;
  /** Shared playback time; renders a cursor in sync with the map. */
  timeS?: number | null;
}

export const AltitudeChart = memo(function AltitudeChart(
  props: AltitudeChartProps,
): React.JSX.Element {
  const { conflict, reference, safety, timeS = null } = props;

  const model = useMemo(() => {
    if (conflict === null || conflict.profile.length === 0) return null;
    const tMax = conflict.profile[conflict.profile.length - 1].t_s;
    const alts = conflict.profile.flatMap((point) => [point.meta_ft, point.intruder_ft]);
    if (reference !== null) {
      for (const point of reference.profile) alts.push(point.meta_ft);
    }
    let minAlt = Math.min(...alts);
    let maxAlt = Math.max(...alts);
    if (minAlt === maxAlt) maxAlt = minAlt + 1000;
    const pad = (maxAlt - minAlt) * 0.1;
    minAlt -= pad;
    maxAlt += pad;
    const sx = (t: number): number =>
      PAD_LEFT + (t / tMax) * (WIDTH - PAD_LEFT - PAD_RIGHT);
    const sy = (alt: number): number =>
      PAD_TOP + ((maxAlt - alt) / (maxAlt - minAlt)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
    const executed = conflict.profile
      .map((point) => `${round1(sx(point.t_s))},${round1(sy(point.meta_ft))}`)
      .join(' ');
    const before =
      reference === null
        ? null
        : reference.profile
            .map((point) => `${round1(sx(point.t_s))},${round1(sy(point.meta_ft))}`)
            .join(' ');
    const intruderAlt = conflict.profile[0].intruder_ft;
    let conflictDot: { x: number; y: number } | null = null;
    if (conflict.conflict && conflict.first_conflict_time_s !== null) {
      let nearest = conflict.profile[0];
      for (const point of conflict.profile) {
        if (
          Math.abs(point.t_s - conflict.first_conflict_time_s) <
          Math.abs(nearest.t_s - conflict.first_conflict_time_s)
        ) {
          nearest = point;
        }
      }
      conflictDot = { x: sx(conflict.first_conflict_time_s), y: sy(nearest.meta_ft) };
    }
    let lastSafe: { x: number; y: number } | null = null;
    if (
      safety !== null &&
      safety.last_safe_correction_s !== null &&
      safety.position_at_last_safe !== null
    ) {
      const alt = safety.position_at_last_safe['alt_ft'];
      if (typeof alt === 'number') {
        lastSafe = { x: sx(safety.last_safe_correction_s), y: sy(alt) };
      }
    }
    const timeTicks = [0, 1, 2, 3, 4, 5, 6].map((i) => (tMax * i) / 6);
    const altTicks = [0, 1, 2, 3, 4].map((i) => minAlt + ((maxAlt - minAlt) * i) / 4);
    let cursor: { x: number; ownY: number } | null = null;
    if (timeS !== null && tMax > 0) {
      const clamped = Math.min(Math.max(timeS, 0), tMax);
      const at = sampleProfile(conflict.profile, clamped);
      if (at !== null) cursor = { x: sx(clamped), ownY: sy(at.ownFt) };
    }
    return { tMax, minAlt, maxAlt, sx, sy, executed, before, intruderAlt, conflictDot, lastSafe, timeTicks, altTicks, cursor };
  }, [conflict, reference, safety, timeS]);

  if (model === null) {
    return (
      <section className="panel">
        <h2>Altitude versus time (ft)</h2>
        <p className="empty">Run the demo to load the altitude profile.</p>
      </section>
    );
  }

  const showCorrected = model.before !== null;

  return (
    <section className="panel">
      <h2>Altitude versus time (ft)</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Altitude versus time chart">
        {model.timeTicks.map((t, index) => (
          <g key={`tt-${index}`}>
            <line
              x1={round1(model.sx(t))}
              y1={round1(model.sy(model.maxAlt))}
              x2={round1(model.sx(t))}
              y2={round1(model.sy(model.minAlt))}
              className="grid"
            />
            <text x={round1(model.sx(t))} y={HEIGHT - 8} className="tick">
              {Math.round(t)}s
            </text>
          </g>
        ))}
        {model.altTicks.map((alt, index) => (
          <g key={`at-${index}`}>
            <line
              x1={round1(model.sx(0))}
              y1={round1(model.sy(alt))}
              x2={round1(model.sx(model.tMax))}
              y2={round1(model.sy(alt))}
              className="grid"
            />
            <text x={4} y={round1(model.sy(alt)) + 4} className="tick">
              {Math.round(alt / 100) / 10}k
            </text>
          </g>
        ))}
        <line
          x1={round1(model.sx(0))}
          y1={round1(model.sy(model.intruderAlt))}
          x2={round1(model.sx(model.tMax))}
          y2={round1(model.sy(model.intruderAlt))}
          className="alt-intruder"
        />
        {model.before !== null ? <polyline points={model.before} className="alt-reference" /> : null}
        <polyline
          points={model.executed}
          className={showCorrected ? 'alt-corrected' : 'alt-incorrect'}
        />
        {model.lastSafe !== null ? (
          <g>
            <line
              x1={round1(model.lastSafe.x)}
              y1={round1(model.sy(model.maxAlt))}
              x2={round1(model.lastSafe.x)}
              y2={round1(model.sy(model.minAlt))}
              className="alt-last-safe"
            />
            <circle cx={round1(model.lastSafe.x)} cy={round1(model.lastSafe.y)} r={4} className="conflict-dot" />
          </g>
        ) : null}
        {model.conflictDot !== null ? (
          <circle
            cx={round1(model.conflictDot.x)}
            cy={round1(model.conflictDot.y)}
            r={5}
            className="conflict-dot"
          />
        ) : null}
        {model.cursor !== null ? (
          <g aria-hidden="true">
            <line
              x1={round1(model.cursor.x)}
              y1={round1(model.sy(model.maxAlt))}
              x2={round1(model.cursor.x)}
              y2={round1(model.sy(model.minAlt))}
              className="alt-cursor"
            />
            <circle
              cx={round1(model.cursor.x)}
              cy={round1(model.cursor.ownY)}
              r={4}
              className="alt-cursor-dot"
            />
          </g>
        ) : null}
      </svg>
      <ul className="legend">
        {showCorrected ? (
          <li><span className="swatch sw-corrected" /> Corrected trajectory (executed)</li>
        ) : (
          <li><span className="swatch sw-incorrect" /> Incorrect trajectory (executed)</li>
        )}
        {model.before !== null ? <li><span className="swatch sw-reference" /> Pre-correction trajectory</li> : null}
        <li><span className="swatch sw-intruder" /> Intruder altitude</li>
        {model.conflictDot !== null ? <li><span className="swatch sw-conflict" /> Conflict point</li> : null}
        {model.lastSafe !== null ? <li><span className="swatch sw-last-safe" /> Last safe correction</li> : null}
      </ul>
    </section>
  );
});
