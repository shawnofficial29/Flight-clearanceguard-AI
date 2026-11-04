import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, BASE_URL, api, type IntentTriple } from './api/client';
import type {
  AuditEvent,
  AuditVerify,
  CoordinationResult,
  CorrectionResult,
  DemoResult,
  Fingerprints,
  Health,
  ResolutionCandidate,
  SafetyWindow,
  ScenarioInfo,
  VerificationResult,
} from './api/types';
import { Header } from './components/Header';
import { ScenarioExplainer } from './components/ScenarioExplainer';
import { DemoStepper } from './components/DemoStepper';
import { ConversationStrip } from './components/ConversationStrip';
import { SyncPanels } from './components/SyncPanels';
import { EvidencePanel } from './components/EvidencePanel';
import { RouteView } from './components/RouteView';
import { AltitudeChart } from './components/AltitudeChart';
import { ResultPanel } from './components/ResultPanel';
import { SideView } from './components/SideView';
import { PilotPerspectivePage } from './components/PilotPerspectivePage';
import type { MapViewMode } from './components/SimMap';
import { useSyncConfirmation } from './hooks/useSyncConfirmation';
import { CUSTOM_SCENARIO_ID, SYNC_SCENARIO_ID, syncAltitudes } from './utils/syncFlow';

function tripleOf(demo: DemoResult): IntentTriple {
  return { atc: demo.atc, pilot: demo.pilot, fms: demo.fms };
}

function correctedTripleOf(demo: DemoResult, correction: CorrectionResult): IntentTriple {
  return { atc: demo.atc, pilot: correction.corrected_pilot, fms: correction.fms };
}

/** Waypoint names named by backend clearance/FMS data (display labels only). */
function fixesOf(demo: DemoResult | null): string[] {
  if (demo === null) return [];
  const names = new Set<string>();
  for (const actionItem of demo.atc.actions) {
    if (actionItem.target_fix !== null) names.add(actionItem.target_fix);
    if (actionItem.trigger_value !== null) names.add(actionItem.trigger_value);
  }
  for (const fix of demo.fms.route) names.add(fix);
  if (demo.fms.lateral_direct_to !== null) names.add(demo.fms.lateral_direct_to);
  if (demo.fms.climb_start_fix !== null) names.add(demo.fms.climb_start_fix);
  return [...names];
}

/** ATC via-fix named by backend actions, when the clearance names one. */
function atcViaOf(demo: DemoResult | null): string | null {
  if (demo === null) return null;
  for (const actionItem of demo.atc.actions) {
    if (actionItem.trigger_value !== null) return actionItem.trigger_value;
  }
  for (const actionItem of demo.atc.actions) {
    if (actionItem.target_fix !== null) return actionItem.target_fix;
  }
  return null;
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [useLive, setUseLive] = useState(false);

  const [demo, setDemo] = useState<DemoResult | null>(null);
  const [correction, setCorrection] = useState<CorrectionResult | null>(null);
  const [safety, setSafety] = useState<SafetyWindow | null>(null);
  const [candidates, setCandidates] = useState<ResolutionCandidate[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [fingerprints, setFingerprints] = useState<Fingerprints | null>(null);
  const [coordination, setCoordination] = useState<CoordinationResult | null>(null);
  const [audit, setAudit] = useState<AuditVerify | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null);

  const [demoLoading, setDemoLoading] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared map playback time (display only); drives the altitude cursor.
  const [mapTimeS, setMapTimeS] = useState(0);
  // Shared before/after view (display only); the rail side view follows the map.
  const [mapView, setMapView] = useState<MapViewMode>('before');
  // Demo page vs Pilot's Perspective split page.
  const [page, setPage] = useState<'demo' | 'pilot'>('demo');
  // Active scenario id: the standard arc, or 'custom' after a voice clearance.
  const [scenarioId, setScenarioId] = useState<string>(SYNC_SCENARIO_ID);
  // Voice clearance from the pilot tablet: uploaded ATC audio transcription.
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceAudioSrc, setVoiceAudioSrc] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Altitude-sync loop: ATC confirms first, then the pilot verifies. The
  // sync autoplay drives the correction once the demo loads.
  const syncAlt = syncAltitudes(demo);
  const syncEnabled = demo !== null && syncAlt !== null;
  const sync = useSyncConfirmation({
    enabled: syncEnabled,
    demo,
    correction,
    atcClearedFt: syncAlt?.atcClearedFt ?? null,
    onSorted: () => void handleCorrect(),
    autoPlay: page === 'demo',
  });
  const flowLock = demo !== null && correction === null;

  // /health is the source of truth: without a configured Meta API, Live Meta
  // cannot stay selected (it would silently fall back to fixtures).
  useEffect(() => {
    if (useLive && health !== null && !health.meta_api_configured) {
      setUseLive(false);
    }
  }, [useLive, health]);

  const refreshConnection = useCallback(async () => {
    try {
      const [nextHealth, nextScenarios] = await Promise.all([api.health(), api.scenarios()]);
      setHealth(nextHealth);
      setScenarios(nextScenarios.scenarios);
      setOffline(false);
    } catch (unknown) {
      setOffline(true);
      setError(unknown instanceof ApiError ? unknown.message : 'Backend check failed.');
    }
  }, []);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  function clearVoice(): void {
    setVoiceTranscript(null);
    setVoiceError(null);
    setVoiceAudioSrc((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function clearDetails(): void {
    setCorrection(null);
    setSafety(null);
    setCandidates(null);
    setSelectedId(null);
    setAppliedId(null);
    setVerification(null);
    setFingerprints(null);
    setCoordination(null);
    setAudit(null);
    setAuditEvents(null);
  }

  const useLiveRef = useRef(useLive);
  useLiveRef.current = useLive;

  const loadDetails = useCallback(async (next: DemoResult, scenario: string): Promise<void> => {
    const triple = tripleOf(next);
    const [nextSafety, nextCandidates, nextPrints, nextCoordination, nextAudit, nextEvents] =
      await Promise.all([
        api.safetyWindow(triple, scenario),
        api.enumerateCandidates(triple, scenario),
        api.fingerprints(triple),
        api.coordinate(
          next.atc_transcript,
          next.pilot_transcript,
          scenario,
          useLiveRef.current,
        ),
        api.auditVerify(),
        api.auditEvents(),
      ]);
    setSafety(nextSafety);
    setCandidates(nextCandidates);
    setFingerprints(nextPrints);
    setCoordination(nextCoordination);
    setAudit(nextAudit);
    setAuditEvents(nextEvents);
  }, []);

  async function handleRunDemo(): Promise<void> {
    setDemoLoading(true);
    setError(null);
    setScenarioId(SYNC_SCENARIO_ID);
    clearVoice();
    clearDetails();
    setDemo(null);
    try {
      const next = await api.runDemo(useLive, SYNC_SCENARIO_ID);
      setDemo(next);
      setOffline(false);
      await loadDetails(next, SYNC_SCENARIO_ID);
    } catch (unknown) {
      if (unknown instanceof ApiError && unknown.status === 0) setOffline(true);
      setError(unknown instanceof ApiError ? unknown.message : 'Demo run failed.');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleApplyTranscript(text: string): Promise<void> {
    const atcText = text.trim();
    if (atcText === '' || demoLoading) return;
    setDemoLoading(true);
    setError(null);
    setVoiceError(null);
    clearDetails();
    try {
      const next = await api.runCustomAtc(atcText, useLive);
      setDemo(next);
      setOffline(false);
      await loadDetails(next, CUSTOM_SCENARIO_ID);
      setScenarioId(CUSTOM_SCENARIO_ID);
      setVoiceTranscript(atcText);
    } catch (unknown) {
      if (unknown instanceof ApiError && unknown.status === 0) setOffline(true);
      setVoiceError(unknown instanceof ApiError ? unknown.message : 'Custom run failed.');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleUploadAudio(file: File): Promise<void> {
    setVoiceError(null);
    setVoiceAudioSrc((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    try {
      const result = await api.transcribeWav(file, useLiveRef.current);
      if (result.transcript.trim() === '') {
        setVoiceTranscript(null);
        setVoiceError(
          result.note ?? 'Transcription came back empty — type what ATC said instead.',
        );
        return;
      }
      await handleApplyTranscript(result.transcript);
    } catch (unknown) {
      setVoiceTranscript(null);
      setVoiceError(
        unknown instanceof ApiError
          ? `${unknown.message} — type what ATC said instead.`
          : 'Transcription failed — type what ATC said instead.',
      );
    }
  }

  async function handleCorrect(): Promise<void> {
    if (demo === null) return;
    setCorrecting(true);
    setError(null);
    try {
      const next = await api.runCorrection(useLive, scenarioId);
      setCorrection(next);
      setAppliedId(selectedId ?? coordination?.recommended_candidate_id ?? null);
      setOffline(false);
      // Refresh safety, fingerprints, and audit against the corrected triple.
      // The original coordinator result is preserved: it explains how the
      // correction was selected, and rerunning it against the already-agreed
      // state would discard the live recommendation and tool-call trace.
      const triple = correctedTripleOf(demo, next);
      const [nextSafety, nextPrints, nextAudit, nextEvents] = await Promise.all([
        api.safetyWindow(triple, scenarioId),
        api.fingerprints(triple),
        api.auditVerify(),
        api.auditEvents(),
      ]);
      setSafety(nextSafety);
      setFingerprints(nextPrints);
      setAudit(nextAudit);
      setAuditEvents(nextEvents);
    } catch (unknown) {
      if (unknown instanceof ApiError && unknown.status === 0) setOffline(true);
      setError(unknown instanceof ApiError ? unknown.message : 'Correction failed.');
    } finally {
      setCorrecting(false);
    }
  }

  async function handleSelectCandidate(id: string): Promise<void> {
    if (demo === null) return;
    setSelectedId(id);
    setVerifying(true);
    setError(null);
    try {
      const result = await api.verifyCandidate(tripleOf(demo), id, scenarioId);
      setVerification(result);
    } catch (unknown) {
      setVerification(null);
      setError(unknown instanceof ApiError ? unknown.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleReset(): Promise<void> {
    setError(null);
    setDemo(null);
    setScenarioId(SYNC_SCENARIO_ID);
    clearDetails();
    clearVoice();
    try {
      await api.resetSession();
      const [nextAudit, nextEvents] = await Promise.all([api.auditVerify(), api.auditEvents()]);
      setAudit(nextAudit);
      setAuditEvents(nextEvents);
      setOffline(false);
    } catch (unknown) {
      if (unknown instanceof ApiError && unknown.status === 0) {
        setOffline(true);
      } else {
        setError(unknown instanceof ApiError ? unknown.message : 'Reset failed.');
      }
    }
  }

  const busy = demoLoading || correcting;
  const hasCorrection = correction !== null;
  const activeConflict = correction?.conflict ?? demo?.conflict ?? null;
  const activeComparison = correction?.comparison ?? demo?.comparison ?? null;

  const scenario = scenarios[0] ?? null;
  const callsign = demo?.atc.callsign ?? demo?.fms.callsign ?? null;

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {page === 'pilot' ? (
        <PilotPerspectivePage
          demo={demo}
          correction={correction}
          callsign={callsign}
          timeS={mapTimeS}
          syncStage={sync.stage}
          atcChoiceFt={sync.atcChoiceFt}
          syncAlt={syncAlt}
          correcting={correcting}
          fixes={fixesOf(demo)}
          atcVia={atcViaOf(demo)}
          onConfirmAtc={sync.confirmAtc}
          onVerifyPilot={sync.verifyPilot}
          onTimeChange={setMapTimeS}
          voiceTranscript={voiceTranscript}
          voiceAudioSrc={voiceAudioSrc}
          voiceError={voiceError}
          onUploadAudio={(file) => void handleUploadAudio(file)}
          onApplyTranscript={(text) => void handleApplyTranscript(text)}
          onBack={() => setPage('demo')}
          onReplay={() => void handleRunDemo()}
        />
      ) : (
        <>
          <div className="pilot-nav-row">
            <button
              type="button"
              className="pilot-nav-button"
              onClick={() => setPage('pilot')}
            >
              Pilot's Perspective
            </button>
          </div>
      <Header
        health={health}
        offline={offline}
        scenario={scenario}
        useLive={useLive}
        busy={busy}
        hasDemo={demo !== null}
        onUseLiveChange={setUseLive}
        onRunDemo={() => void handleRunDemo()}
        onCorrect={() => void handleCorrect()}
        onReset={() => void handleReset()}
        flowActive={flowLock}
      />
      <ScenarioExplainer />
      <DemoStepper
        demo={demo}
        sync={
          syncEnabled && syncAlt !== null && sync.stage !== 'idle'
            ? {
                stage: sync.stage,
                atcClearedFt: syncAlt.atcClearedFt,
                pilotSetFt: syncAlt.pilotSetFt,
                confirmedFt: sync.atcChoiceFt,
              }
            : null
        }
      />
      <main id="main-content">
        {offline ? (
          <div className="banner banner-offline" role="alert">
            Backend offline at {BASE_URL}. Start it with{' '}
            <code>uvicorn app.main:app --reload --app-dir backend</code> (from the repo root,
            port 8000), then retry.
            <button type="button" onClick={() => void refreshConnection()}>
              Retry
            </button>
          </div>
        ) : null}
        {error !== null ? (
          <div className="banner banner-error" role="alert">
            {error}
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {demo === null ? (
          demoLoading ? (
            <div className="loading-state" role="status" aria-label="Loading demo">
              <div className="skeleton skeleton-hero" />
              <div className="ops-grid">
                <div className="workspace">
                  <div className="skeleton skeleton-map" />
                </div>
                <div className="rail">
                  <div className="skeleton skeleton-card" />
                  <div className="skeleton skeleton-card" />
                </div>
              </div>
            </div>
          ) : (
            <div className="ops-grid">
              <div className="workspace">
                <div className="radar-wrap">
                  <RouteView
                    conflict={null}
                    history={null}
                    corrected={false}
                    callsign={null}
                    fixes={[]}
                    atcVia={null}
                    onPlaybackTime={setMapTimeS}
                  />
                  <div className="radar-prompt">
                    <p>One misheard number can put the aircraft at the wrong altitude.</p>
                    <p>Run the demo to see ClearanceGuard catch it.</p>
                  </div>
                </div>
                <section className="panel vert-compact" aria-label="Vertical profile">
                  <h2>Altitude versus time (ft)</h2>
                  <p className="empty">Altitude and time appear here once the demo runs.</p>
                </section>
              </div>
              <div className="rail">
                <section className="panel">
                  <h2>Ready to run</h2>
                  <p>One scenario is loaded.</p>
                  <p className="meta-line">Press ▶ Run Demo in the header to start.</p>
                </section>
              </div>
            </div>
          )
        ) : (
          <>
            {syncEnabled && syncAlt !== null && sync.stage !== 'idle' ? (
              <>
                <ConversationStrip altitudes={syncAlt} sorted={sync.stage === 'done'} />
                <SyncPanels
                  altitudes={syncAlt}
                  stage={sync.stage}
                  atcChoiceFt={sync.atcChoiceFt}
                  correcting={correcting}
                  onConfirmAtc={sync.confirmAtc}
                  onVerifyPilot={sync.verifyPilot}
                />
              </>
            ) : null}
            <div className="ops-grid">
              <div className="workspace">
                <RouteView
                  conflict={correction?.conflict ?? demo.conflict}
                  history={hasCorrection ? demo.conflict : null}
                  corrected={hasCorrection}
                  callsign={callsign}
                  fixes={fixesOf(demo)}
                  atcVia={atcViaOf(demo)}
                  onPlaybackTime={setMapTimeS}
                  onMapViewChange={setMapView}
                />
              </div>
              <div className="rail">
                <ResultPanel
                  conflict={correction?.conflict ?? demo.conflict}
                  comparison={correction?.comparison ?? demo.comparison}
                  correction={correction}
                  safety={safety}
                  correcting={correcting}
                  onConfirmCorrection={() => void handleCorrect()}
                  flowActive={flowLock}
                />
                <SideView
                  before={demo.conflict}
                  after={correction?.conflict ?? null}
                  view={mapView}
                  timeS={mapTimeS}
                />
                <AltitudeChart
                  conflict={correction?.conflict ?? demo.conflict}
                  reference={hasCorrection ? demo.conflict : null}
                  safety={safety}
                  timeS={mapTimeS}
                />
              </div>
            </div>
          </>
        )}
        <EvidencePanel
          atc={demo?.atc ?? null}
          pilot={correction?.corrected_pilot ?? demo?.pilot ?? null}
          fms={correction?.fms ?? demo?.fms ?? null}
          comparison={activeComparison}
          conflict={activeConflict}
          safety={safety}
          candidates={candidates}
          coordination={coordination}
          fingerprints={fingerprints}
          audit={audit}
          auditEvents={auditEvents}
          selectedId={selectedId}
          appliedId={appliedId}
          correction={correction}
          verification={verification}
          active={demo !== null}
          useLive={useLive}
          voiceConfigured={health?.voice_configured ?? null}
          offline={offline}
          health={health}
          onSelectCandidate={(id) => void handleSelectCandidate(id)}
          verifying={verifying}
        />
      </main>
        </>
      )}
    </div>
  );
}
