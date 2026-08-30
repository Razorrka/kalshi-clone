import { useMarket } from '../store/useMarket';
import { fmtMoney, fmtMultiplier } from '../lib/format';
import { LOCK_MS } from '../engine/odds';
import { Book, ComboMark } from './icons';

export function TradeArea() {
  const store = useMarket(true);
  const down = store.feedDown || store.awaitingFeed;
  const locked = !store.canTrade;
  const upStake = store.stakeOn('up');
  const downStake = store.stakeOn('down');
  const comboCount = store.openCombos.length;

  return (
    <div className="trade-area">
      <button className="book-btn" onClick={() => store.openSheet('book')}>
        <Book />
        Order book
      </button>

      <div className="divider" />

      <div className="bet-row">
        <div className="bet">
          <button
            className="bet-btn up"
            disabled={locked}
            onClick={() => store.openSheet('ticket', 'up')}
          >
            {down
              ? store.feedDown
                ? 'Offline'
                : 'Connecting'
              : locked
                ? 'Locked'
                : `Up · ${store.quote.upPct}%`}
          </button>
          <div className="bet-sub tnum">{fmtMultiplier(store.quote.upMultiplier)}</div>
          {upStake > 0 && (
            <div className="bet-stake up tnum">
              {fmtMoney(upStake)} → {fmtMoney(store.returnIf('up'))}
            </div>
          )}
        </div>

        <div className="bet">
          <button
            className="bet-btn down"
            disabled={locked}
            onClick={() => store.openSheet('ticket', 'down')}
          >
            {down
              ? store.feedDown
                ? 'Offline'
                : 'Connecting'
              : locked
                ? 'Locked'
                : `Down · ${store.quote.downPct}%`}
          </button>
          <div className="bet-sub tnum">{fmtMultiplier(store.quote.downMultiplier)}</div>
          {downStake > 0 && (
            <div className="bet-stake down tnum">
              {fmtMoney(downStake)} → {fmtMoney(store.returnIf('down'))}
            </div>
          )}
        </div>
      </div>

      {store.feedDown ? (
        <div
          className="note"
          style={{ textAlign: 'center', marginTop: 10, color: 'var(--down)' }}
        >
          No live BTC price to settle against.{' '}
          <button
            style={{ color: 'inherit', textDecoration: 'underline', fontWeight: 800 }}
            onClick={() => store.setMode('sim')}
          >
            Switch to JIT Coin
          </button>
        </div>
      ) : (
        locked && (
          <div
            className="note"
            style={{ textAlign: 'center', marginTop: 10, color: 'var(--muted)' }}
          >
            Picks close {LOCK_MS / 1000}s before settlement
          </div>
        )
      )}

      <button className="combo-bar" onClick={() => store.openSheet('combo')}>
        <ComboMark />
        COMBO
        {comboCount > 0 && <span className="count tnum">{comboCount} open</span>}
      </button>
    </div>
  );
}
