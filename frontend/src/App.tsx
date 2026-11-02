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
import { DemoStepper } from './components/DemoStepper';
import { AlertCard } from './components/AlertCard';
import { IntentCompare } from './components/IntentCompare';
import { EvidencePanel } from './components/EvidencePanel';
import { RouteView } from './components/RouteView';
import { AltitudeChart } from './components/AltitudeChart';
import { SafetyPanel } from './components/SafetyPanel';

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

  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
  const scenarioLine =
    selectedScenario === null
      ? 'Select a scenario, then run the demo.'
      : `Scenario ${selectedScenario.id} — ${selectedScenario.title}.`;
  const callsign = demo?.atc.callsign ?? demo?.fms.callsign ?? null;

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
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
      <DemoStepper demo={demo} correction={correction} />
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
        {demoLoading ? <p className="meta-line">Running demo…</p> : null}
        {demo === null ? (
          <div className="ops-grid">
            <div className="workspace">
              <div className="radar-wrap">
                <RouteView
                  conflict={null}
                  corrected={false}
                  callsign={null}
                  fixes={[]}
                  atcVia={null}
                />
                <div className="radar-prompt">
                  <p>One omitted condition can change the aircraft trajectory.</p>
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
                <p>{scenarioLine}</p>
                <p className="meta-line">Press Run Demo in the header to start.</p>
              </section>
            </div>
          </div>
        ) : (
          <div className="ops-grid">
            <div className="workspace">
              <RouteView
                conflict={correction?.conflict ?? demo.conflict}
                corrected={hasCorrection}
                callsign={callsign}
                fixes={fixesOf(demo)}
                atcVia={atcViaOf(demo)}
              />
              <div className="vert-compact">
                <AltitudeChart
                  conflict={correction?.conflict ?? demo.conflict}
                  reference={hasCorrection ? demo.conflict : null}
                  safety={safety}
                />
              </div>
            </div>
            <div className="rail">
              <AlertCard
                demo={demo}
                correction={correction}
                comparison={correction?.comparison ?? demo.comparison}
                conflict={correction?.conflict ?? demo.conflict}
              />
              <IntentCompare comparison={correction?.comparison ?? demo.comparison} />
              <SafetyPanel
                conflict={correction?.conflict ?? demo.conflict}
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
            </div>
          </div>
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
        />
      </main>
    </div>
  );
}
