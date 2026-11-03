import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ConflictPrediction, CorrectionResult, DemoResult } from '../api/types';
import { SimMap } from './SimMap';
import type { SyncStage } from '../hooks/useSyncConfirmation';
import { usePlayback, useReducedMotion } from '../hooks/usePlayback';
import { sampleProfile } from '../utils/playbackMath';
import { formatSyncFt, type SyncAltitudes } from '../utils/syncFlow';
import './PilotView.css';

/**
 * Mismatch banner dwell (ms) before the waiting line appears. Both beats live
 * strictly inside the demo's ATC-confirmation step, so the tablet never leads
 * the main demo; it flips to confirmed/verified at the exact same moment.
 */
const ALERT_MS = 11000;
/** Selected-altitude roll duration (ms); mirrors the cockpit panel roll. */
const ROLL_MS = 800;
/** Scrub step for arrow keys (s); mirrors the demo transport. */
const SCRUB_STEP_S = 10;

/** Tablet playback rate: real-time cockpit pace, not the demo's ×30. */
const TABLET_RATE = 1;
/** Drop-in ATC voice file served from the public folder. */
const ATC_AUDIO_SRC = '/atc-audio.mp3';
/** Example ATC instruction the audio carries; shown as its transcript. */
const ATC_TRANSCRIPT = 'Decrease to 23,000 feet.';

type TabletPhase = 'normal' | 'mismatch' | 'waiting' | 'confirmed' | 'verified' | 'alt';

function RollingNumber(props: { from: number; to: number; onDone: () => void }): React.JSX.Element {
  const { from, to, onDone } = props;
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(from);
  useEffect(() => {
    if (reduced || from === to || typeof requestAnimationFrame === 'undefined') {
      setDisplay(to);
      onDone();
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (): void => {
      const t = Math.min((performance.now() - start) / ROLL_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        onDone();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, reduced, onDone]);
  return <div className="pv-roll pv-num">{formatSyncFt(display)}</div>;
}

function PlayGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M3 1.8 L10.2 6 L3 10.2 Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <rect x="2.6" y="1.8" width="2.6" height="8.4" fill="currentColor" />
      <rect x="6.8" y="1.8" width="2.6" height="8.4" fill="currentColor" />
    </svg>
  );
}

function ReplayGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M6 2 A4.2 4.2 0 1 1 1.9 4.4 M1.6 1.2 L1.6 4.6 L5 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Decorative nav rail glyphs (original geometric marks, not controls). */
const NAV_GLYPHS: string[] = [
  'M2 6.5 L6 2.5 L10 6.5 M3.2 6 L3.2 10 L8.8 10 L8.8 6',
  'M3.5 1.5 L7.5 1.5 L8.5 2.5 L8.5 10.5 L3.5 10.5 Z M4.8 4 L7.2 4 M4.8 6 L7.2 6',
  'M6 10.5 L6 6.5 M6 5.6 A2.1 2.1 0 1 0 6 1.4 A2.1 2.1 0 1 0 6 5.6',
  'M2 3.5 L10 3.5 M2 6 L10 6 M2 8.5 L10 8.5 M4 2.6 L4 4.4 M8 5.1 L8 6.9 M5 7.6 L5 9.4',
  'M6 1.3 A4.7 4.7 0 1 0 6 10.7 A4.7 4.7 0 1 0 6 1.3 M6 5.4 L6 8 M6 3.4 L6 3.6',
];

export interface PilotViewProps {
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
}

/**
 * PILOT'S VIEW: cockpit tablet mirroring the demo. Every control here calls
 * the same handlers and hook as its demo counterpart, so taps do the same
 * thing in both places. Only one page is mounted at a time, so the tablet's
 * playback loop never fights the main map's.
 */
export const PilotView = memo(function PilotView(props: PilotViewProps): React.JSX.Element {
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
  } = props;
  const corrected = correction !== null;

  // The tablet always shows the executed (pre-verification) route: no
  // before/after comparison, so the aircraft never jumps between profiles.
  const conflictPred: ConflictPrediction | null = correction?.conflict ?? demo?.conflict ?? null;
  const historyPred: ConflictPrediction | null = corrected ? (demo?.conflict ?? null) : null;
  const beforeProfile = (corrected ? historyPred?.profile : conflictPred?.profile) ?? [];

  // Playback runs the same hook as the main map, at real-time cockpit pace.
  const loopProfile = conflictPred?.profile ?? [];
  const pauseAt = corrected ? null : (conflictPred?.first_conflict_time_s ?? null);
  const resetKey = `${corrected ? 'corrected' : 'live'}-${loopProfile.length}-${conflictPred?.first_conflict_time_s ?? 'none'}`;
  const playback = usePlayback(
    loopProfile,
    pauseAt,
    conflictPred !== null,
    resetKey,
    corrected,
    TABLET_RATE,
  );

  // Continuity when arriving from the demo page; the loop owns time after that.
  const [mountT] = useState(timeS);
  useEffect(() => {
    playback.seek(mountT);
  }, [mountT, playback.seek]);

  // The aircraft moves continuously from the moment the page opens.
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') return;
    playback.play();
  }, [playback.play]);

  useEffect(() => {
    onTimeChange(playback.timeS);
  }, [playback.timeS, onTimeChange]);

  const sample = beforeProfile.length === 0 ? null : sampleProfile(beforeProfile, playback.timeS);

  const [waitBeat, setWaitBeat] = useState(false);
  useEffect(() => {
    setWaitBeat(false);
    if (demo === null || syncStage !== 'atc') return;
    const timer = setTimeout(() => setWaitBeat(true), ALERT_MS);
    return () => clearTimeout(timer);
  }, [demo, syncStage]);

  const phase: TabletPhase =
    demo === null || syncStage === 'idle'
      ? 'normal'
      : syncStage === 'done'
        ? 'verified'
        : syncStage === 'pilot'
          ? 'confirmed'
          : syncStage === 'alt'
            ? 'alt'
            : waitBeat
              ? 'waiting'
              : 'mismatch';

  const [verifyShown, setVerifyShown] = useState(false);
  useEffect(() => {
    setVerifyShown(false);
  }, [phase, atcChoiceFt]);
  const handleRolled = useCallback(() => setVerifyShown(true), []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioMissing, setAudioMissing] = useState(false);
  const handleListen = useCallback(() => {
    const el = audioRef.current;
    if (el === null) return;
    let started: Promise<void> | undefined;
    try {
      started = el.play();
    } catch {
      setAudioMissing(true);
      return;
    }
    if (started !== undefined) {
      void started.catch(() => setAudioMissing(true));
    }
  }, []);

  const name = syncAlt?.callsign ?? callsign ?? 'META 452';
  const cleared = syncAlt?.atcClearedFt ?? null;
  const setByPilot = syncAlt?.pilotSetFt ?? null;
  const choice = atcChoiceFt ?? cleared;

  const tone =
    phase === 'verified'
      ? 'ok'
      : phase === 'alt'
        ? 'danger'
        : phase === 'mismatch'
          ? 'alert'
          : 'cyan';

  const transportStatus = playback.atConflict
    ? 'Paused at predicted conflict'
    : playback.ended
      ? 'End of predicted trajectory'
      : playback.playing
        ? 'Playing simulation'
        : 'Simulation paused';

  function handleTransportKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    const onButton = target.tagName === 'BUTTON';
    if (event.key === ' ' && !onButton) {
      event.preventDefault();
      if (playback.playing) playback.pause();
      else playback.play();
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && target.tagName !== 'INPUT') {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -SCRUB_STEP_S : SCRUB_STEP_S;
      playback.seek(Math.round(playback.timeS) + delta);
    }
  }

  return (
    <div className="pv-device">
      <div className="pv-screen">
        <div className="pv-glare" aria-hidden="true" />
        <div className="pv-status">
          <span className="pv-brand">ClearanceGuard</span>
          <span className="pv-callsign pv-num">{name}</span>
          <span className="pv-clock pv-num">T+{Math.round(playback.timeS)}s</span>
          <span className="pv-simtag">SIMULATION</span>
        </div>
        <div className="pv-banner" data-tone={phase === 'normal' ? 'dim' : tone}>
          {phase === 'normal' ? <span>Standing by for ATC</span> : null}
          {phase === 'mismatch' ? <span className="pv-pulse">New clearance from ATC — check altitude</span> : null}
          {phase === 'waiting' ? (
            <span className="pv-wait">
              Message sent to ATC — waiting for confirmation…
              <span className="pv-spinner" aria-hidden="true" />
            </span>
          ) : null}
          {phase === 'confirmed' && choice !== null ? (
            <span className="pv-num">ATC approved {formatSyncFt(choice)} ✓</span>
          ) : null}
          {phase === 'verified' ? <span>Notification sent to ATC2 for verification.</span> : null}
          {phase === 'alt' && syncAlt !== null && atcChoiceFt !== null ? (
            <span>
              Warning: ATC says {formatSyncFt(syncAlt.atcClearedFt)}. Do you want to confirm going
              at the altitude of {formatSyncFt(atcChoiceFt)}?
            </span>
          ) : null}
        </div>
        <div className="pv-main">
          <div className="pv-rail" aria-hidden="true">
            {NAV_GLYPHS.map((d, i) => (
              <svg key={i} viewBox="0 0 12 12" width="16" height="16" className="pv-navicon">
                <path
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ))}
          </div>
          <div className="pv-grid">
            <div className="pv-col">
              <section className="pv-card" aria-label="Flight">
                <div className="pv-row">
                  <span className="pv-label">CALLSIGN</span>
                  <span className="pv-val pv-num">{name}</span>
                </div>
                <div className="pv-row">
                  <span className="pv-label">ROUTE</span>
                  <span className="pv-val pv-num">MERIT → PONCT</span>
                </div>
                <div className="pv-row">
                  <span className="pv-label">ALT</span>
                  <span className="pv-val pv-num">
                    {sample === null ? '—' : `${formatSyncFt(sample.ownFt)} ft`}
                  </span>
                </div>
                <div className="pv-row">
                  <span className="pv-label">SPD</span>
                  <span className="pv-val pv-num">
                    {sample === null || sample.ownKt === null ? '—' : `${Math.round(sample.ownKt)} kt`}
                  </span>
                </div>
                <div className="pv-row">
                  <span className="pv-label">CLEARED</span>
                  <span className="pv-val pv-num pv-cyan">
                    {cleared === null ? '—' : `${formatSyncFt(cleared)} ft`}
                  </span>
                </div>
              </section>
              <section className="pv-card pv-clear" data-tone={tone} aria-label="Clearance">
                {phase === 'normal' ? (
                  <div className="pv-line">ATC: maintain 23,000 ft</div>
                ) : null}
                {phase === 'mismatch' ? (
                  <div className="pv-alert pv-pulse">
                    <div className="pv-alert-title">CHECK ALTITUDE</div>
                    {syncAlt === null ? null : (
                      <div className="pv-alert-sub pv-num">
                        ATC cleared {formatSyncFt(syncAlt.atcClearedFt)} · You set{' '}
                        {formatSyncFt(syncAlt.pilotSetFt)}
                      </div>
                    )}
                  </div>
                ) : null}
                {phase === 'waiting' ? (
                  <div className="pv-wait">
                    <div className="pv-line">ATC confirming…</div>
                    <div className="pv-spinner" aria-hidden="true" />
                  </div>
                ) : null}
                {phase === 'confirmed' && choice !== null && setByPilot !== null ? (
                  <>
                    <div className="pv-line pv-num">ATC CONFIRMED {formatSyncFt(choice)}</div>
                    <RollingNumber from={setByPilot} to={choice} onDone={handleRolled} />
                    {verifyShown ? (
                      <button
                        type="button"
                        className="pv-verifybtn pv-press"
                        disabled={correcting}
                        onClick={onVerifyPilot}
                      >
                        {correcting ? 'Verifying…' : 'VERIFY'}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {phase === 'verified' && cleared !== null ? (
                  <>
                    <div className="pv-line">CLEARANCE SYNCHRONIZED ✓</div>
                    <div className="pv-big pv-num">{formatSyncFt(cleared)} ft</div>
                  </>
                ) : null}
                {phase === 'alt' && syncAlt !== null && atcChoiceFt !== null ? (
                  <>
                    <div className="pv-line pv-num">
                      Warning: ATC says {formatSyncFt(syncAlt.atcClearedFt)}. Do you want to confirm
                      going at the altitude of {formatSyncFt(atcChoiceFt)}?
                    </div>
                    <div className="pv-choices" role="group" aria-label="Keep or change the altitude">
                      <button
                        type="button"
                        className="pv-choice"
                        disabled={correcting}
                        onClick={onVerifyPilot}
                      >
                        Yes, keep it on {formatSyncFt(atcChoiceFt)}.
                      </button>
                      <button
                        type="button"
                        className="pv-choice pv-choice-primary"
                        onClick={() => onConfirmAtc(syncAlt.atcClearedFt)}
                      >
                        No, change it to {formatSyncFt(syncAlt.atcClearedFt)}.
                      </button>
                    </div>
                  </>
                ) : null}
                {syncStage === 'atc' && syncAlt !== null ? (
                  <div className="pv-choices" role="group" aria-label="Confirm the correct altitude">
                    <button
                      type="button"
                      className="pv-choice pv-choice-primary"
                      onClick={() => onConfirmAtc(syncAlt.atcClearedFt)}
                    >
                      {formatSyncFt(syncAlt.atcClearedFt)} ✓
                    </button>
                    <button type="button" className="pv-choice" onClick={() => onConfirmAtc(syncAlt.pilotSetFt)}>
                      {formatSyncFt(syncAlt.pilotSetFt)}
                    </button>
                  </div>
                ) : null}
              </section>
              <section className="pv-card pv-audio" aria-label="ATC voice">
                <div className="pv-row">
                  <span className="pv-label">ATC VOICE</span>
                  <button type="button" className="pv-listen" onClick={handleListen}>
                    ▶ Listen
                  </button>
                </div>
                <div className="pv-row">
                  <span className="pv-label">TRANSCRIPT</span>
                </div>
                <div className="pv-transcript pv-num">{ATC_TRANSCRIPT}</div>
                {audioMissing ? (
                  <div className="pv-audiohint">
                    ATC audio file missing — add frontend/public/atc-audio.mp3
                  </div>
                ) : null}
                <audio ref={audioRef} src={ATC_AUDIO_SRC} preload="none" aria-hidden="true" />
              </section>
            </div>
            <div className="pv-mapwrap sim-wrap">
              <SimMap
                conflict={conflictPred}
                history={historyPred}
                corrected={corrected}
                callsign={callsign}
                fixes={fixes}
                atcVia={atcVia}
                timeS={playback.timeS}
                fitKey={resetKey}
              />
            </div>
          </div>
        </div>
        {conflictPred !== null ? (
          <div
            className="pv-transport"
            role="group"
            aria-label="Simulation playback"
            onKeyDown={handleTransportKeyDown}
          >
            <button
              type="button"
              className="pv-tbtn"
              title={playback.playing ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={playback.playing ? 'Pause simulation' : 'Play simulation'}
              onClick={playback.playing ? playback.pause : playback.play}
            >
              {playback.playing ? <PauseGlyph /> : <PlayGlyph />}
            </button>
            <button
              type="button"
              className="pv-tbtn"
              title="Replay"
              aria-label="Replay simulation"
              onClick={playback.replay}
            >
              <ReplayGlyph />
            </button>
            <input
              type="range"
              className="pv-scrub"
              title="Simulation timeline"
              aria-label="Simulation timeline"
              min={0}
              max={Math.max(Math.round(playback.tMax), 1)}
              step={1}
              value={Math.round(playback.timeS)}
              onChange={(event) => playback.seek(Number(event.target.value))}
            />
            <span className="pv-readout pv-num" aria-live="off">
              T+{Math.round(playback.timeS)}s · SIM ×{TABLET_RATE}
            </span>
            {(playback.atConflict || playback.ended) && (
              <span className="pv-tstatus">{transportStatus}</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});
