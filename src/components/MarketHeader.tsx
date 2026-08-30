import { useMarket } from '../store/useMarket';
import { fmtClock } from '../lib/format';
import { ROUND_LENGTHS } from '../engine/rounds';
import { BitcoinGlyph, Chat, JitGlyph } from './icons';

function roundLabel(ms: number): string {
  return ROUND_LENGTHS.find((r) => r.ms === ms)?.label ?? `${Math.round(ms / 60000)} min`;
}

/** Connection state for the live feed: green streaming, amber trying, red out. */
function FeedDot() {
  const store = useMarket();
  const state =
    store.feedStatus === 'live'
      ? 'live'
      : store.feedStatus === 'error'
        ? 'bad'
        : 'warn';
  const label =
    state === 'live' ? 'Live feed' : state === 'bad' ? 'Feed offline' : 'Connecting';
  return (
    <span
      className={`feed-dot ${state}`}
      role="status"
      aria-label={label}
      title={store.feedDetail ? `${label} — ${store.feedDetail}` : label}
    />
  );
}

export function MarketHeader() {
  const store = useMarket(true);
  const live = store.mode === 'live';
  const msLeft = store.msLeft;
  const urgent = msLeft <= 30_000;

  return (
    <div className="market-head">
      <div className={`coin-badge${live ? '' : ' jit'}`}>
        {live ? <BitcoinGlyph size={23} /> : <JitGlyph size={22} />}
      </div>
      <h1 className="market-title">
        {live ? 'BTC' : 'JIT'} {roundLabel(store.roundMs)}
      </h1>
      <span className={`countdown tnum${urgent ? ' urgent' : ''}`}>
        {fmtClock(msLeft)}
      </span>
      {live && <FeedDot />}
      <span className="spacer" />
      <button
        className="circ"
        style={{ position: 'relative' }}
        aria-label="Your activity"
        onClick={() => store.openSheet('activity')}
      >
        <Chat />
        {store.openPositions.length + store.openCombos.length > 0 && (
          <i className="badge-dot" />
        )}
      </button>
    </div>
  );
}
