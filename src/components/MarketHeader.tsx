import { useMarket } from '../store/useMarket';
import { fmtClock } from '../lib/format';
import { ROUND_LENGTHS } from '../engine/rounds';
import { BitcoinGlyph, Chat, JitGlyph } from './icons';

function roundLabel(ms: number): string {
  return ROUND_LENGTHS.find((r) => r.ms === ms)?.label ?? `${Math.round(ms / 60000)} min`;
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
