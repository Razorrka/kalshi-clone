import { useMarket } from '../store/useMarket';

/**
 * The edge hunter, in one line.
 *
 * Dark when nothing on the board clears the bar, gold when something does, and
 * the number is the measured expected value of that ticket with its sign
 * either way. PRIME means the interval clears zero — the measurement says this
 * one makes money. FAIR means it looks positive but not by more than the
 * measurement can resolve. THIN means it is the best price available and still
 * behind the house cut, which is most of the board most of the time.
 */
export function GoldStrip() {
  const store = useMarket(true);
  const gold = store.gold;

  if (!gold) {
    return (
      <button className="gold-strip" onClick={() => store.openSheet('gold')}>
        <span className="gold-tag">GOLD</span>
        <span className="gold-text dim">nothing clears the bar</span>
      </button>
    );
  }

  const up = gold.side === 'up';
  const ev = `${gold.ev >= 0 ? '+' : ''}${(gold.ev * 100).toFixed(1)}%`;

  return (
    <button className={`gold-strip lit ${gold.grade.toLowerCase()}`} onClick={() => store.openSheet('gold')}>
      <span className="gold-tag">GOLD</span>
      <span className={`gold-side ${up ? 'yes' : 'no'}`}>{up ? 'UP' : 'DOWN'}</span>
      {/* Payout and expected value. The stake and the interval are in the
          sheet — this is a half-width strip and has to stay readable. */}
      <span className="gold-text">
        <span className="tnum">{gold.multiplier.toFixed(1)}x</span>
        <span className={`tnum ${gold.ev >= 0 ? 'pos' : 'neg'}`}> {ev}</span>
      </span>
    </button>
  );
}
