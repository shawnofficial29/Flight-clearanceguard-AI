import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PilotView, type PilotViewProps } from './PilotView';
import { sampleProfile } from '../utils/playbackMath';
import { formatSyncFt } from '../utils/syncFlow';
import { makeSyncCorrection, makeSyncDemo } from '../test/fixtures';

const ALTITUDES = {
  callsign: 'META 452',
  atcClearedFt: 23000,
  pilotSetFt: 22000,
  trafficFt: 30000,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function baseProps(overrides: Partial<PilotViewProps> = {}): PilotViewProps {
  return {
    demo: makeSyncDemo(),
    correction: null,
    callsign: 'META 452',
    timeS: 100,
    syncStage: 'atc',
    atcChoiceFt: null,
    syncAlt: ALTITUDES,
    correcting: false,
    fixes: [],
    atcVia: null,
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

describe('PilotView clearance phases', () => {
  it('shows the normal clearance before the demo runs', () => {
    render(
      <PilotView
        {...baseProps({
          demo: null,
          callsign: null,
          timeS: 0,
          syncStage: 'idle',
          syncAlt: null,
        })}
      />,
    );
    expect(screen.getByText('ATC: maintain 23,000 ft')).not.toBeNull();
    expect(screen.getByText('Standing by for ATC')).not.toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('holds the mismatch notice, then shows the message sent to ATC', () => {
    vi.useFakeTimers();
    try {
      render(<PilotView {...baseProps()} />);
      expect(screen.getByText('CHECK ALTITUDE')).not.toBeNull();
      expect(screen.getByText(/ATC cleared 23,000 · You set 22,000/)).not.toBeNull();
      expect(screen.getByText(/New clearance from ATC/)).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText('CHECK ALTITUDE')).not.toBeNull();
      expect(screen.queryByText(/Message sent to ATC/)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(8500);
      });
      expect(screen.getByText('ATC confirming…')).not.toBeNull();
      expect(screen.getByText(/Message sent to ATC/)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls to the confirmed altitude, then shows the verify press', async () => {
    const { container } = render(
      <PilotView {...baseProps({ syncStage: 'pilot', atcChoiceFt: 23000 })} />,
    );
    expect(screen.getByText(/ATC CONFIRMED 23,000/)).not.toBeNull();
    expect(screen.getByText(/ATC approved 23,000/)).not.toBeNull();
    await screen.findByText('VERIFY', undefined, { timeout: 3000 });
    expect(container.querySelector('.pv-roll')?.textContent).toBe('23,000');
  });

  it('warns in red and asks whether to keep the wrong choice', () => {
    const { container } = render(
      <PilotView {...baseProps({ syncStage: 'alt', atcChoiceFt: 22000 })} />,
    );
    const warnings = screen.getAllByText(
      'Warning: ATC says 23,000. Do you want to confirm going at the altitude of 22,000?',
    );
    expect(warnings.length).toBe(2);
    expect(container.querySelector('.pv-clear')?.getAttribute('data-tone')).toBe('danger');
    expect(screen.getByText('Yes, keep it on 22,000.')).not.toBeNull();
    expect(screen.getByText('No, change it to 23,000.')).not.toBeNull();
  });

  it('verifies when the pilot keeps the wrong altitude', () => {
    const onVerifyPilot = vi.fn();
    render(
      <PilotView {...baseProps({ syncStage: 'alt', atcChoiceFt: 22000, onVerifyPilot })} />,
    );
    fireEvent.click(screen.getByText('Yes, keep it on 22,000.'));
    expect(onVerifyPilot).toHaveBeenCalledTimes(1);
  });

  it('switches to the cleared altitude when the pilot changes it', () => {
    const onConfirmAtc = vi.fn();
    render(
      <PilotView {...baseProps({ syncStage: 'alt', atcChoiceFt: 22000, onConfirmAtc })} />,
    );
    fireEvent.click(screen.getByText('No, change it to 23,000.'));
    expect(onConfirmAtc).toHaveBeenCalledWith(23000);
  });

  it('shows the synchronized clearance once verified', () => {
    const { container } = render(
      <PilotView
        {...baseProps({
          correction: makeSyncCorrection(),
          syncStage: 'done',
          atcChoiceFt: 23000,
        })}
      />,
    );
    expect(screen.getByText(/CLEARANCE SYNCHRONIZED/)).not.toBeNull();
    expect(screen.getByText('Notification sent to ATC2 for verification.')).not.toBeNull();
    // CLEARED row + synchronized display + readout ALT now flying 23,000.
    expect(screen.getAllByText('23,000 ft').length).toBe(3);
    expect(container.querySelector('.pv-clear')?.getAttribute('data-tone')).toBe('ok');
  });
});

describe('PilotView flight data', () => {
  it('matches the simulation numbers and map positions', () => {
    const demo = makeSyncDemo();
    const { container } = render(<PilotView {...baseProps({ demo })} />);
    const at = sampleProfile(demo.conflict.profile, 100);
    expect(at).not.toBeNull();
    expect(screen.getByText(`${formatSyncFt(at?.ownFt ?? 0)} ft`)).not.toBeNull();
    expect(screen.getByText(`${Math.round(at?.ownKt ?? 0)} kt`)).not.toBeNull();
    expect(screen.getByText('MERIT → PONCT')).not.toBeNull();
    expect(screen.getByText('23,000 ft')).not.toBeNull();
    expect(screen.getByText('T+100s')).not.toBeNull();
    expect(container.querySelector('.pv-mapwrap .leaflet-container')).not.toBeNull();
  });

  it('holds at the start without autoplaying when autoPlay is off', () => {
    render(<PilotView {...baseProps({ autoPlay: false, timeS: 0 })} />);
    expect(screen.getByLabelText('Play simulation')).not.toBeNull();
    expect(screen.getByText('T+0s')).not.toBeNull();
  });

  it('flies the verified 23,000 ft route on the map once corrected', () => {
    const { container } = render(
      <PilotView
        {...baseProps({
          correction: makeSyncCorrection(),
          syncStage: 'done',
          atcChoiceFt: 23000,
        })}
      />,
    );
    const tag = container.querySelector('.pv-mapwrap .ac-tag');
    expect(tag?.textContent ?? '').toContain('23,000 ft');
    expect(tag?.textContent ?? '').not.toContain('22,000 ft');
  });
});

describe('PilotView controls do the same thing as the demo', () => {
  it('confirms the ATC choice like the demo ATC panel', () => {
    const onConfirmAtc = vi.fn();
    render(<PilotView {...baseProps({ onConfirmAtc })} />);
    fireEvent.click(screen.getByText('23,000 ✓'));
    expect(onConfirmAtc).toHaveBeenCalledWith(23000);
    fireEvent.click(screen.getByText('22,000'));
    expect(onConfirmAtc).toHaveBeenCalledWith(22000);
  });

  it('verifies like the demo cockpit panel', async () => {
    const onVerifyPilot = vi.fn();
    render(
      <PilotView {...baseProps({ syncStage: 'pilot', atcChoiceFt: 23000, onVerifyPilot })} />,
    );
    const verify = await screen.findByText('VERIFY', undefined, { timeout: 3000 });
    fireEvent.click(verify);
    expect(onVerifyPilot).toHaveBeenCalledTimes(1);
  });

  it('disables verify while the correction is running', async () => {
    render(
      <PilotView
        {...baseProps({ syncStage: 'pilot', atcChoiceFt: 23000, correcting: true })}
      />,
    );
    const verify = (await screen.findByText('Verifying…', undefined, {
      timeout: 3000,
    })) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
  });

  it('scrubs the shared playback clock', () => {
    const onTimeChange = vi.fn();
    const { container } = render(<PilotView {...baseProps({ onTimeChange })} />);
    const scrub = container.querySelector('.pv-scrub') as HTMLInputElement | null;
    expect(scrub).not.toBeNull();
    if (scrub !== null) {
      fireEvent.change(scrub, { target: { value: '200' } });
    }
    expect(onTimeChange).toHaveBeenCalledWith(200);
  });

  it('starts playing on mount and toggles like the demo transport', () => {
    if (typeof requestAnimationFrame === 'undefined') {
      vi.stubGlobal('requestAnimationFrame', () => 0);
      vi.stubGlobal('cancelAnimationFrame', () => {});
    }
    render(<PilotView {...baseProps()} />);
    fireEvent.click(screen.getByLabelText('Pause simulation'));
    expect(screen.getByLabelText('Play simulation')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Play simulation'));
    expect(screen.getByLabelText('Pause simulation')).not.toBeNull();
  });

  it('shows no before/after comparison anywhere on the tablet', () => {
    const { container } = render(
      <PilotView
        {...baseProps({
          correction: makeSyncCorrection(),
          syncStage: 'done',
          atcChoiceFt: 23000,
        })}
      />,
    );
    expect(container.querySelector('.pv-viewtoggle')).toBeNull();
    expect(container.querySelector('.map-view-toggle')).toBeNull();
    expect(screen.queryByText('Before')).toBeNull();
    expect(screen.queryByText('After')).toBeNull();
  });

  it('replays the shared trajectory from the start like the demo transport', () => {
    render(<PilotView {...baseProps()} />);
    expect(screen.getByText('T+100s')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Replay simulation'));
    expect(screen.getByText('T+0s')).not.toBeNull();
    expect(screen.getByLabelText('Pause simulation')).not.toBeNull();
  });

  it('advances the tablet clock across playback frames', async () => {
    render(<PilotView {...baseProps()} />);
    await waitFor(
      () => {
        expect(screen.queryByText('T+100s')).toBeNull();
      },
      { timeout: 5000 },
    );
  });
});

describe('PilotView ATC voice example', () => {
  it('shows the example instruction as the transcript', () => {
    render(<PilotView {...baseProps()} />);
    expect(
      screen.getByText('Maintain 23,000 feet and start decreasing after 15 miles.'),
    ).not.toBeNull();
  });

  it('plays the ATC audio when the pilot listens', () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    render(<PilotView {...baseProps()} />);
    fireEvent.click(screen.getByText('▶ Listen'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('explains where to put the audio file when it is missing', async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new Error('missing file'),
    );
    render(<PilotView {...baseProps()} />);
    fireEvent.click(screen.getByText('▶ Listen'));
    await screen.findByText(/frontend\/public\/atc-audio\.mp3/);
  });

  it('passes the uploaded file up for transcription', () => {
    const onUploadAudio = vi.fn();
    const { container } = render(<PilotView {...baseProps({ onUploadAudio })} />);
    const input = container.querySelector('.pv-fileinput') as HTMLInputElement;
    const file = new File(['fake audio'], 'atc-15000.wav', { type: 'audio/wav' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(onUploadAudio).toHaveBeenCalledWith(file);
  });

  it('shows the transcribed clearance instead of the example', () => {
    render(
      <PilotView {...baseProps({ voiceTranscript: 'META 452, decrease to 15,000 feet.' })} />,
    );
    expect(screen.getByText('META 452, decrease to 15,000 feet.')).not.toBeNull();
    expect(
      screen.queryByText('Maintain 23,000 feet and start decreasing after 15 miles.'),
    ).toBeNull();
  });

  it('falls back to typed input when transcription fails', () => {
    const onApplyTranscript = vi.fn();
    render(
      <PilotView
        {...baseProps({
          voiceError: 'Transcription unavailable — type what ATC said instead.',
          onApplyTranscript,
        })}
      />,
    );
    const box = screen.getByLabelText('Type what ATC said') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'META 452, decrease to 15,000 feet.' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(onApplyTranscript).toHaveBeenCalledWith('META 452, decrease to 15,000 feet.');
  });

  it('plays the uploaded recording when the pilot listens', () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const { container } = render(
      <PilotView {...baseProps({ voiceAudioSrc: 'blob:mock-audio' })} />,
    );
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:mock-audio');
    fireEvent.click(screen.getByText('▶ Listen'));
    expect(play).toHaveBeenCalledTimes(1);
  });
});
