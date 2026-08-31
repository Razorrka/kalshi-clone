import { useState } from 'react';
import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtMoney } from '../lib/format';
import { Backspace } from './icons';

const CHIPS = [50, 100, 250, 500, 1_000, 5_000];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

/**
 * Sets or tops up the practice balance. A smaller stake is the point: the
 * size of the number is what decides whether a loss registers.
 */
export function BalanceSheet() {
  const store = useMarket(true);
  const [entry, setEntry] = useState(() => String(Math.round(store.balance)));
  const [error, setError] = useState('');

  const value = Number(entry);
  const valid = Number.isFinite(value) && value >= 0;

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

  const run = (fn: () => { ok: boolean; error?: string }) => {
    const result = fn();
    if (!result.ok) {
      setError(result.error ?? 'Could not do that');
      return;
    }
    store.closeSheet();
  };

  return (
    <Sheet
      title="Practice balance"
      subtitle={
        <>
          Now <span className="tnum">{fmtMoney(store.balance)}</span> · resets to{' '}
          <span className="tnum">{fmtMoney(store.startingBalanceCents / 100)}</span>
        </>
      }
      onClose={() => store.closeSheet()}
      footer={
        <>
          <button
            className="primary-btn"
            disabled={!valid}
            onClick={() => run(() => store.setBalance(value))}
          >
            Set balance to {valid ? fmtMoney(value) : '—'}
          </button>
          <button
            className="danger-btn"
            style={{ borderColor: '#2c323b', color: 'var(--muted)' }}
            disabled={!valid || value <= 0}
            onClick={() => run(() => store.addFunds(value))}
          >
            Or add {valid ? fmtMoney(value) : '—'} to what you have
          </button>
          {error && <div className="form-error">{error}</div>}
        </>
      }
    >
      <div className="stake-display">
        <div className="amount tnum">${entry}</div>
        <div className="balance">
          {valid && value < store.balance
            ? `${fmtMoney(store.balance - value)} smaller than now`
            : valid && value > store.balance
              ? `${fmtMoney(value - store.balance)} larger than now`
              : 'the same as now'}
        </div>
      </div>

      <div className="chips" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {CHIPS.map((c) => (
          <button
            key={c}
            className={`chip tnum${Number(entry) === c ? ' active' : ''}`}
            onClick={() => {
              setError('');
              setEntry(String(c));
            }}
          >
            {fmtMoney(c)}
          </button>
        ))}
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k} className="key" onClick={() => press(k)}>
            {k === 'del' ? <Backspace /> : k}
          </button>
        ))}
      </div>

      <div className="note">
        Setting a balance also sets what <em>Reset</em> returns to, so you can
        keep restarting at a stake that makes you think. Adding funds tops up
        what you have and leaves that number alone.
      </div>
      <div className="note">
        Open picks are untouched either way — they were priced against a target
        and a quote, and neither depends on how much is in the account.
      </div>
    </Sheet>
  );
}
