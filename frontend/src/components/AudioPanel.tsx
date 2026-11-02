import { useState } from 'react';
import { ApiError, api } from '../api/client';
import { PROVENANCE_LABELS, type VoiceTranscript } from '../api/types';

interface AudioPanelProps {
  useLive: boolean;
  voiceConfigured: boolean | null;
  offline: boolean;
}

export function AudioPanel(props: AudioPanelProps): React.JSX.Element {
  const { useLive, voiceConfigured, offline } = props;
  const [role, setRole] = useState<'atc' | 'pilot'>('pilot');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined): Promise<void> {
    setResult(null);
    if (file === undefined) {
      setFileName(null);
      setError('No file selected.');
      return;
    }
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith('.wav')) {
      setError(`Invalid file '${file.name}': expected a .wav upload.`);
      return;
    }
    if (file.size === 0) {
      setError(`Invalid file '${file.name}': the file is empty.`);
      return;
    }
    setBusy(true);
    setError(null);
    // Never silently fall back: without configured voice the upload is fixture mode.
    const effectiveLive = useLive && voiceConfigured === true;
    try {
      const transcript = await api.transcribeWav(file, effectiveLive);
      if (transcript.transcript === '') {
        setError(
          transcript.note ?? `Transcription of '${file.name}' returned no text.`,
        );
        setResult(null);
        return;
      }
      setResult(transcript);
    } catch (unknown) {
      setError(unknown instanceof ApiError ? unknown.message : 'Transcription failed.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Audio control</h2>
      <div className="controls">
        <label className="control">
          Audio role
          <select value={role} onChange={(event) => setRole(event.target.value as 'atc' | 'pilot')}>
            <option value="atc">ATC audio</option>
            <option value="pilot">Pilot audio</option>
          </select>
        </label>
        <label className="control">
          WAV file
          <input
            type="file"
            accept=".wav,audio/wav"
            disabled={busy || offline}
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
            }}
          />
        </label>
      </div>
      <p className="meta-line">
        Mono 16-bit PCM WAV at 16 or 24 kHz. Fixture Simulation accepts the
        prerecorded demo files; anything else needs typed input or live Muse Voice.
        {fileName !== null ? ` Selected: ${fileName} (${role}).` : null}
      </p>
      <p className="meta-line">
        Upload mode: {useLive && voiceConfigured === true ? 'Live Meta' : 'Fixture Simulation'}
      </p>
      {useLive && voiceConfigured === false && !offline ? (
        <p className="meta-line">Muse Voice unavailable in backend process.</p>
      ) : null}
      {busy ? <p className="meta-line">Transcribing…</p> : null}
      {error !== null ? <p className="error">{error}</p> : null}
      {result !== null ? (
        <div>
          <p className="transcript">{result.transcript}</p>
          <p className="meta-line">
            Provenance: {PROVENANCE_LABELS[result.provenance]} · Model: {result.model} ·
            Source: {result.source_file}
          </p>
          {result.note !== null ? <p className="meta-line">Note: {result.note}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
