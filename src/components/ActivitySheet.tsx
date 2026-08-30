import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtMoney, fmtMultiplier, fmtTargetTime, fmtUsd } from '../lib/format';
import { ArrowDown, ArrowUp } from './icons';

export function ActivitySheet() {
  const store = useMarket(true);
  const open = store.openPositions;
  const openCombos = store.openCombos;
  const history = store.history;

  const totalPnl = history.reduce((sum, h) => sum + h.pnl, 0);
  const played = history.filter((h) => h.staked > 0);
  const wins = played.filter((h) => h.pnl > 0).length;

  return (
    <Sheet
      title="Your activity"
      subtitle={
        played.length > 0 ? (
          <>
            {wins}/{played.length} rounds green · net{' '}
            <span className={totalPnl >= 0 ? 'txt-up' : 'txt-down'}>
              {totalPnl >= 0 ? '+' : '−'}
              {fmtMoney(Math.abs(totalPnl))}
            </span>
          </>
        ) : (
          'No settled picks yet'
        )
      }
      onClose={() => store.closeSheet()}
    >
      {(open.length > 0 || openCombos.length > 0) && (
        <>
          <div className="book-head" style={{ paddingTop: 4 }}>
            <span>Open</span>
            <span />
            <span />
          </div>
          {open.map((p) => (
            <div className="activity-row" key={p.id}>
              <div className={`activity-icon ${p.side}`}>
                {p.side === 'up' ? <ArrowUp size={17} /> : <ArrowDown size={17} />}
              </div>
              <div className="activity-main">
                <div className="t">
                  {p.side === 'up' ? 'Up' : 'Down'} · {fmtMoney(p.stake)} at{' '}
                  {fmtMultiplier(p.multiplier)}
                </div>
                <div className="s tnum">
                  Entry {fmtUsd(p.entryPrice)} · settles {fmtTargetTime(p.roundEndsAt)}
                </div>
              </div>
              <div className="activity-pnl tnum">{fmtMoney(p.stake * p.multiplier)}</div>
            </div>
          ))}
          {openCombos.map((c) => (
            <div className="activity-row" key={c.id}>
              <div className="activity-icon up" style={{ color: '#b06bff' }}>
                {c.legs.length}×
              </div>
              <div className="activity-main">
                <div className="t">
                  Combo · {fmtMoney(c.stake)} at {fmtMultiplier(c.multiplier)}
                </div>
                <div className="s tnum">
                  {c.legsWon}/{c.legs.length} legs landed ·{' '}
                  {c.legs.map((l) => (l.side === 'up' ? '↑' : '↓')).join(' ')}
                </div>
              </div>
              <div className="activity-pnl tnum">{fmtMoney(c.stake * c.multiplier)}</div>
            </div>
          ))}
        </>
      )}

      <div className="book-head" style={{ paddingTop: 16 }}>
        <span>Settled rounds</span>
        <span />
        <span />
      </div>

      {history.length === 0 && (
        <div className="empty-state">
          Nothing settled yet.
          <br />
          Pick Up or Down and wait for the round to close.
        </div>
      )}

      {history.map((h) => (
        <div className="activity-row" key={h.roundId}>
          <div className={`activity-icon ${h.result}`}>
            {h.result === 'up' ? <ArrowUp size={17} /> : <ArrowDown size={17} />}
          </div>
          <div className="activity-main">
            <div className="t">
              {fmtTargetTime(h.endsAt)} · {h.result === 'up' ? 'Up' : 'Down'}
            </div>
            <div className="s tnum">
              {fmtUsd(h.closePrice)} vs target {fmtUsd(h.strike)}
            </div>
          </div>
          {h.staked > 0 ? (
            <div className={`activity-pnl tnum ${h.pnl >= 0 ? 'pos' : 'neg'}`}>
              {h.pnl >= 0 ? '+' : '−'}
              {fmtMoney(Math.abs(h.pnl))}
            </div>
          ) : (
            <div className="activity-pnl tnum" style={{ color: 'var(--muted-2)' }}>
              —
            </div>
          )}
        </div>
      ))}
    </Sheet>
  );
}
