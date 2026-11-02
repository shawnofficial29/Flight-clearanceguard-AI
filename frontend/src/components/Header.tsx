import type { Health, ScenarioInfo } from '../api/types';

interface HeaderProps {
  health: Health | null;
  offline: boolean;
  scenarios: ScenarioInfo[];
  scenarioId: string;
  useLive: boolean;
  busy: boolean;
  hasDemo: boolean;
  onScenarioChange: (id: string) => void;
  onUseLiveChange: (useLive: boolean) => void;
  onRunDemo: () => void;
  onCorrect: () => void;
  onReset: () => void;
}

export function Header(props: HeaderProps): React.JSX.Element {
  const {
    health,
    offline,
    scenarios,
    scenarioId,
    useLive,
    busy,
    hasDemo,
    onScenarioChange,
    onUseLiveChange,
    onRunDemo,
    onCorrect,
    onReset,
  } = props;
  const canUseLive = health !== null && health.meta_api_configured && !offline;
  return (
    <header className="app-header">
      <div className="brand">
        <h1>ClearanceGuard AI</h1>
        {offline ? (
          <span className="pill pill-offline">Backend offline</span>
        ) : health ? (
          <span className="pill pill-ok">Backend connected</span>
        ) : (
          <span className="pill">Checking backend…</span>
        )}
        {health && !offline ? (
          <span className="meta-line">
            Meta API: {health.meta_api_configured ? 'configured' : 'not configured'}
            {' · '}Voice: {health.voice_configured ? 'configured' : 'not configured'}
            {' · '}Model: {health.model}
          </span>
        ) : null}
      </div>
      <div className="controls">
        <label className="control">
          Scenario
          <select
            value={scenarioId}
            disabled={busy || scenarios.length === 0}
            onChange={(event) => onScenarioChange(event.target.value)}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.id} — {scenario.title}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="mode-group">
          <legend>Mode</legend>
          <label className="control-inline">
            <input
              type="radio"
              name="mode"
              checked={!useLive}
              disabled={busy || offline}
              onChange={() => onUseLiveChange(false)}
            />
            Fixture Simulation
          </label>
          <label className="control-inline">
            <input
              type="radio"
              name="mode"
              checked={useLive}
              disabled={busy || !canUseLive}
              onChange={() => onUseLiveChange(true)}
            />
            Live Meta
          </label>
        </fieldset>
        <button type="button" disabled={busy || offline} onClick={onRunDemo}>
          Run Demo
        </button>
        <button type="button" disabled={busy || offline || !hasDemo} onClick={onCorrect}>
          Pilot Correction
        </button>
        <button type="button" disabled={busy} onClick={onReset}>
          Reset
        </button>
      </div>
      {health !== null && !health.meta_api_configured && !offline ? (
        <p className="meta-line">Meta API unavailable in backend process.</p>
      ) : null}
    </header>
  );
}
