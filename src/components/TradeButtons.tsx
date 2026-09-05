import { useMarket } from '../store/useMarket';
import { fmtMoney, fmtMultiplier } from '../lib/format';
import { LOCK_MS } from '../engine/odds';
import type { Side } from '../engine/types';
import { Book, ComboMark } from './icons';

export function TradeArea() {
  const store = useMarket(true);
  const { feedDown, awaitingFeed, canTrade } = store;
  // No usable quote means the percentages and multipliers are not real yet.
  const noQuote = feedDown || awaitingFeed;

  const label = (side: Side) => {
    if (feedDown) return 'Offline';
    if (awaitingFeed) return 'Connecting';
    if (!canTrade) return 'Locked';
    const pct = side === 'up' ? store.quote.upPct : store.quote.downPct;
    return `${side === 'up' ? 'Up' : 'Down'} · ${pct}%`;
  };

  const multiplier = (side: Side) =>
    noQuote
      ? '—'
      : fmtMultiplier(side === 'up' ? store.quote.upMultiplier : store.quote.downMultiplier);

  return (
    <div className="trade-area">
      <button className="book-btn" onClick={() => store.openSheet('book')}>
        <Book />
        Order book
      </button>

      <div className="divider" />

      <div className="bet-row">
        {(['up', 'down'] as const).map((side) => {
          const stake = store.stakeOn(side);
          return (
            <div
              className={`bet${store.isGoldSide(side) ? ' gold' : ''}${
                store.blocked ? ' blocked' : ''
              }`}
              key={side}
            >
              <button
                className={`bet-btn ${side}${store.isGoldSide(side) ? ' gold' : ''}`}
                disabled={!canTrade}
                onClick={() =>
                  store.blocked ? store.openSheet('coach') : store.openSheet('ticket', side)
                }
              >
                {label(side)}
              </button>
              <div className="bet-sub tnum">{multiplier(side)}</div>
              {stake > 0 && (
                <div className={`bet-stake ${side} tnum`}>
                  {fmtMoney(stake)} → {fmtMoney(store.returnIf(side))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <TradeNote />

      <button className="combo-bar" onClick={() => store.openSheet('combo')}>
        <ComboMark />
        COMBO
        {store.openCombos.length > 0 && (
          <span className="count tnum">{store.openCombos.length} open</span>
        )}
      </button>
    </div>
  );
}

function TradeNote() {
  const store = useMarket(true);
  const style = { textAlign: 'center' as const, marginTop: 10 };

  if (store.feedDown) {
    return (
      <div className="note" style={{ ...style, color: 'var(--down)' }}>
        No live BTC price to settle against.{' '}
        <button
          style={{ color: 'inherit', textDecoration: 'underline', fontWeight: 800 }}
          onClick={() => store.setMode('sim')}
        >
          Switch to JIT Coin
        </button>
      </div>
    );
  }
  if (store.awaitingFeed) {
    return (
      <div className="note" style={style}>
        Waiting for the first price from Coinbase
      </div>
    );
  }
  if (store.isLocked) {
    return (
      <div className="note" style={style}>
        Picks close {LOCK_MS / 1000}s before settlement
      </div>
    );
  }
  return null;
}
