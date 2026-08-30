import { useMarket } from '../store/useMarket';
import { fmtTargetTime, fmtUsd } from '../lib/format';
import { ArrowDown, ArrowUp, Info } from './icons';

export function PriceStrip() {
  const store = useMarket(true);
  const waiting = store.awaitingFeed;
  const delta = store.price - store.round.strike;
  const above = delta >= 0;
  const flash =
    store.recentDir > 0 ? 'flash-up' : store.recentDir < 0 ? 'flash-down' : '';

  return (
    <div className="price-strip">
      <div className="price-col">
        <div className="label">Target · {fmtTargetTime(store.round.endsAt)}</div>
        <div className="value tnum">{waiting ? '—' : fmtUsd(store.round.strike)}</div>
      </div>

      <div className="vrule" />

      <div className="price-col">
        {waiting ? (
          <div className="label dim">Waiting for feed</div>
        ) : (
          <div className={`label delta ${above ? 'up' : 'down'}`}>
            Now {above ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{' '}
            <span className="tnum">{fmtUsd(Math.abs(delta))}</span>
          </div>
        )}
        <div className={`value tnum ${waiting ? '' : flash}`}>
          {waiting ? '—' : fmtUsd(store.price)}
        </div>
      </div>

      <button
        className="info"
        aria-label="How this market works"
        onClick={() => store.openSheet('settings')}
      >
        <Info />
      </button>
    </div>
  );
}
