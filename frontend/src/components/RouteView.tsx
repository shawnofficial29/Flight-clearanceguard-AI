import { memo, useCallback, useEffect, useState } from 'react';
import type { ConflictPrediction } from '../api/types';
import { usePlayback } from '../hooks/usePlayback';
import { MapTransport } from './MapTransport';
import { SimMap, type MapViewMode } from './SimMap';

interface RouteViewProps {
  conflict: ConflictPrediction | null;
  /** Pre-correction profile, kept as a faint historical trace. */
  history: ConflictPrediction | null;
  corrected: boolean;
  /** Callsign from backend clearance/FMS data. */
  callsign: string | null;
  /** Waypoint names collected from backend clearance/FMS data. */
  fixes: string[];
  /** ATC via-fix from backend actions, when the clearance names one. */
  atcVia: string | null;
  /** Reports shared playback time so charts stay in sync with the map. */
  onPlaybackTime?: (t: number) => void;
  /** Reports the before/after view so the rail side view follows the map. */
  onMapViewChange?: (view: MapViewMode) => void;
}

export const RouteView = memo(function RouteView(props: RouteViewProps): React.JSX.Element {
  const { conflict, history, corrected, callsign, fixes, atcVia, onPlaybackTime, onMapViewChange } = props;
  const profile = conflict?.profile ?? [];
  const pauseAt = corrected ? null : (conflict?.first_conflict_time_s ?? null);
  const resetKey = `${corrected ? 'corrected' : 'live'}-${profile.length}-${conflict?.first_conflict_time_s ?? 'none'}`;
  const playback = usePlayback(profile, pauseAt, conflict !== null, resetKey, corrected);

  const [view, setView] = useState<MapViewMode>(corrected ? 'after' : 'before');
  const handleViewChange = useCallback(
    (next: MapViewMode) => {
      setView(next);
      onMapViewChange?.(next);
    },
    [onMapViewChange],
  );
  useEffect(() => {
    handleViewChange(corrected ? 'after' : 'before');
  }, [corrected, handleViewChange]);

  useEffect(() => {
    onPlaybackTime?.(playback.timeS);
  }, [playback.timeS, onPlaybackTime]);

  const before = corrected ? history : conflict;
  const showCleared =
    corrected &&
    view === 'after' &&
    conflict?.conflict === false &&
    history?.conflict === true;
  const showZone =
    !showCleared && (conflict?.conflict === true || (view === 'before' && (before?.conflict ?? false)));

  return (
    <section className="panel radar" aria-label="Route view">
      <h2>Route view (SFO terminal area, NM)</h2>
      <div className="sim-wrap">
        <SimMap
          conflict={conflict}
          history={history}
          corrected={corrected}
          callsign={callsign}
          fixes={fixes}
          atcVia={atcVia}
          timeS={playback.timeS}
          fitKey={resetKey}
          view={view}
          onViewChange={handleViewChange}
        />
        {conflict !== null ? (
          <MapTransport
            timeS={playback.timeS}
            tMax={playback.tMax}
            playing={playback.playing}
            ended={playback.ended}
            atConflict={playback.atConflict}
            onPlay={playback.play}
            onPause={playback.pause}
            onReplay={playback.replay}
            onSeek={playback.seek}
          />
        ) : null}
      </div>
      <ul className="legend">
        <li>
          <span className="swatch sw-atc" /> {atcVia === null ? 'ATC route (cleared)' : `ATC route (via ${atcVia})`}
        </li>
        {corrected ? (
          <li><span className="swatch sw-history" /> Historical FMS trace</li>
        ) : (
          <li><span className="swatch sw-fms" /> FMS route (executed)</li>
        )}
        {corrected ? (
          <li><span className="swatch sw-corrected" /> Corrected route (executed)</li>
        ) : null}
        <li><span className="swatch sw-intruder" /> Intruder track</li>
        <li><span className="swatch sw-bg" /> Background traffic (illustrative)</li>
        {showCleared ? (
          <li><span className="swatch sw-cleared" /> Conflict cleared</li>
        ) : showZone ? (
          <li><span className="swatch sw-conflict" /> Predicted conflict zone</li>
        ) : null}
      </ul>
    </section>
  );
});
