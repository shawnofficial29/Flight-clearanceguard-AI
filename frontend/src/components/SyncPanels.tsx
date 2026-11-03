import { memo, useEffect, useState } from 'react';
import type { SyncStage } from '../hooks/useSyncConfirmation';
import { useReducedMotion } from '../hooks/usePlayback';
import { SYNC_TRAFFIC_FIX, formatSyncFt, type SyncAltitudes } from '../utils/syncFlow';

/** Roll-up duration for the pilot's altitude setting (ms). */
const ROLL_MS = 800;

function RollingNumber(props: { from: number; to: number }): React.JSX.Element {
  const { from, to } = props;
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(from);
  useEffect(() => {
    if (reduced || from === to || typeof requestAnimationFrame === 'undefined') {
      setDisplay(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (): void => {
      const t = Math.min((performance.now() - start) / ROLL_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, reduced]);
  return <div className="sync-bignum">{formatSyncFt(display)}</div>;
}

export interface SyncPanelsProps {
  altitudes: SyncAltitudes;
  stage: SyncStage;
  atcChoiceFt: number | null;
  correcting: boolean;
  onConfirmAtc: (choiceFt: number) => void;
  onVerifyPilot: () => void;
}

/**
 * ATC SCREEN and COCKPIT side by side. ATC confirms first, then the pilot
 * verifies; both turn green together once the correction resolves.
 */
export const SyncPanels = memo(function SyncPanels(props: SyncPanelsProps): React.JSX.Element {
  const { altitudes, stage, atcChoiceFt, correcting, onConfirmAtc, onVerifyPilot } = props;
  const { atcClearedFt, pilotSetFt, trafficFt } = altitudes;
  const atcTone = stage === 'done' ? 'ok' : stage === 'atc' ? 'alert' : stage === 'alt' ? 'alert' : 'calm';
  const cockpitTone =
    stage === 'done' ? 'ok' : stage === 'pilot' || stage === 'alt' ? 'alert' : 'calm';
  return (
    <section className="sync-panels" aria-label="ATC and cockpit confirmation">
      <div className="panel sync-panel" data-sync={atcTone}>
        <h2>ATC Screen</h2>
        {stage === 'atc' ? (
          <>
            <p className="sync-text">
              {altitudes.callsign} set {formatSyncFt(pilotSetFt)}. You cleared{' '}
              {formatSyncFt(atcClearedFt)}. Which is correct?
            </p>
            <div className="sync-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => onConfirmAtc(atcClearedFt)}
              >
                {formatSyncFt(atcClearedFt)} ✓
              </button>
              <button type="button" onClick={() => onConfirmAtc(pilotSetFt)}>
                {formatSyncFt(pilotSetFt)}
              </button>
            </div>
          </>
        ) : null}
        {stage === 'pilot' ? <p className="sync-text">Waiting for pilot to verify…</p> : null}
        {stage === 'done' ? (
          <p className="sync-text">Clearance synchronized ✓ {formatSyncFt(atcClearedFt)} ft</p>
        ) : null}
        {stage === 'alt' ? (
          <p className="sync-text">
            Traffic at {formatSyncFt(trafficFt)} ft near {SYNC_TRAFFIC_FIX}.
          </p>
        ) : null}
      </div>
      <div className="panel sync-panel" data-sync={cockpitTone}>
        <h2>Cockpit</h2>
        {stage === 'atc' ? <p className="sync-text">Waiting for ATC to confirm…</p> : null}
        {stage === 'pilot' && atcChoiceFt !== null ? (
          <>
            <p className="sync-text">
              ATC confirmed {formatSyncFt(atcChoiceFt)}. You set {formatSyncFt(pilotSetFt)}.
            </p>
            <RollingNumber from={pilotSetFt} to={atcChoiceFt} />
            <div className="sync-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={correcting}
                onClick={onVerifyPilot}
              >
                {correcting ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </>
        ) : null}
        {stage === 'done' ? (
          <p className="sync-text">Clearance synchronized ✓ {formatSyncFt(atcClearedFt)} ft</p>
        ) : null}
        {stage === 'alt' && atcChoiceFt !== null ? (
          <p className="sync-text">ATC confirmed {formatSyncFt(atcChoiceFt)} ✓</p>
        ) : null}
      </div>
    </section>
  );
});
