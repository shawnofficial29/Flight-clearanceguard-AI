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
import { AtcPanel } from './components/AtcPanel';
import { PilotFmsPanel } from './components/PilotFmsPanel';
import { MatrixPanel } from './components/MatrixPanel';
import { RouteView } from './components/RouteView';
import { AltitudeChart } from './components/AltitudeChart';
import { SafetyPanel } from './components/SafetyPanel';
import { AgentPanel } from './components/AgentPanel';
import { AudioPanel } from './components/AudioPanel';

function tripleOf(demo: DemoResult): IntentTriple {
  return { atc: demo.atc, pilot: demo.pilot, fms: demo.fms };
}

function correctedTripleOf(demo: DemoResult, correction: CorrectionResult): IntentTriple {
  return { atc: demo.atc, pilot: correction.corrected_pilot, fms: correction.fms };
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenarioId, setScenarioId] = useState('');
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
      setScenarioId((current) => current || nextScenarios.scenarios[0]?.id || '');
      setOffline(false);
    } catch (unknown) {
      setOffline(true);
      setError(unknown instanceof ApiError ? unknown.message : 'Backend check failed.');
    }
  }, []);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

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
    clearDetails();
    setDemo(null);
    try {
      const next = await api.runDemo(useLive, scenarioId || null);
      setDemo(next);
      setOffline(false);
      await loadDetails(next, scenarioId);
    } catch (unknown) {
      if (unknown instanceof ApiError && unknown.status === 0) setOffline(true);
      setError(unknown instanceof ApiError ? unknown.message : 'Demo run failed.');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleCorrect(): Promise<void> {
    if (demo === null) return;
    setCorrecting(true);
    setError(null);
    try {
      const next = await api.runCorrection(useLive, scenarioId || null);
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
      const result = await api.verifyCandidate(tripleOf(demo), id, scenarioId || null);
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
    clearDetails();
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

  function handleScenarioChange(id: string): void {
    // Never display the previous scenario's data under the new scenario name.
    setScenarioId(id);
    setDemo(null);
    clearDetails();
    setError(null);
  }

  const busy = demoLoading || correcting;
  const hasCorrection = correction !== null;
  const activeConflict = correction?.conflict ?? demo?.conflict ?? null;
  const activeComparison = correction?.comparison ?? demo?.comparison ?? null;

  return (
    <div className="app">
      <Header
        health={health}
        offline={offline}
        scenarios={scenarios}
        scenarioId={scenarioId}
        useLive={useLive}
        busy={busy}
        hasDemo={demo !== null}
        onScenarioChange={handleScenarioChange}
        onUseLiveChange={setUseLive}
        onRunDemo={() => void handleRunDemo()}
        onCorrect={() => void handleCorrect()}
        onReset={() => void handleReset()}
      />
      <main>
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
        {demoLoading ? <p className="meta-line">Running demo…</p> : null}
        <div className="row">
          <AtcPanel clearance={demo?.atc ?? null} />
          <PilotFmsPanel
            pilot={correction?.corrected_pilot ?? demo?.pilot ?? null}
            fms={correction?.fms ?? demo?.fms ?? null}
            comparison={activeComparison}
          />
        </div>
        <MatrixPanel comparison={activeComparison} />
        <div className="row">
          <RouteView conflict={activeConflict} corrected={hasCorrection} />
          <AltitudeChart
            conflict={activeConflict}
            reference={hasCorrection ? (demo?.conflict ?? null) : null}
            safety={safety}
          />
        </div>
        <div className="row">
          <SafetyPanel
            conflict={activeConflict}
            safety={safety}
            candidates={candidates}
            selectedId={selectedId}
            appliedId={appliedId}
            verification={verification}
            verifying={verifying}
            correcting={correcting}
            correction={correction}
            onSelectCandidate={(id) => void handleSelectCandidate(id)}
            onConfirmCorrection={() => void handleCorrect()}
          />
          <AgentPanel
            coordination={coordination}
            fingerprints={fingerprints}
            audit={audit}
            auditEvents={auditEvents}
            selectedId={selectedId}
            appliedId={appliedId}
            correction={correction}
            verification={verification}
            active={demo !== null}
          />
        </div>
        <AudioPanel
          useLive={useLive}
          voiceConfigured={health?.voice_configured ?? null}
          offline={offline}
        />
      </main>
    </div>
  );
}
