import { memo } from 'react';
import { formatSyncFt, type SyncAltitudes } from '../utils/syncFlow';

export interface ConversationStripProps {
  altitudes: SyncAltitudes;
  sorted: boolean;
}

/**
 * Radio exchange as chat bubbles. Every number comes from simulation data;
 * the pilot's mismatched value highlights until the loop is sorted.
 */
export const ConversationStrip = memo(function ConversationStrip(
  props: ConversationStripProps,
): React.JSX.Element {
  const { altitudes, sorted } = props;
  const mismatch = !sorted && altitudes.pilotSetFt !== altitudes.atcClearedFt;
  return (
    <section className="panel sync-strip" aria-label="Radio exchange">
      <div className="bubble-row">
        <div className="bubble bubble-atc">
          <span className="bubble-who">ATC</span>
          <span>
            {altitudes.callsign}, maintain <strong>{formatSyncFt(altitudes.atcClearedFt)} ft</strong>.
          </span>
        </div>
        <div className="bubble bubble-pilot">
          <span className="bubble-who">Pilot</span>
          <span>
            Maintain{' '}
            <strong className={mismatch ? 'num-bad sync-shake' : undefined}>
              {formatSyncFt(altitudes.pilotSetFt)}
            </strong>
            , {altitudes.callsign}.
          </span>
        </div>
      </div>
      {sorted ? (
        <div className="bubble-row">
          <div className="bubble bubble-atc">
            <span className="bubble-who">ATC</span>
            <span>
              Maintain <strong className="num-ok">{formatSyncFt(altitudes.atcClearedFt)}</strong>.
            </span>
          </div>
          <div className="bubble bubble-pilot">
            <span className="bubble-who">Pilot</span>
            <span>
              Maintain <strong className="num-ok">{formatSyncFt(altitudes.atcClearedFt)}</strong>,{' '}
              {altitudes.callsign}.
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
});
