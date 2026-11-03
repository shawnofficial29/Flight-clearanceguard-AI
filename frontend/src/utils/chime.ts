/** Soft notification chime for the ATC alert. Never throws. */

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const anyWindow = window as unknown & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return anyWindow.AudioContext ?? anyWindow.webkitAudioContext;
}

/**
 * Plays a quiet two-tone chime. Returns false when audio is unavailable or
 * blocked; safe to call from timers and tests.
 */
export function playSoftChime(): boolean {
  try {
    const Ctor = audioCtor();
    if (Ctor === undefined) return false;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    const start = ctx.currentTime;
    const tones: Array<[number, number]> = [
      [660, 0],
      [880, 0.14],
    ];
    for (const [freq, at] of tones) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(start + at);
      osc.stop(start + at + 0.16);
    }
    void ctx.resume().catch(() => undefined);
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 900);
    return true;
  } catch {
    return false;
  }
}
