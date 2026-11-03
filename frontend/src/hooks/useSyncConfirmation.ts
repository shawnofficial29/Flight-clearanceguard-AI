import { useCallback, useEffect, useRef, useState } from 'react';
import type { CorrectionResult, DemoResult } from '../api/types';
import { playSoftChime } from '../utils/chime';
import { SYNC_STEP_MS } from '../utils/syncFlow';

export type SyncStage = 'idle' | 'atc' | 'pilot' | 'done' | 'alt';

export interface SyncConfirmation {
  stage: SyncStage;
  atcChoiceFt: number | null;
  pilotVerified: boolean;
  auto: boolean;
  confirmAtc: (choiceFt: number) => void;
  verifyPilot: () => void;
  reset: () => void;
}

/**
 * Two-step confirmation state: ATC confirms first, then the pilot verifies.
 * Demo autoplay advances both steps on timers; any manual tap takes over.
 * Presentation state only — altitudes and verification come from the backend.
 */
export function useSyncConfirmation(args: {
  enabled: boolean;
  demo: DemoResult | null;
  correction: CorrectionResult | null;
  atcClearedFt: number | null;
  onSorted: () => void;
  stepMs?: number;
}): SyncConfirmation {
  const { enabled, demo, correction, atcClearedFt, onSorted, stepMs = SYNC_STEP_MS } = args;
  const [atcChoiceFt, setAtcChoiceFt] = useState<number | null>(null);
  const [pilotVerified, setPilotVerified] = useState(false);
  const [auto, setAuto] = useState(true);
  const onSortedRef = useRef(onSorted);
  onSortedRef.current = onSorted;
  const chimedRef = useRef(false);

  const reset = useCallback(() => {
    setAtcChoiceFt(null);
    setPilotVerified(false);
    setAuto(true);
    chimedRef.current = false;
  }, []);

  // A new demo run restarts the loop.
  useEffect(() => {
    reset();
  }, [demo, enabled, reset]);

  const sorted = correction !== null && correction.resolved && pilotVerified;
  const altChoice =
    atcChoiceFt !== null && atcClearedFt !== null && atcChoiceFt !== atcClearedFt;
  const stage: SyncStage =
    !enabled || demo === null
      ? 'idle'
      : sorted
        ? 'done'
        : atcChoiceFt === null
          ? 'atc'
          : altChoice
            ? 'alt'
            : 'pilot';

  // Soft chime when the ATC alert first appears.
  useEffect(() => {
    if (stage !== 'atc' || chimedRef.current) return;
    chimedRef.current = true;
    playSoftChime();
  }, [stage]);

  const confirmAtc = useCallback((choiceFt: number) => {
    setAuto(false);
    setAtcChoiceFt(choiceFt);
  }, []);

  const verifyPilot = useCallback(() => {
    setAuto(false);
    setPilotVerified(true);
    onSortedRef.current();
  }, []);

  // Demo autoplay: ATC confirms the cleared value, then the pilot verifies.
  // The alternate ATC choice is never auto-played.
  useEffect(() => {
    if (!enabled || !auto || demo === null || correction !== null) return;
    if (atcChoiceFt !== null || pilotVerified || atcClearedFt === null) return;
    const timer = setTimeout(() => setAtcChoiceFt(atcClearedFt), stepMs);
    return () => clearTimeout(timer);
  }, [enabled, auto, demo, correction, atcChoiceFt, pilotVerified, atcClearedFt, stepMs]);

  useEffect(() => {
    if (!enabled || !auto || atcChoiceFt === null || pilotVerified || correction !== null) return;
    if (atcChoiceFt !== atcClearedFt) return;
    const timer = setTimeout(() => {
      setPilotVerified(true);
      onSortedRef.current();
    }, stepMs);
    return () => clearTimeout(timer);
  }, [enabled, auto, atcChoiceFt, atcClearedFt, pilotVerified, correction, stepMs]);

  return { stage, atcChoiceFt, pilotVerified, auto, confirmAtc, verifyPilot, reset };
}
