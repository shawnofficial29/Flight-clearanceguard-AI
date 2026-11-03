import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PilotPerspectivePage,
  type PilotPerspectivePageProps,
} from './PilotPerspectivePage';
import { makeSyncDemo } from '../test/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function baseProps(overrides: Partial<PilotPerspectivePageProps> = {}): PilotPerspectivePageProps {
  return {
    demo: makeSyncDemo(),
    correction: null,
    callsign: 'META 452',
    timeS: 100,
    syncStage: 'atc',
    syncAlt: {
      callsign: 'META 452',
      atcClearedFt: 23000,
      pilotSetFt: 22000,
      trafficFt: 22000,
    },
    correcting: false,
    atcChoiceFt: null,
    fixes: [],
    atcVia: null,
    onBack: () => {},
    onReplay: () => {},
    onConfirmAtc: () => {},
    onVerifyPilot: () => {},
    onTimeChange: () => {},
    ...overrides,
  };
}

describe('PilotPerspectivePage', () => {
  it('shows the pilot tablet on top and the cockpit photo below', () => {
    const { container } = render(<PilotPerspectivePage {...baseProps()} />);
    expect(container.querySelector('.pp-top .pv-device')).not.toBeNull();
    expect(screen.getByText('ClearanceGuard')).not.toBeNull();
    const photo = container.querySelector('.pp-bottom img.pp-photo') as HTMLImageElement | null;
    expect(photo?.getAttribute('src')).toBe('/cockpit-tablet.webp');
  });

  it('shows Start before the demo runs and Replay after', () => {
    const idle = baseProps({
      demo: null,
      callsign: null,
      timeS: 0,
      syncStage: 'idle',
      syncAlt: null,
    });
    const { rerender } = render(<PilotPerspectivePage {...idle} />);
    expect(screen.getByText('Start.')).not.toBeNull();
    expect(screen.queryByText('↻ Replay')).toBeNull();
    rerender(<PilotPerspectivePage {...baseProps()} />);
    expect(screen.getByText('↻ Replay')).not.toBeNull();
    expect(screen.queryByText('Start.')).toBeNull();
  });

  it('goes back to the demo when the back button is pressed', () => {
    const onBack = vi.fn();
    render(<PilotPerspectivePage {...baseProps({ onBack })} />);
    fireEvent.click(screen.getByText('← Back to demo'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('explains where to save the photo when it is missing', () => {
    const { container } = render(<PilotPerspectivePage {...baseProps()} />);
    const photo = container.querySelector('.pp-bottom img.pp-photo') as HTMLElement | null;
    expect(photo).not.toBeNull();
    if (photo !== null) {
      fireEvent.error(photo);
    }
    expect(screen.getByText('Cockpit photo unavailable.')).not.toBeNull();
  });
});
