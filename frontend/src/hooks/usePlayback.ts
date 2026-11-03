import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfilePoint } from '../api/types';
import { PLAYBACK_RATE, advanceTime } from '../utils/playbackMath';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export interface Playback {
  timeS: number;
  tMax: number;
  playing: boolean;
  ended: boolean;
  atConflict: boolean;
  reducedMotion: boolean;
  play: () => void;
  pause: () => void;
  replay: () => void;
  seek: (t: number) => void;
}

/**
 * Frontend-only trajectory playback. The rAF loop only advances sim time;
 * every position is interpolated from backend profile points. Scrub, pause,
 * and replay take effect immediately (interruptible). Under reduced motion
 * there is no loop: play jumps straight to the story beat.
 */
export function usePlayback(
  profile: ProfilePoint[],
  pauseAt: number | null,
  enabled: boolean,
  resetKey: string,
  autoPlay: boolean,
): Playback {
  const reducedMotion = useReducedMotion();
  const tMax = profile.length === 0 ? 0 : profile[profile.length - 1].t_s;
  const [timeS, setTimeS] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [atConflict, setAtConflict] = useState(false);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const timeRef = useRef(0);
  const pauseArmedRef = useRef(true);
  const liveRef = useRef({ pauseAt, tMax, enabled });
  liveRef.current = { pauseAt, tMax, enabled };

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const pause = useCallback(() => {
    stopLoop();
    setPlaying(false);
  }, [stopLoop]);

  const startLoop = useCallback(() => {
    stopLoop();
    lastRef.current = performance.now();
    const tick = (now: number): void => {
      const dt = now - lastRef.current;
      lastRef.current = now;
      const live = liveRef.current;
      const next = advanceTime(
        timeRef.current,
        dt,
        PLAYBACK_RATE,
        live.pauseAt,
        pauseArmedRef.current,
        live.tMax,
      );
      timeRef.current = next.t;
      setTimeS(next.t);
      if (next.hitPause) {
        pauseArmedRef.current = false;
        setAtConflict(true);
      }
      if (next.hitEnd) {
        setEnded(true);
      }
      if (next.hitPause || next.hitEnd || !live.enabled) {
        frameRef.current = null;
        setPlaying(false);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    setPlaying(true);
    setEnded(false);
  }, [stopLoop]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, 0), tMax);
      timeRef.current = clamped;
      if (pauseAt === null || clamped < pauseAt) {
        pauseArmedRef.current = true;
        setAtConflict(false);
      }
      setEnded(clamped >= tMax && tMax > 0);
      setTimeS(clamped);
    },
    [pauseAt, tMax],
  );

  const jumpToBeat = useCallback(() => {
    const target = pauseAt ?? tMax;
    timeRef.current = target;
    pauseArmedRef.current = false;
    setAtConflict(pauseAt !== null);
    setEnded(pauseAt === null);
    setTimeS(target);
    setPlaying(false);
  }, [pauseAt, tMax]);

  const play = useCallback(() => {
    if (!enabled || tMax <= 0) return;
    if (reducedMotion) {
      jumpToBeat();
      return;
    }
    if (timeRef.current >= tMax) {
      timeRef.current = 0;
      pauseArmedRef.current = true;
      setAtConflict(false);
      setEnded(false);
      setTimeS(0);
    }
    startLoop();
  }, [enabled, tMax, reducedMotion, jumpToBeat, startLoop]);

  const replay = useCallback(() => {
    if (!enabled || tMax <= 0) return;
    timeRef.current = 0;
    pauseArmedRef.current = true;
    setAtConflict(false);
    setEnded(false);
    setTimeS(0);
    if (reducedMotion) {
      jumpToBeat();
      return;
    }
    startLoop();
  }, [enabled, tMax, reducedMotion, jumpToBeat, startLoop]);

  // New trajectory (demo run, correction, scenario): reset, then optionally
  // auto-replay once (used for the corrected trajectory only).
  const keyRef = useRef(resetKey);
  const resetDeps = useRef({ autoPlay, enabled, tMax, reducedMotion });
  resetDeps.current = { autoPlay, enabled, tMax, reducedMotion };
  useEffect(() => {
    if (keyRef.current === resetKey) return;
    keyRef.current = resetKey;
    stopLoop();
    timeRef.current = 0;
    pauseArmedRef.current = true;
    setAtConflict(false);
    setEnded(false);
    setPlaying(false);
    setTimeS(0);
    const deps = resetDeps.current;
    if (!deps.autoPlay || !deps.enabled || deps.tMax <= 0) return;
    if (deps.reducedMotion) {
      jumpToBeat();
      return;
    }
    startLoop();
  }, [resetKey, stopLoop, jumpToBeat, startLoop]);

  return { timeS, tMax, playing, ended, atConflict, reducedMotion, play, pause, replay, seek };
}
