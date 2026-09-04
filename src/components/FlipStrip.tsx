import { useMarket } from '../store/useMarket';

/**
 * The flip detector, in one line.
 *
 * It stays quiet by design: the odds of the favoured side changing are
 * usually unremarkable, and a strip that shouts every minute is one you stop
 * reading. It lights up only when the reading is both high and trusted.
 */
export function FlipStrip() {
  const store = useMarket(true);
  const flip = store.flip;

  if (!flip) {
    return (
      <div className="flip-strip">
        <span className="flip-tag">FLIP</span>
        <span className="flip-text dim">Reading the tape…</span>
      </div>
    );
  }

  const pct = Math.round(flip.probability * 100);
  const hot = flip.probability >= 0.6 && flip.confidence !== 'LOW';
  const warm = !hot && flip.probability >= 0.4;

  return (
    <button
      className={`flip-strip${hot ? ' hot' : warm ? ' warm' : ''}`}
      onClick={() => store.openSheet('flip')}
    >
      <span className="flip-tag">FLIP</span>
      <span className="flip-dir">{flip.direction}</span>
      <span className="flip-text">
        <span className="tnum">{pct}%</span>
        <span className="dim"> · {flip.confidence}</span>
      </span>
      <span className="flip-strength tnum">{flip.strength.toFixed(1)}</span>
    </button>
  );
}
