import { useState } from 'react';
import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtClock, fmtMoney, fmtMultiplier, fmtUsd } from '../lib/format';
import { ArrowDown, ArrowUp, Backspace } from './icons';
import type { Side } from '../engine/types';

const CHIPS = [1, 5, 25, 100];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

export function TicketSheet() {
  const store = useMarket(true);
  const [entry, setEntry] = useState(() => String(store.ticketStake));
  const [error, setError] = useState('');

  const side = store.ticketSide;
  const stake = Number(entry) || 0;
  const multiplier =
    side === 'up' ? store.quote.upMultiplier : store.quote.downMultiplier;
  const pct = side === 'up' ? store.quote.upPct : store.quote.downPct;
  const toWin = stake * multiplier;

  const press = (key: string) => {
    setError('');
    setEntry((prev) => {
      if (key === 'del') return prev.length <= 1 ? '0' : prev.slice(0, -1);
      if (key === '.') return prev.includes('.') ? prev : prev + '.';
      const next = prev === '0' ? key : prev + key;
      // Two decimal places, and a ceiling that keeps the display readable.
      if (/\.\d{3,}$/.test(next)) return prev;
      return Number(next) > 1_000_000 ? prev : next;
    });
  };

  const setSide = (next: Side) => {
    setError('');
    store.openSheet('ticket', next);
  };

  const submit = () => {
    const result = store.placeBet(side, stake);
    if (!result.ok) {
      setError(result.error ?? 'Could not place');
      return;
    }
    store.setTicketStake(stake);
    store.closeSheet();
  };

  const disabled = stake <= 0 || stake > store.balance || store.isLocked;

  return (
    <Sheet
      title={`${store.mode === 'live' ? 'BTC' : 'JIT'} · ${fmtUsd(store.round.strike)}`}
      subtitle={
        <>
          Settles in <span className="tnum">{fmtClock(store.msLeft)}</span> · now{' '}
          <span className="tnum">{fmtUsd(store.price)}</span>
        </>
      }
      onClose={() => store.closeSheet()}
      footer={
        <>
          <button
            className={`primary-btn ${side}`}
            disabled={disabled}
            onClick={submit}
          >
            {store.isLocked
              ? 'Market locked'
              : `${side === 'up' ? 'Up' : 'Down'} · ${fmtMoney(stake)} to win ${fmtMoney(toWin)}`}
          </button>
          {error && <div className="form-error">{error}</div>}
        </>
      }
    >
      <div className="side-toggle">
        <button
          className={`up${side === 'up' ? ' active' : ''}`}
          onClick={() => setSide('up')}
        >
          <ArrowUp size={15} /> Up · {store.quote.upPct}%
        </button>
        <button
          className={`down${side === 'down' ? ' active' : ''}`}
          onClick={() => setSide('down')}
        >
          <ArrowDown size={15} /> Down · {store.quote.downPct}%
        </button>
      </div>

      <div className="stake-display">
        <div className="amount tnum">${entry}</div>
        <div className="balance tnum">Balance {fmtMoney(store.balance)}</div>
      </div>

      <div className="chips">
        {CHIPS.map((c) => (
          <button
            key={c}
            className={`chip tnum${Number(entry) === c ? ' active' : ''}`}
            onClick={() => {
              setError('');
              setEntry(String(c));
            }}
          >
            ${c}
          </button>
        ))}
      </div>

      <div className="chips" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <button
          className="chip"
          onClick={() => setEntry(String(Math.max(1, Math.floor(stake / 2))))}
        >
          ½
        </button>
        <button
          className="chip"
          onClick={() => setEntry(String(Math.floor(stake * 2) || 1))}
        >
          2×
        </button>
        <button
          className="chip"
          onClick={() => setEntry(String(Math.floor(store.balance * 100) / 100))}
        >
          Max
        </button>
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k} className="key" onClick={() => press(k)}>
            {k === 'del' ? <Backspace /> : k}
          </button>
        ))}
      </div>

      <div className="ticket-summary">
        <div>
          <div className="k">Payout at {pct}%</div>
          <div className="v tnum">{fmtMultiplier(multiplier)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="k">To win</div>
          <div className="v tnum" style={{ color: `var(--${side})` }}>
            {fmtMoney(toWin)}
          </div>
        </div>
      </div>

      <div className="note">
        The multiplier locks in when you place the pick. Up settles if the final price
        is strictly above the target; a tie settles Down.
      </div>
    </Sheet>
  );
}
