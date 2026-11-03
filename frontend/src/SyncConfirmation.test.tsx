import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DemoStepper } from './components/DemoStepper';
import { ConversationStrip } from './components/ConversationStrip';
import { SyncPanels } from './components/SyncPanels';
import { SimMap } from './components/SimMap';
import { useSyncConfirmation } from './hooks/useSyncConfirmation';
import { playSoftChime } from './utils/chime';
import { syncAltitudes } from './utils/syncFlow';
import { makeSyncConflict, makeSyncCorrection, makeSyncDemo } from './test/fixtures';
import type { CorrectionResult, DemoResult } from './api/types';

const ALTITUDES = {
  callsign: 'META 452',
  atcClearedFt: 23000,
  pilotSetFt: 22000,
  trafficFt: 22000,
};

afterEach(() => {
  cleanup();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('syncAltitudes', () => {
  it('reads callsign, clearance, setting, and traffic from demo data', () => {
    expect(syncAltitudes(makeSyncDemo())).toEqual(ALTITUDES);
    expect(syncAltitudes(null)).toBeNull();
  });
});

describe('playSoftChime', () => {
  it('never throws when audio is unavailable', () => {
    expect(typeof playSoftChime()).toBe('boolean');
  });
});

describe('ConversationStrip', () => {
  it('shows the radio exchange with the mismatch highlighted', () => {
    const { container } = render(<ConversationStrip altitudes={ALTITUDES} sorted={false} />);
    const text = container.textContent ?? '';
    expect(text).toContain('META 452, maintain');
    expect(text).toContain('23,000 ft.');
    expect(text).toContain('Maintain');
    expect(text).toContain('22,000, META 452.');
    const bad = screen.getByText('22,000');
    expect(bad.className).toContain('num-bad');
    expect(bad.className).toContain('sync-shake');
    expect(text).not.toContain('Maintain 23,000.');
  });

  it('adds green confirmation bubbles once sorted', () => {
    const { container } = render(<ConversationStrip altitudes={ALTITUDES} sorted />);
    const text = container.textContent ?? '';
    expect(text).toContain('Maintain 23,000.');
    expect(text).toContain('Maintain 23,000, META 452.');
    expect(container.querySelector('.num-bad')).toBeNull();
    expect(container.querySelectorAll('.num-ok')).toHaveLength(2);
  });
});

describe('SyncPanels', () => {
  const noop = (): void => {};

  function renderPanels(
    stage: 'atc' | 'pilot' | 'done' | 'alt',
    props: { atcChoiceFt?: number | null; onConfirmAtc?: (ft: number) => void; onVerifyPilot?: () => void } = {},
  ) {
    return render(
      <SyncPanels
        altitudes={ALTITUDES}
        stage={stage}
        atcChoiceFt={props.atcChoiceFt ?? null}
        correcting={false}
        onConfirmAtc={props.onConfirmAtc ?? noop}
        onVerifyPilot={props.onVerifyPilot ?? noop}
      />,
    );
  }

  it('asks ATC first while the cockpit waits', () => {
    const onConfirmAtc = vi.fn();
    renderPanels('atc', { onConfirmAtc });
    expect(screen.getByText('META 452 set 22,000. You cleared 23,000. Which is correct?')).not.toBeNull();
    expect(screen.getByText('Waiting for ATC to confirm…')).not.toBeNull();
    fireEvent.click(screen.getByText('23,000 ✓'));
    expect(onConfirmAtc).toHaveBeenCalledWith(23000);
    fireEvent.click(screen.getByText('22,000'));
    expect(onConfirmAtc).toHaveBeenCalledWith(22000);
    expect(screen.queryByText('Verify')).toBeNull();
  });

  it('rolls the cockpit setting up and verifies on tap', async () => {
    const onVerifyPilot = vi.fn();
    renderPanels('pilot', { atcChoiceFt: 23000, onVerifyPilot });
    expect(screen.getByText('ATC confirmed 23,000. You set 22,000.')).not.toBeNull();
    expect(screen.getByText('Waiting for pilot to verify…')).not.toBeNull();
    expect(screen.getByText('22,000')).not.toBeNull();
    await waitFor(
      () => {
        expect(screen.getByText('23,000')).not.toBeNull();
      },
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByText('Verify'));
    expect(onVerifyPilot).toHaveBeenCalledTimes(1);
  });

  it('turns both panels green together when sorted', () => {
    const { container } = renderPanels('done', { atcChoiceFt: 23000 });
    expect(screen.getAllByText('Clearance synchronized ✓ 23,000 ft')).toHaveLength(2);
    expect(container.querySelectorAll('[data-sync="ok"]')).toHaveLength(2);
  });

  it('warns instead of resolving when ATC confirms the traffic altitude', () => {
    renderPanels('alt', { atcChoiceFt: 22000 });
    expect(screen.getByText('ATC confirmed 22,000 ✓')).not.toBeNull();
    expect(screen.getByText('Traffic at 22,000 ft near MERIT.')).not.toBeNull();
    expect(screen.queryByText('Verify')).toBeNull();
    expect(screen.queryByText(/Clearance synchronized/)).toBeNull();
  });
});

describe('useSyncConfirmation', () => {
  function Harness(props: {
    demo: DemoResult | null;
    correction: CorrectionResult | null;
    choice: number;
    onSorted: () => void;
  }) {
    const sync = useSyncConfirmation({
      enabled: true,
      demo: props.demo,
      correction: props.correction,
      atcClearedFt: 23000,
      onSorted: props.onSorted,
      stepMs: 30,
    });
    return (
      <div
        data-stage={sync.stage}
        data-choice={sync.atcChoiceFt ?? 'none'}
        data-verified={String(sync.pilotVerified)}
      >
        <button type="button" onClick={() => sync.confirmAtc(props.choice)}>
          confirm
        </button>
      </div>
    );
  }

  function stageOf(container: Element): string | null {
    return container.firstElementChild?.getAttribute('data-stage') ?? null;
  }

  it('autoplays ATC confirm then pilot verify in order', async () => {
    const onSorted = vi.fn();
    const { container } = render(
      <Harness demo={makeSyncDemo()} correction={null} choice={23000} onSorted={onSorted} />,
    );
    expect(stageOf(container)).toBe('atc');
    await waitFor(() => {
      expect(stageOf(container)).toBe('pilot');
    });
    expect(container.firstElementChild?.getAttribute('data-choice')).toBe('23000');
    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-verified')).toBe('true');
    });
    expect(onSorted).toHaveBeenCalledTimes(1);
  });

  it('lets a manual tap take over autoplay', async () => {
    const onSorted = vi.fn();
    const { container } = render(
      <Harness demo={makeSyncDemo()} correction={null} choice={23000} onSorted={onSorted} />,
    );
    fireEvent.click(screen.getByText('confirm'));
    expect(stageOf(container)).toBe('pilot');
    await act(async () => {
      await sleep(150);
    });
    expect(container.firstElementChild?.getAttribute('data-verified')).toBe('false');
    expect(onSorted).not.toHaveBeenCalled();
  });

  it('holds on the alternate ATC choice without auto-verifying', async () => {
    const onSorted = vi.fn();
    const { container } = render(
      <Harness demo={makeSyncDemo()} correction={null} choice={22000} onSorted={onSorted} />,
    );
    fireEvent.click(screen.getByText('confirm'));
    expect(stageOf(container)).toBe('alt');
    await act(async () => {
      await sleep(150);
    });
    expect(onSorted).not.toHaveBeenCalled();
  });
});

describe('sync stepper and map tag', () => {
  it('labels the three sync steps from data', () => {
    render(
      <DemoStepper
        demo={makeSyncDemo()}
        sync={{ stage: 'atc', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: null }}
      />,
    );
    expect(screen.getByText('Mismatch caught')).not.toBeNull();
    expect(screen.getByText('set 22,000, cleared 23,000')).not.toBeNull();
    expect(screen.getByText('ATC confirmed')).not.toBeNull();
    expect(screen.getByText('Pilot verified')).not.toBeNull();
  });

  it('marks ATC confirmed and pilot verified from sync state', () => {
    render(
      <DemoStepper
        demo={makeSyncDemo()}
        sync={{ stage: 'done', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: 23000 }}
      />,
    );
    expect(screen.getByText('23,000 is correct')).not.toBeNull();
    expect(screen.getByText('everyone agrees')).not.toBeNull();
  });

  it('tags the verified sync map with height above traffic', () => {
    const { container } = render(
      <SimMap
        conflict={makeSyncCorrection().conflict}
        history={makeSyncConflict()}
        corrected
        callsign="META 452"
        fixes={[]}
        atcVia={null}
        timeS={0}
        fitKey="sync"
        view="after"
        onViewChange={() => {}}
      />,
    );
    expect(screen.getByText('1,000 ft above traffic ✓')).not.toBeNull();
    expect(screen.queryByText(/Conflict cleared/)).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/collision|crash/i);
  });

  it('keeps the before view on the counterfactual descent', () => {
    render(
      <SimMap
        conflict={makeSyncConflict()}
        history={null}
        corrected={false}
        callsign="META 452"
        fixes={[]}
        atcVia={null}
        timeS={0}
        fitKey="sync"
        view="before"
        onViewChange={() => {}}
      />,
    );
    expect(screen.getByText('Conflict · 22,000 ft')).not.toBeNull();
  });

  it('never shows collision or crash language in the sync flow', () => {
    const { container } = render(
      <>
        <ConversationStrip altitudes={ALTITUDES} sorted={false} />
        <SyncPanels
          altitudes={ALTITUDES}
          stage="pilot"
          atcChoiceFt={23000}
          correcting={false}
          onConfirmAtc={() => {}}
          onVerifyPilot={() => {}}
        />
        <DemoStepper
          demo={makeSyncDemo()}
          sync={{ stage: 'pilot', atcClearedFt: 23000, pilotSetFt: 22000, confirmedFt: 23000 }}
        />
      </>,
    );
    expect(container.textContent ?? '').not.toMatch(/collision|crash/i);
  });
});
