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

export interface PlaybackBarProps {
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

/** Frontend-only simulation playback. Scrubber and buttons are native. */
export const PlaybackBar = memo(function PlaybackBar(props: PlaybackBarProps): React.JSX.Element {
  const { timeS, tMax, playing, ended, atConflict, onPlay, onPause, onReplay, onSeek } = props;
  const status = atConflict
    ? 'Paused at predicted conflict'
    : ended
      ? 'End of predicted trajectory'
      : playing
        ? 'Playing simulation'
        : 'Simulation paused';
  return (
    <div className="playback" role="group" aria-label="Simulation playback">
      <button
        type="button"
        className="playback-toggle"
        aria-label={playing ? 'Pause simulation' : 'Play simulation'}
        onClick={playing ? onPause : onPlay}
      >
        <span className={playing ? 'icon-off' : 'icon-on'} aria-hidden="true">
          <PlayIcon />
        </span>
        <span className={playing ? 'icon-on' : 'icon-off'} aria-hidden="true">
          <PauseIcon />
        </span>
        <span className="playback-label">{playing ? 'Pause' : 'Play'}</span>
      </button>
      <button type="button" aria-label="Replay simulation" onClick={onReplay}>
        <ReplayIcon />
        <span className="playback-label">Replay</span>
      </button>
      <input
        type="range"
        className="playback-scrub"
        aria-label="Simulation timeline"
        min={0}
        max={Math.max(Math.round(tMax), 1)}
        step={1}
        value={Math.round(timeS)}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <span className="playback-readout" aria-live="off">
        T+{Math.round(timeS)}s of {Math.round(tMax)}s · SIMULATION ×{PLAYBACK_RATE}
      </span>
      <span className="playback-status">{status}</span>
    </div>
  );
});
