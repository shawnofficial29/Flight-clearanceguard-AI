import { memo, useMemo } from 'react';
import type { ConflictPrediction } from '../api/types';
import type { MapViewMode } from './SimMap';
import { sampleProfile } from '../utils/playbackMath';

const WIDTH = 760;
const HEIGHT = 220;
const PAD_LEFT = 56;
const PAD_RIGHT = 14;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

/** Vertical-profile axis clamps (presentation only, backend values untouched). */
const AXIS_FLOOR = 8000;
const AXIS_CEIL = 24000;
const MERIT_X = 20;
const PONCT_X = 60;
const TICK_STEPS = [250, 500, 1000, 2000, 2500, 5000, 10000];
const MAX_TICKS = 6;

interface AltitudeDomain {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * Fits the altitude axis to the plotted data so small level changes stay
 * visible; wide datasets keep the familiar 14,000–24,000 framing.
 */
function altitudeDomain(values: number[]): AltitudeDomain {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, 1);
  const padded = Math.max(span * 1.3, 1000);
  const step =
    TICK_STEPS.find((candidate) => Math.floor(padded / candidate) + 1 <= MAX_TICKS) ?? 10000;
  const min = Math.max(AXIS_FLOOR, Math.floor((lo - span * 0.15) / step) * step);
  // The ceiling lifts only when the data itself runs higher (traffic at
  // 30,000 ft); lower datasets keep the familiar framing untouched.
  const ceil = Math.max(AXIS_CEIL, Math.ceil(hi / step) * step);
  let max = Math.min(ceil, Math.ceil((hi + span * 0.15) / step) * step);
  if (max <= min) max = Math.min(ceil, min + step);
  const ticks: number[] = [];
  for (let tick = min; tick <= max + 1e-9; tick += step) ticks.push(Math.round(tick));
  return { min, max, ticks };
}

/** Small side-view aircraft dart pointing east. */
const SIDE_PLANE = 'M10,0 L-8,-4.5 L-4,0 L-8,4.5 Z';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatFt(ft: number): string {
  return Math.round(ft).toLocaleString('en-US');
}

export interface SideViewProps {
  /** Pre-correction profile (what the wrong setting would do). */
  before: ConflictPrediction | null;
  /** Corrected profile once verification exists. */
  after: ConflictPrediction | null;
  view: MapViewMode;
  /** Shared playback time; drives both plane icons in sync with the map. */
  timeS: number;
}

export const SideView = memo(function SideView(props: SideViewProps): React.JSX.Element | null {
  const { before, after, view, timeS } = props;

  const model = useMemo(() => {
    if (before === null || before.profile.length === 0) return null;
    let xMax = PONCT_X;
    const altitudes: number[] = [];
    for (const profile of [before.profile, after?.profile ?? []]) {
      for (const point of profile) {
        xMax = Math.max(xMax, point.meta_x_nm);
        altitudes.push(point.meta_ft, point.intruder_ft);
      }
    }
    const domain = altitudeDomain(altitudes);
    const sx = (x: number): number =>
      PAD_LEFT + (x / xMax) * (WIDTH - PAD_LEFT - PAD_RIGHT);
    const sy = (alt: number): number =>
      PAD_TOP +
      ((domain.max - alt) / (domain.max - domain.min)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
    const lineOf = (profile: ConflictPrediction['profile']): string =>
      profile.map((point) => `${round1(sx(point.meta_x_nm))},${round1(sy(point.meta_ft))}`).join(' ');
    const beforeLine = lineOf(before.profile);
    const afterLine = after === null ? null : lineOf(after.profile);
    const intruderFt =
      before.profile[0]?.intruder_ft ?? after?.profile[0]?.intruder_ft ?? domain.max;

    const flashOn = view === 'after' ? after : before;
    let flash: { x: number; y: number } | null = null;
    if (
      flashOn !== null &&
      flashOn.conflict &&
      flashOn.first_conflict_time_s !== null
    ) {
      const at = sampleProfile(flashOn.profile, flashOn.first_conflict_time_s);
      if (at !== null) flash = { x: sx(at.ownX), y: sy(at.ownFt) };
    }

    let bracket: { x: number; ownY: number; tfcY: number } | null = null;
    if (after !== null && !after.conflict && after.profile.length > 0) {
      // The bracket sits where the two aircraft are laterally closest (the
      // crossing); a minimum-vertical search would slide it to the level-off
      // far past the crossing instead.
      let closest = after.profile[0];
      let gap = Number.POSITIVE_INFINITY;
      for (const point of after.profile) {
        const lateral = Math.hypot(
          point.meta_x_nm - point.intruder_x_nm,
          point.intruder_y_nm,
        );
        if (lateral < gap) {
          gap = lateral;
          closest = point;
        }
      }
      bracket = { x: sx(closest.meta_x_nm), ownY: sy(closest.meta_ft), tfcY: sy(closest.intruder_ft) };
    }

    const visible = view === 'after' && after !== null ? after.profile : before.profile;
    const now = sampleProfile(visible, timeS);
    const ownNow = now === null ? null : { x: sx(now.ownX), y: sy(now.ownFt) };
    const tfcNow = now === null ? null : { x: sx(now.ownX), y: sy(now.tfcFt) };
    return {
      xMax, sx, sy, domain, beforeLine, afterLine, intruderFt, flash, bracket,
      ownNow, tfcNow, separationFt: after?.min_vertical_ft ?? null,
    };
  }, [before, after, view, timeS]);

  if (model === null) return null;

  const bracketLabelOnRight = model.bracket !== null && model.bracket.x < WIDTH - 190;

  return (
    <section className="panel sideview" aria-label="Side view">
      <h2>Side view (vertical profile)</h2>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={view === 'after' ? 'sv-after' : 'sv-before'}
        role="img"
        aria-label="Vertical profile: altitude versus distance along route"
      >
        {model.domain.ticks.map((alt) => (
          <g key={`sv-y-${alt}`}>
            <line
              x1={round1(model.sx(0))}
              y1={round1(model.sy(alt))}
              x2={round1(model.sx(model.xMax))}
              y2={round1(model.sy(alt))}
              className="grid"
            />
            <text x={4} y={round1(model.sy(alt)) + 4} className="tick">
              {formatFt(alt)}
            </text>
          </g>
        ))}
        {[0, 20, 40, 60].map((x) => (
          <line
            key={`sv-x-${x}`}
            x1={round1(model.sx(x))}
            y1={round1(model.sy(model.domain.min))}
            x2={round1(model.sx(x))}
            y2={round1(model.sy(model.domain.max))}
            className={x === MERIT_X || x === PONCT_X ? 'sv-fix' : 'grid'}
          />
        ))}
        <text x={round1(model.sx(MERIT_X)) - 18} y={HEIGHT - 10} className="label">
          MERIT
        </text>
        <text x={round1(model.sx(PONCT_X)) - 20} y={HEIGHT - 10} className="label">
          PONCT
        </text>
        <text x={WIDTH - 30} y={HEIGHT - 10} className="tick">
          NM
        </text>

        <line
          x1={round1(model.sx(0))}
          y1={round1(model.sy(model.intruderFt))}
          x2={round1(model.sx(model.xMax))}
          y2={round1(model.sy(model.intruderFt))}
          className="sv-intruder"
        />
        <polyline points={model.beforeLine} className="sv-before-line" />
        {model.afterLine !== null ? (
          <polyline points={model.afterLine} className="sv-after-line" />
        ) : null}

        {model.bracket !== null && model.separationFt !== null ? (
          <g className="sv-bracket" aria-hidden="true">
            <line
              x1={round1(model.bracket.x)}
              y1={round1(model.bracket.ownY)}
              x2={round1(model.bracket.x)}
              y2={round1(model.bracket.tfcY)}
              className="sv-bracket-line"
            />
            <line
              x1={round1(model.bracket.x - 5)}
              y1={round1(model.bracket.ownY)}
              x2={round1(model.bracket.x + 5)}
              y2={round1(model.bracket.ownY)}
              className="sv-bracket-line"
            />
            <line
              x1={round1(model.bracket.x - 5)}
              y1={round1(model.bracket.tfcY)}
              x2={round1(model.bracket.x + 5)}
              y2={round1(model.bracket.tfcY)}
              className="sv-bracket-line"
            />
            <text
              x={round1(model.bracket.x + (bracketLabelOnRight ? 8 : -8))}
              y={round1((model.bracket.ownY + model.bracket.tfcY) / 2) + 4}
              textAnchor={bracketLabelOnRight ? 'start' : 'end'}
              className="sv-bracket-label"
            >
              {formatFt(model.separationFt)} ft separation
            </text>
          </g>
        ) : null}

        {model.flash !== null ? (
          <g
            className="sv-flash-g"
            transform={`translate(${round1(model.flash.x)} ${round1(model.flash.y)})`}
            aria-hidden="true"
          >
            <circle r={9} className="sv-flash-ring" />
            <circle r={4.5} className="sv-flash" />
          </g>
        ) : null}

        {model.ownNow !== null && model.tfcNow !== null ? (
          <g aria-hidden="true">
            <g
              className="sv-glide"
              style={{ transform: `translate(${round1(model.ownNow.x)}px, 0px)` }}
            >
              <line
                x1={0}
                y1={round1(model.sy(model.domain.min))}
                x2={0}
                y2={round1(model.sy(model.domain.max))}
                className="sv-cursor"
              />
            </g>
            <g
              className="sv-glide"
              style={{
                transform: `translate(${round1(model.tfcNow.x)}px, ${round1(model.tfcNow.y)}px)`,
              }}
            >
              <path d={SIDE_PLANE} className="sv-plane-tfc" />
            </g>
            <g
              className="sv-glide"
              style={{
                transform: `translate(${round1(model.ownNow.x)}px, ${round1(model.ownNow.y)}px)`,
              }}
            >
              <path
                d={SIDE_PLANE}
                className={view === 'after' ? 'sv-plane-after' : 'sv-plane-before'}
              />
            </g>
          </g>
        ) : null}
      </svg>
      <ul className="legend">
        <li><span className="swatch sw-incorrect" /> Descent before correction</li>
        {after !== null ? <li><span className="swatch sw-corrected" /> Descent after correction</li> : null}
        <li><span className="swatch sw-intruder" /> Intruder (holding)</li>
      </ul>
    </section>
  );
});
