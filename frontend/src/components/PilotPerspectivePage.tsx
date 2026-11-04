import { memo, useState } from 'react';
import type { CorrectionResult, DemoResult } from '../api/types';
import type { SyncStage } from '../hooks/useSyncConfirmation';
import type { SyncAltitudes } from '../utils/syncFlow';
import { PilotView } from './PilotView';
import './PilotPerspectivePage.css';

/** Cockpit photos served from the public folder: tablet close-up, then wide view. */
const PHOTO_LEFT_SRC = '/cockpit-tablet-closeup.png';
const PHOTO_RIGHT_SRC = '/cockpit-wide.webp';

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
  voiceTranscript: string | null;
  voiceAudioSrc: string | null;
  voiceError: string | null;
  onUploadAudio: (file: File) => void;
  onApplyTranscript: (text: string) => void;
  onBack: () => void;
  onReplay: () => void;
  /** True once the pilot flow has started (top-right shows Replay). */
  started: boolean;
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
    voiceTranscript,
    voiceAudioSrc,
    voiceError,
    onUploadAudio,
    onApplyTranscript,
    onBack,
    onReplay,
    started,
  } = props;
  return (
    <div className="pp-page">
      <header className="pp-bar">
        <button type="button" className="pp-back" onClick={onBack}>
          ← Back to demo
        </button>
        <h1 className="pp-title">PILOT&apos;S PERSPECTIVE</h1>
        <button type="button" className="pp-replay" onClick={onReplay}>
          {started ? '↻ Replay' : 'Start.'}
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
              voiceTranscript={voiceTranscript}
              voiceAudioSrc={voiceAudioSrc}
              voiceError={voiceError}
              onUploadAudio={onUploadAudio}
              onApplyTranscript={onApplyTranscript}
              autoPlay={!started}
            />
          </div>
        </div>
        <div className="pp-divider" aria-hidden="true">
          <span>where it lives: the cockpit tablet</span>
        </div>
        <div className="pp-bottom">
          <div className="pp-photos">
            <CockpitPhoto src={PHOTO_LEFT_SRC} alt="Pilot tablet showing ClearanceGuard" />
            <CockpitPhoto src={PHOTO_RIGHT_SRC} alt="Wide cockpit view with pilot tablets" />
          </div>
          <div className="pp-caption">ClearanceGuard AI, on the tablet of the pilot in the cockpit</div>
        </div>
      </div>
    </div>
  );
});

function CockpitPhoto(props: { src: string; alt: string }): React.JSX.Element {
  const { src, alt } = props;
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
      src={src}
      alt={alt}
      className="pp-photo"
      draggable={false}
      onError={() => setPhotoMissing(true)}
    />
  );
}
