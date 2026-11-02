import type { CorrectionResult, DemoResult } from '../api/types';

type StepState = 'pending' | 'alert' | 'clear' | 'done';

interface Step {
  label: string;
  state: StepState;
  detail: string;
}

function mismatchStep(demo: DemoResult | null): Step {
  if (demo === null) return { label: 'Mismatch Detected', state: 'pending', detail: 'Awaiting demo' };
  const overall = demo.comparison.overall;
  if (overall === 'mismatch') {
    return { label: 'Mismatch Detected', state: 'alert', detail: 'Matrix: mismatch' };
  }
  if (overall === 'agree') {
    return { label: 'Mismatch Detected', state: 'clear', detail: 'Matrix: agree' };
  }
  return { label: 'Mismatch Detected', state: 'alert', detail: 'Matrix: check required' };
}

function conflictStep(demo: DemoResult | null): Step {
  if (demo === null) return { label: 'Conflict Predicted', state: 'pending', detail: 'Awaiting demo' };
  if (demo.conflict.conflict) {
    const t = demo.conflict.first_conflict_time_s;
    return {
      label: 'Conflict Predicted',
      state: 'alert',
      detail: t === null ? 'Loss of separation' : `T+${Math.round(t)} s`,
    };
  }
  return { label: 'Conflict Predicted', state: 'clear', detail: 'No conflict' };
}

function resolutionStep(correction: CorrectionResult | null): Step {
  if (correction === null) {
    return { label: 'Verified Resolution', state: 'pending', detail: 'Awaiting pilot confirmation' };
  }
  if (correction.resolved) {
    return { label: 'Verified Resolution', state: 'done', detail: 'Pilot confirmed, verified' };
  }
  return { label: 'Verified Resolution', state: 'alert', detail: 'Not resolved' };
}

function currentIndex(steps: Step[]): number {
  const pending = steps.findIndex((step) => step.state === 'pending');
  if (pending !== -1) return pending;
  const alert = steps.findIndex((step) => step.state === 'alert');
  return alert === -1 ? steps.length - 1 : alert;
}

/** Three-act story indicator. Steps 1-2 reflect the original demo run. */
export function DemoStepper(props: {
  demo: DemoResult | null;
  correction: CorrectionResult | null;
}): React.JSX.Element {
  const { demo, correction } = props;
  const steps = [mismatchStep(demo), conflictStep(demo), resolutionStep(correction)];
  const current = currentIndex(steps);
  return (
    <ol className="stepper" aria-label="Demo progress">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className="step"
          data-state={step.state}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="step-index" aria-hidden="true">
            {index + 1}
          </span>
          <span className="step-text">
            <span className="step-label">{step.label}</span>
            <span className="step-detail">{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
