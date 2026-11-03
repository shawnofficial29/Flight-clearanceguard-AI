import type { DemoResult } from '../api/types';
import type { SyncStage } from '../hooks/useSyncConfirmation';
import { formatSyncFt } from '../utils/syncFlow';

type StepState = 'pending' | 'alert' | 'clear' | 'done';

export interface SyncStepState {
  stage: Exclude<SyncStage, 'idle'>;
  atcClearedFt: number;
  pilotSetFt: number;
  confirmedFt: number | null;
}

interface Step {
  label: string;
  state: StepState;
  detail: string;
}

function pendingSteps(): Step[] {
  return [
    { label: 'Mismatch caught', state: 'pending', detail: 'Awaiting demo' },
    { label: 'ATC confirmed', state: 'pending', detail: 'Awaiting ATC confirmation' },
    { label: 'Pilot verified', state: 'pending', detail: 'Awaiting pilot verification' },
  ];
}

function syncSteps(demo: DemoResult | null, sync: SyncStepState): Step[] {
  const first: Step =
    demo === null
      ? { label: 'Mismatch caught', state: 'pending', detail: 'Awaiting demo' }
      : demo.comparison.overall === 'mismatch'
        ? {
            label: 'Mismatch caught',
            state: 'done',
            detail: `set ${formatSyncFt(sync.pilotSetFt)}, cleared ${formatSyncFt(sync.atcClearedFt)}`,
          }
        : { label: 'Mismatch caught', state: 'clear', detail: 'No mismatch' };
  const second: Step =
    sync.confirmedFt === null
      ? {
          label: 'ATC confirmed',
          state: 'pending',
          detail: 'Awaiting ATC confirmation',
        }
      : {
          label: 'ATC confirmed',
          state: 'done',
          detail: `${formatSyncFt(sync.confirmedFt)} is correct`,
        };
  const third: Step =
    sync.stage === 'done'
      ? { label: 'Pilot verified', state: 'done', detail: 'everyone agrees' }
      : {
          label: 'Pilot verified',
          state: 'pending',
          detail: 'Awaiting pilot verification',
        };
  return [first, second, third];
}

function currentIndex(steps: Step[]): number {
  const pending = steps.findIndex((step) => step.state === 'pending');
  if (pending !== -1) return pending;
  const alert = steps.findIndex((step) => step.state === 'alert');
  return alert === -1 ? steps.length - 1 : alert;
}

function StepCheck(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="step-check">
      <path
        d="M3.5 8.5 L7 12 L12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Three-act confirmation indicator: mismatch caught, ATC confirmed, pilot verified. */
export function DemoStepper(props: {
  demo: DemoResult | null;
  sync?: SyncStepState | null;
}): React.JSX.Element {
  const { demo, sync = null } = props;
  const steps = sync !== null ? syncSteps(demo, sync) : pendingSteps();
  const current = currentIndex(steps);
  const progress =
    sync === null || demo === null
      ? 0
      : sync.stage === 'done'
        ? 2
        : sync.confirmedFt !== null
          ? 1
          : 0;
  const complete = steps[steps.length - 1].state === 'done';
  return (
    <ol className="stepper" aria-label="Demo progress">
      <li aria-hidden="true" className="stepper-track">
        <div
          className={complete ? 'stepper-fill is-complete' : 'stepper-fill'}
          style={{ width: `${(progress / (steps.length - 1)) * 100}%` }}
        />
      </li>
      {steps.map((step, index) => (
        <li
          key={step.label}
          className="step"
          data-state={step.state}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="step-index" aria-hidden="true">
            {step.state === 'done' || step.state === 'clear' ? <StepCheck /> : index + 1}
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
