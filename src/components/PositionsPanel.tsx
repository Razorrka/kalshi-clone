import { useMarket } from '../store/useMarket';
import { fmtMoney, fmtMultiplier, fmtUsd } from '../lib/format';
import { ArrowDown, ArrowUp, Close } from './icons';
import type { Position } from '../engine/types';

function signed(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`;
}

function OpenRow({ position }: { position: Position }) {
  const store = useMarket(true);
  const { value, pnl } = store.markOf(position);
  const pct = (pnl / position.stake) * 100;
  const up = pnl >= 0;

  return (
    <div className="pos-card">
      <div className="pos-top">
        <div className={`pos-side ${position.side}`}>
          {position.side === 'up' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          {position.side === 'up' ? 'Up' : 'Down'}
        </div>
        <div className="pos-main">
          <div className="pos-line tnum">
            {fmtMoney(position.stake)} <span className="dim">·</span>{' '}
            {fmtMultiplier(position.multiplier)}{' '}
            <span className="dim">→ {fmtMoney(position.stake * position.multiplier)}</span>
          </div>
          <div className="pos-sub tnum">Entry {fmtUsd(position.entryPrice)}</div>
        </div>
        <div className="pos-right">
          <div className={`pos-pnl tnum ${up ? 'pos' : 'neg'}`}>{signed(pnl)}</div>
          <div className={`pos-pct tnum ${up ? 'pos' : 'neg'}`}>
            {up ? '+' : '−'}
            {Math.abs(pct).toFixed(1)}%
          </div>
        </div>
      </div>
      <button
        className="pos-close"
        disabled={!store.canTrade}
        onClick={() => store.closePosition(position.id)}
      >
        {store.isLocked ? 'Closing suspended near settlement' : `Close for ${fmtMoney(value)}`}
      </button>
    </div>
  );
}

export function PositionsPanel() {
  const store = useMarket(true);
  const open = store.openPositions;
  const resting = store.restingOrders;
  const settled = store.positions.filter(
    (p) => p.status !== 'open' && p.roundId === store.round.id,
  );

  const totalStake = open.reduce((s, p) => s + p.stake, 0);
  const pnl = store.openPnl;

  return (
    <div className="positions-panel">
      {open.length > 0 && (
        <div className={`pos-summary ${pnl >= 0 ? 'pos' : 'neg'}`}>
          <div className="pos-summary-top">
            <div>
              <div className="k">Open P&amp;L</div>
              <div className="v tnum">{signed(pnl)}</div>
            </div>
            <div className="right">
              <div className="k">Worth now</div>
              <div className="v2 tnum">{fmtMoney(store.openValue)}</div>
              <div className="s tnum">{fmtMoney(totalStake)} staked</div>
            </div>
          </div>
          <div className="pos-summary-note">
            Moves with the price — close any time to lock it in.
          </div>
        </div>
      )}

      {open.length === 0 && resting.length === 0 && settled.length === 0 && (
        <div className="empty-state">
          No orders on this round.
          <br />
          Pick Up or Down below, or rest a limit order at your own price.
        </div>
      )}

      {open.map((p) => (
        <OpenRow key={p.id} position={p} />
      ))}

      {resting.length > 0 && (
        <>
          <div className="pos-heading">Resting orders</div>
          {resting.map((o) => (
            <div className="pos-card" key={o.id}>
              <div className="pos-top">
                <div className={`pos-side ${o.side} ghost`}>
                  {o.side === 'up' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                  {o.side === 'up' ? 'Up' : 'Down'}
                </div>
                <div className="pos-main">
                  <div className="pos-line tnum">
                    {fmtMoney(o.stake)} <span className="dim">at</span> {o.limitCents}¢{' '}
                    <span className="dim">or better</span>
                  </div>
                  <div className="pos-sub tnum">
                    Now {store.centsFor(o.side)}¢ · waiting
                  </div>
                </div>
                <button className="pos-cancel" onClick={() => store.cancelLimitOrder(o.id)}>
                  <Close size={11} /> Cancel
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {settled.length > 0 && (
        <>
          <div className="pos-heading">Done this round</div>
          {settled.map((p) => (
            <div className="pos-card muted" key={p.id}>
              <div className="pos-top">
                <div className={`pos-side ${p.side} ghost`}>
                  {p.side === 'up' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                  {p.side === 'up' ? 'Up' : 'Down'}
                </div>
                <div className="pos-main">
                  <div className="pos-line tnum">
                    {fmtMoney(p.stake)}{' '}
                    <span className="dim">
                      {p.status === 'closed'
                        ? 'closed early'
                        : p.status === 'won'
                          ? 'won'
                          : 'lost'}
                    </span>
                  </div>
                </div>
                <div className={`pos-pnl tnum ${(p.pnl ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  {signed(p.pnl ?? 0)}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
