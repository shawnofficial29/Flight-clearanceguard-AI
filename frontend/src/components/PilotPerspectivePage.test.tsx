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
      trafficFt: 30000,
    },
    correcting: false,
    atcChoiceFt: null,
    fixes: [],
    atcVia: null,
    onBack: () => {},
    onReplay: () => {},
    started: false,
    onConfirmAtc: () => {},
    onVerifyPilot: () => {},
    onTimeChange: () => {},
    voiceTranscript: null,
    voiceAudioSrc: null,
    voiceError: null,
    onUploadAudio: () => {},
    onApplyTranscript: () => {},
    ...overrides,
  };
}

describe('PilotPerspectivePage', () => {
  it('shows the pilot tablet on top and two cockpit photos below', () => {
    const { container } = render(<PilotPerspectivePage {...baseProps()} />);
    expect(container.querySelector('.pp-top .pv-device')).not.toBeNull();
    expect(screen.getByText('ClearanceGuard')).not.toBeNull();
    const photos = container.querySelectorAll('.pp-bottom img.pp-photo');
    expect(photos.length).toBe(2);
    expect(photos[0].getAttribute('src')).toBe('/cockpit-tablet-closeup.png');
    expect(photos[1].getAttribute('src')).toBe('/cockpit-wide.webp');
  });

  it('shows Start until the pilot flow starts, then Replay', () => {
    const onReplay = vi.fn();
    const { rerender } = render(
      <PilotPerspectivePage {...baseProps({ started: false, onReplay })} />,
    );
    expect(screen.getByText('Start.')).not.toBeNull();
    expect(screen.queryByText('↻ Replay')).toBeNull();
    fireEvent.click(screen.getByText('Start.'));
    expect(onReplay).toHaveBeenCalledTimes(1);
    rerender(<PilotPerspectivePage {...baseProps({ started: true })} />);
    expect(screen.getByText('↻ Replay')).not.toBeNull();
    expect(screen.queryByText('Start.')).toBeNull();
  });

  it('holds the tablet paused once the pilot flow has started', () => {
    render(<PilotPerspectivePage {...baseProps({ started: true })} />);
    expect(screen.getByLabelText('Play simulation')).not.toBeNull();
  });

  it('goes back to the demo when the back button is pressed', () => {
    const onBack = vi.fn();
    render(<PilotPerspectivePage {...baseProps({ onBack })} />);
    fireEvent.click(screen.getByText('← Back to demo'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('explains when a photo is missing without hiding the other', () => {
    const { container } = render(<PilotPerspectivePage {...baseProps()} />);
    const photos = container.querySelectorAll('.pp-bottom img.pp-photo');
    expect(photos.length).toBe(2);
    fireEvent.error(photos[0]);
    expect(screen.getByText('Cockpit photo unavailable.')).not.toBeNull();
    expect(container.querySelectorAll('.pp-bottom img.pp-photo').length).toBe(1);
  });
});
