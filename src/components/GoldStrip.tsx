import { useMarket } from '../store/useMarket';
import { fmtMoney } from '../lib/format';

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
        <span className="gold-text dim">Nothing on the board clears the bar</span>
      </button>
    );
  }

  const up = gold.side === 'up';
  const ev = `${gold.ev >= 0 ? '+' : ''}${(gold.ev * 100).toFixed(1)}%`;

  return (
    <button className={`gold-strip lit ${gold.grade.toLowerCase()}`} onClick={() => store.openSheet('gold')}>
      <span className="gold-tag">GOLD</span>
      <span className={`gold-side ${up ? 'yes' : 'no'}`}>{up ? 'UP' : 'DOWN'}</span>
      <span className="gold-text">
        <span className="tnum">{gold.multiplier.toFixed(2)}x</span>
        <span className="dim"> · EV </span>
        <span className={`tnum ${gold.ev >= 0 ? 'pos' : 'neg'}`}>{ev}</span>
        <span className="dim tnum"> ±{(gold.evCi * 100).toFixed(1)}</span>
      </span>
      <span className="gold-stake tnum">{fmtMoney(gold.stake)}</span>
    </button>
  );
}
