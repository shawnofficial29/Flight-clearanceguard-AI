import type { Health, ScenarioInfo } from '../api/types';

interface HeaderProps {
  health: Health | null;
  offline: boolean;
  /** The single loaded scenario; null while the backend list loads. */
  scenario: ScenarioInfo | null;
  useLive: boolean;
  busy: boolean;
  hasDemo: boolean;
  onUseLiveChange: (useLive: boolean) => void;
  onRunDemo: () => void;
  onCorrect: () => void;
  onReset: () => void;
  /** Confirmation flow running; locks mode/run/correct (Reset stays live). */
  flowActive?: boolean;
}

export function Header(props: HeaderProps): React.JSX.Element {
  const {
    health,
    offline,
    scenario,
    useLive,
    busy,
    hasDemo,
    onUseLiveChange,
    onRunDemo,
    onCorrect,
    onReset,
    flowActive = false,
  } = props;
  const canUseLive = health !== null && health.meta_api_configured && !offline;
  const locked = busy || flowActive;
  const statusWord = offline ? 'Offline' : useLive ? 'Live' : 'Simulation';
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-row">
          <h1>ClearanceGuard AI</h1>
          <span className="conn-status">
            <span className="status-dot" aria-hidden="true" />
            <span className="status-word">{statusWord}</span>
          </span>
        </div>
        <p className="value-prop">
          Catches clearance mismatches before the aircraft acts on them.
        </p>
      </div>
      <div className="controls">
        <div className="control">
          <span className="control-label">Scenario</span>
          <span className="scenario-name">{scenario === null ? 'Loading…' : scenario.title}</span>
        </div>
        <div className="mode-pill" role="group" aria-label="Mode">
          <button
            type="button"
            aria-pressed={!useLive}
            disabled={locked || offline}
            onClick={() => onUseLiveChange(false)}
          >
            Simulation
          </button>
          <button
            type="button"
            aria-pressed={useLive}
            disabled={locked || !canUseLive}
            title={
              canUseLive ? 'Use the live Meta API' : 'Meta API unavailable in backend process'
            }
            onClick={() => onUseLiveChange(true)}
          >
            Live
          </button>
        </div>
        <button
          type="button"
          className="btn-primary btn-run"
          disabled={locked || offline}
          onClick={onRunDemo}
        >
          ▶ Run Demo
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={locked || offline || !hasDemo}
          onClick={onCorrect}
        >
          Pilot Correction
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onReset}>
          Reset
        </button>
      </div>
    </header>
  );
}
