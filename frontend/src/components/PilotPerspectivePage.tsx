import { memo, useState } from 'react';
import type { CorrectionResult, DemoResult } from '../api/types';
import type { SyncStage } from '../hooks/useSyncConfirmation';
import type { SyncAltitudes } from '../utils/syncFlow';
import { PilotView } from './PilotView';
import './PilotPerspectivePage.css';

/** Cockpit photo served from the public folder. */
const PHOTO_SRC = '/cockpit-tablet.webp';

export interface PilotPerspectivePageProps {
  demo: DemoResult | null;
  correction: CorrectionResult | null;
  callsign: string | null;
  timeS: number;
  syncStage: SyncStage;
  atcChoiceFt: number | null;
  syncAlt: SyncAltitudes | null;
  correcting: boolean;
  fixes: string[];
  atcVia: string | null;
  onConfirmAtc: (choiceFt: number) => void;
  onVerifyPilot: () => void;
  onTimeChange: (t: number) => void;
  onBack: () => void;
  onReplay: () => void;
}

/**
 * Pilot's Perspective page: title bar, then an exact 50/50 horizontal split.
 * Top shows the pilot's live ClearanceGuard tablet; bottom shows the cockpit
 * photo it lives on. Every tablet control calls the same handler as its demo
 * counterpart.
 */
export const PilotPerspectivePage = memo(function PilotPerspectivePage(
  props: PilotPerspectivePageProps,
): React.JSX.Element {
  const {
    demo,
    correction,
    callsign,
    timeS,
    syncStage,
    atcChoiceFt,
    syncAlt,
    correcting,
    fixes,
    atcVia,
    onConfirmAtc,
    onVerifyPilot,
    onTimeChange,
    onBack,
    onReplay,
  } = props;
  return (
    <div className="pp-page">
      <header className="pp-bar">
        <button type="button" className="pp-back" onClick={onBack}>
          ← Back to demo
        </button>
        <h1 className="pp-title">PILOT&apos;S PERSPECTIVE</h1>
        <button type="button" className="pp-replay" onClick={onReplay}>
          {demo === null ? 'Start.' : '↻ Replay'}
        </button>
      </header>
      <div className="pp-split">
        <div className="pp-top">
          <div className="pp-tablet">
            <PilotView
              demo={demo}
              correction={correction}
              callsign={callsign}
              timeS={timeS}
              syncStage={syncStage}
              atcChoiceFt={atcChoiceFt}
              syncAlt={syncAlt}
              correcting={correcting}
              fixes={fixes}
              atcVia={atcVia}
              onConfirmAtc={onConfirmAtc}
              onVerifyPilot={onVerifyPilot}
              onTimeChange={onTimeChange}
            />
          </div>
        </div>
        <div className="pp-divider" aria-hidden="true">
          <span>where it lives: the cockpit tablet</span>
        </div>
        <div className="pp-bottom">
          <CockpitPhoto />
          <div className="pp-caption">PMDG 777 cockpit — the pilot&apos;s EFB tablet</div>
        </div>
      </div>
    </div>
  );
});

function CockpitPhoto(): React.JSX.Element {
  const [photoMissing, setPhotoMissing] = useState(false);
  if (photoMissing) {
    return (
      <div className="pp-photo-fallback" role="status">
        Cockpit photo unavailable.
      </div>
    );
  }
  return (
    <img
      src={PHOTO_SRC}
      alt="Cockpit tablet"
      className="pp-photo"
      draggable={false}
      onError={() => setPhotoMissing(true)}
    />
  );
}
