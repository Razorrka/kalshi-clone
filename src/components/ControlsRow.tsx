import { useMarket } from '../store/useMarket';
import type { Timeframe } from '../engine/types';
import { ArrowDown, ArrowUp } from './icons';

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: 'live', label: 'LIVE' },
  { key: '5m', label: '5M' },
  { key: '15m', label: '15M' },
  { key: '1h', label: '1H' },
];

export function ControlsRow() {
  const store = useMarket();
  // Oldest on the left, matching how the strip reads on the real screen.
  const past = store.history.slice(0, 3).reverse();

  return (
    <div className="controls">
      <button className="past-pill" onClick={() => store.openSheet('activity')}>
        Past
        <span className="arrows">
          {past.length === 0 && <span className="empty">— — —</span>}
          {past.map((r) =>
            r.result === 'up' ? (
              <span key={r.roundId} style={{ color: 'var(--up)', display: 'flex' }}>
                <ArrowUp size={17} strokeWidth={3} />
              </span>
            ) : (
              <span key={r.roundId} style={{ color: 'var(--down)', display: 'flex' }}>
                <ArrowDown size={17} strokeWidth={3} />
              </span>
            ),
          )}
        </span>
      </button>

      <div className="timeframes">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.key}
            className={store.timeframe === tf.key ? 'active' : ''}
            onClick={() => store.setTimeframe(tf.key)}
          >
            {tf.label}
          </button>
        ))}
      </div>
    </div>
  );
}
