import { memo } from 'react';
import { PLAYBACK_RATE } from '../utils/playbackMath';

function PlayIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="ctl-icon">
      <path d="M4 2.5 L13 8 L4 13.5 Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="ctl-icon">
      <rect x="3.5" y="2.5" width="3.2" height="11" fill="currentColor" />
      <rect x="9.3" y="2.5" width="3.2" height="11" fill="currentColor" />
    </svg>
  );
}

function ReplayIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="ctl-icon">
      <path
        d="M8 3 A5.2 5.2 0 1 1 2.8 5.5 M3 2 L3 6 L7 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface MapTransportProps {
  timeS: number;
  tMax: number;
  playing: boolean;
  ended: boolean;
  atConflict: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
  onSeek: (t: number) => void;
}

const SCRUB_STEP_S = 10;

/**
 * Compact map-overlay transport. Buttons and the scrubber keep native
 * keyboard behavior; the container adds Space-to-toggle and arrow scrubbing
 * when focus is on non-button parts of the transport.
 */
export const MapTransport = memo(function MapTransport(props: MapTransportProps): React.JSX.Element {
  const { timeS, tMax, playing, ended, atConflict, onPlay, onPause, onReplay, onSeek } = props;
  const status = atConflict
    ? 'Paused at predicted conflict'
    : ended
      ? 'End of predicted trajectory'
      : playing
        ? 'Playing simulation'
        : 'Simulation paused';

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    const onButton = target.tagName === 'BUTTON';
    if (event.key === ' ' && !onButton) {
      event.preventDefault();
      if (playing) onPause();
      else onPlay();
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && target.tagName !== 'INPUT') {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -SCRUB_STEP_S : SCRUB_STEP_S;
      onSeek(Math.round(timeS) + delta);
    }
  }

  return (
    <div className="map-transport" role="group" aria-label="Simulation playback" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="transport-btn transport-toggle"
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause simulation' : 'Play simulation'}
        onClick={playing ? onPause : onPlay}
      >
        <span className={playing ? 'icon-off' : 'icon-on'} aria-hidden="true">
          <PlayIcon />
        </span>
        <span className={playing ? 'icon-on' : 'icon-off'} aria-hidden="true">
          <PauseIcon />
        </span>
      </button>
      <button
        type="button"
        className="transport-btn"
        title="Replay"
        aria-label="Replay simulation"
        onClick={onReplay}
      >
        <ReplayIcon />
      </button>
      <input
        type="range"
        className="transport-scrub"
        title="Simulation timeline"
        aria-label="Simulation timeline"
        min={0}
        max={Math.max(Math.round(tMax), 1)}
        step={1}
        value={Math.round(timeS)}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <span className="transport-readout" aria-live="off">
        T+{Math.round(timeS)}s · SIM ×{PLAYBACK_RATE}
      </span>
      {(atConflict || ended) && <span className="transport-status">{status}</span>}
    </div>
  );
});
