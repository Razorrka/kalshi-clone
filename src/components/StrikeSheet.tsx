import { useState } from 'react';
import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtTargetTime, fmtUsd } from '../lib/format';
import { Backspace } from './icons';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
const NUDGES = [-100, -25, 25, 100];

/**
 * Sets the round's target by hand, so this market can be lined up against the
 * strike a real book is quoting rather than the price at our round's open.
 */
export function StrikeSheet() {
  const store = useMarket(true);
  const [entry, setEntry] = useState(() => store.round.strike.toFixed(2));
  const [error, setError] = useState('');

  const value = Number(entry);
  const valid = Number.isFinite(value) && value > 0;
  const delta = valid ? store.price - value : 0;

  const press = (key: string) => {
    setError('');
    setEntry((prev) => {
      if (key === 'del') return prev.length <= 1 ? '0' : prev.slice(0, -1);
      if (key === '.') return prev.includes('.') ? prev : prev + '.';
      const next = prev === '0' ? key : prev + key;
      if (/\.\d{3,}$/.test(next)) return prev;
      return Number(next) > 100_000_000 ? prev : next;
    });
  };

  const nudge = (by: number) => {
    setError('');
    setEntry((prev) => Math.max(0.01, (Number(prev) || 0) + by).toFixed(2));
  };

  const submit = () => {
    const result = store.setManualStrike(value);
    if (!result.ok) {
      setError(result.error ?? 'Could not set the target');
      return;
    }
    store.closeSheet();
  };

  return (
    <Sheet
      title="Set the target"
      subtitle={
        <>
          Settles at {fmtTargetTime(store.round.endsAt)} · now{' '}
          <span className="tnum">{fmtUsd(store.price)}</span>
        </>
      }
      onClose={() => store.closeSheet()}
      footer={
        <>
          <button className="primary-btn" disabled={!valid} onClick={submit}>
            Set target to {valid ? fmtUsd(value) : '—'}
          </button>
          {store.strikeMode === 'manual' && (
            <button
              className="danger-btn"
              style={{ borderColor: '#2c323b', color: 'var(--muted)' }}
              onClick={() => {
                store.clearManualStrike();
                store.closeSheet();
              }}
            >
              Back to automatic
            </button>
          )}
          {error && <div className="form-error">{error}</div>}
        </>
      }
    >
      <div className="stake-display">
        <div className="amount tnum">${entry}</div>
        <div className="balance tnum">
          {valid ? (
            <>
              {Math.abs(delta) < 0.005
                ? 'level with the current price'
                : `${fmtUsd(Math.abs(delta))} ${delta > 0 ? 'below' : 'above'} the current price`}
            </>
          ) : (
            'Enter a price'
          )}
        </div>
      </div>

      <div className="chips">
        {NUDGES.map((n) => (
          <button key={n} className="chip tnum" onClick={() => nudge(n)}>
            {n > 0 ? `+${n}` : n}
          </button>
        ))}
      </div>

      <div className="chips" style={{ gridTemplateColumns: '1fr' }}>
        <button className="chip" onClick={() => setEntry(store.price.toFixed(2))}>
          Use the current price
        </button>
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k} className="key" onClick={() => press(k)}>
            {k === 'del' ? <Backspace /> : k}
          </button>
        ))}
      </div>

      <div className="note">
        A target set here is pinned: it stays put when the round rolls over,
        because a real book's strike does not move just because our clock did.
        Update it whenever theirs changes, or hand it back to automatic.
      </div>
      <div className="note">
        Any open picks are refunded when the target moves — they were bought
        against the old one.
      </div>
    </Sheet>
  );
}
