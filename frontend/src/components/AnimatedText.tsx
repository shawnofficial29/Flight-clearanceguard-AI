import { memo, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/usePlayback';

/** Fixed tween length so counts settle predictably under any load. */
const TWEEN_MS = 300;

/**
 * Renders a formatted number that eases toward its target over ~300ms
 * whenever the value changes. Mounts show the exact value immediately (no
 * count-up from zero), and reduced motion disables the tween entirely.
 */
export const AnimatedText = memo(function AnimatedText(props: {
  value: number;
  format: (n: number) => string;
}): React.JSX.Element {
  const { value, format } = props;
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const firstRef = useRef(true);

  useEffect(() => {
    if (reduced || firstRef.current) {
      firstRef.current = false;
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const from = displayRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (): void => {
      const t = Math.min((performance.now() - start) / TWEEN_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (value - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  return <>{format(display)}</>;
});
