import { clamp, invNormCdf, normCdf } from '../lib/math';
import { HOUSE_EDGE, multiplierFor } from './odds';
import {
  calibrationSamples,
  fairProbability,
  inflationCi,
  volInflation,
} from './calibration';
import type { Side } from './types';

/**
 * The edge hunter.
 *
 * It looks for tickets priced better than they deserve, and what it knows is
 * one measured fact: the board prices every side as N(d2) under a walk whose
 * volatility is whatever it is right now and stays there, and the real spread
 * of outcomes on this tape is wider than that. How much wider depends on how
 * much of the round is left and on how calm the tape is — see calibration.ts,
 * which holds the measurement and the mechanism behind it.
 *
 * That has three consequences worth stating plainly, because they contradict
 * how these markets are usually played:
 *
 *   1. Long shots are underpriced and favourites are dear. Not by opinion —
 *      it falls out of the quote using too small a volatility, which pulls
 *      probability out of both tails and piles it in the middle.
 *   2. The error is largest in the closing seconds and on a calm tape, and it
 *      shrinks toward nothing over a whole round. So *when* you take a price
 *      matters more than which price you take.
 *   3. There is a floor. Below a 1% quote the board's multiplier stops
 *      improving — it clamps — while the odds keep getting worse, so the far
 *      tail is the worst bet on the board rather than the best. The hunter
 *      will not go there.
 *
 * What it still is not: a promise. The house takes 10% of winnings, and that
 * is enough to swallow the mispricing over most of the board. The window
 * where the edge survives the vig is narrow and mostly short-dated, and the
 * strip shows the expected value with its sign either way.
 */

export { fairProbability, volInflation } from './calibration';

/** Profit per $1 staked, on average, at this price. Negative means a loser. */
export function expectedValue(fair: number, multiplier: number): number {
  return fair * multiplier - 1;
}

/**
 * The fraction of a bankroll Kelly would stake. Negative means do not bet.
 *
 * Full Kelly is famously too violent for anything with estimation error in
 * it, so the caller is expected to take a fraction of this.
 */
export function kellyFraction(fair: number, multiplier: number): number {
  const b = multiplier - 1;
  if (b <= 0) return 0;
  return (fair * multiplier - 1) / b;
}

// =========================================================================
// picking one
// =========================================================================

/** The payout window worth hunting in. Nothing shorter than this. */
export const MIN_MULTIPLIER = 1.8;
/**
 * And nothing cheaper than a 1% quote.
 *
 * `multiplierFor` clamps the price it pays at 1%, so a side quoted at 0.4%
 * pays exactly what a 1% side pays while landing less than half as often.
 * Everything below the clamp is strictly dominated by the clamp itself, which
 * is why "priced under 1%" is on the proving ground's list and comes back at
 * a total loss.
 */
export const MIN_QUOTE = 0.01;
export const MAX_MULTIPLIER = multiplierFor(MIN_QUOTE);
/** Where the hunt is aimed when nothing better presents itself. */
export const TARGET_MULTIPLIER = 3;

/**
 * How picky to be, 0 to 1, and what expected value that demands.
 *
 * Zero means "only what the measurement says actually makes money", which is
 * a narrow and mostly late-round set. Turning it up buys more signals at
 * worse prices, down to the middle of the board where the vig is unanswerable.
 * That is the real trade, and the reason this is a slider and not a constant.
 */
export function evThresholdFor(aggression: number): number {
  const a = clamp(aggression, 0, 1);
  return 0.005 - a * 0.06;
}

export type EdgeGrade = 'PRIME' | 'FAIR' | 'THIN';

export interface EdgePick {
  side: Side;
  /** What the book is quoting this side at. */
  quoted: number;
  /** What the measurement says it should be. */
  fair: number;
  multiplier: number;
  ev: number;
  /** Half-width of the 95% interval on that expected value. */
  evCi: number;
  /** The effective volatility multiplier behind the correction. */
  k: number;
  /** Quarter-Kelly, as a fraction of the balance. */
  stakeFraction: number;
  /** Dollars, rounded to something you would actually type. */
  stake: number;
  grade: EdgeGrade;
  /** Independent samples behind the cell this was priced from. */
  samples: number;
  /** Why it was picked. */
  note: string;
}

function gradeFor(ev: number, evCi: number): EdgeGrade {
  if (ev - evCi > 0) return 'PRIME';
  if (ev > 0) return 'FAIR';
  return 'THIN';
}

/** Quarter Kelly, floored at nothing and capped so one ticket cannot ruin you. */
export function stakeFor(fair: number, multiplier: number, balance: number): number {
  const kelly = kellyFraction(fair, multiplier);
  const fraction = clamp(kelly / 4, 0, 0.05);
  const raw = balance * (fraction > 0 ? fraction : 0.01);
  return Math.max(1, Math.round(raw));
}

export interface EdgeInput {
  pUp: number;
  balance: number;
  aggression: number;
  /** Blocks a pick when the round is too far gone to enter. */
  tradable: boolean;
  /** Seconds until settlement — the axis the mispricing varies most along. */
  secondsLeft: number;
  /** Live volatility over its long-run level. */
  volRatio: number;
}

/**
 * The best ticket on the board inside the payout window, or nothing.
 *
 * Only one side can be in the window at a time — they are complements, so if
 * Up pays 3x then Down pays about 1.5x and is out of range by construction.
 * That makes this a filter and a grade rather than a choice between two.
 */
export function findEdge(input: EdgeInput): EdgePick | null {
  const { pUp, balance, aggression, tradable, secondsLeft, volRatio } = input;
  if (!tradable) return null;

  const threshold = evThresholdFor(aggression);
  const k = volInflation(secondsLeft, volRatio);
  // The interval on k, carried through to an interval on the expected value.
  const kCi = inflationCi(secondsLeft, volRatio);
  const samples = calibrationSamples(secondsLeft, volRatio);
  let best: EdgePick | null = null;

  for (const side of ['up', 'down'] as Side[]) {
    const quoted = side === 'up' ? pUp : 1 - pUp;
    if (quoted < MIN_QUOTE) continue;
    const multiplier = multiplierFor(quoted);
    if (multiplier < MIN_MULTIPLIER || multiplier > MAX_MULTIPLIER) continue;

    const fair = fairProbability(quoted, secondsLeft, volRatio);
    const ev = expectedValue(fair, multiplier);
    // Re-price at the low end of k's own interval: the gap is what the
    // measurement's uncertainty is worth on this particular ticket, which is
    // far more useful than an interval on k that nobody can read off a strip.
    const evCi = Math.abs(ev - expectedValue(priceAtK(quoted, k - kCi), multiplier));
    if (ev < threshold) continue;

    const kelly = kellyFraction(fair, multiplier);
    const pick: EdgePick = {
      side,
      quoted,
      fair,
      multiplier,
      ev,
      evCi,
      k,
      stakeFraction: clamp(kelly / 4, 0, 0.05),
      stake: stakeFor(fair, multiplier, balance),
      grade: gradeFor(ev, evCi),
      samples,
      note: noteFor(ev, evCi, secondsLeft),
    };
    if (!best || pick.ev > best.ev) best = pick;
  }
  return best;
}

/** Re-prices a quote under a given volatility multiplier. */
function priceAtK(quoted: number, k: number): number {
  if (!(k > 0) || quoted <= 0 || quoted >= 1) return quoted;
  if (quoted === 0.5) return 0.5;
  const near = quoted <= 0.5 ? quoted : 1 - quoted;
  const f = clamp(normCdf(invNormCdf(near) / k), 1e-9, 0.5);
  return quoted <= 0.5 ? f : 1 - f;
}

function noteFor(ev: number, evCi: number, secondsLeft: number): string {
  if (ev - evCi > 0) {
    return secondsLeft <= 60
      ? 'Priced above its worth, and the interval clears zero — this is the closing-seconds window'
      : 'Priced above its worth, and the interval clears zero';
  }
  if (ev > 0) return 'Priced above its worth, but not by more than the measurement can resolve';
  return 'Best price on the board, and still behind the house cut';
}

/** One row of "what every price on the board is worth, right now". */
export interface EvRow {
  quoted: number;
  multiplier: number;
  fair: number;
  ev: number;
  evCi: number;
}

/** The prices the sheet walks through, from the clamp out to a coin flip. */
const CURVE_QUOTES = [0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35, 0.5];

/**
 * What each price on the board is worth at a given moment.
 *
 * The whole curve moves with the clock, which is the point: the same 30x
 * ticket is a different bet with twenty seconds left than with ten minutes.
 */
export function evCurve(secondsLeft: number, volRatio: number): EvRow[] {
  const k = volInflation(secondsLeft, volRatio);
  const kCi = inflationCi(secondsLeft, volRatio);
  return CURVE_QUOTES.map((quoted) => {
    const multiplier = multiplierFor(quoted);
    const fair = fairProbability(quoted, secondsLeft, volRatio);
    const ev = expectedValue(fair, multiplier);
    return {
      quoted,
      multiplier,
      fair,
      ev,
      evCi: Math.abs(ev - expectedValue(priceAtK(quoted, k - kCi), multiplier)),
    };
  });
}

/** The best price on the board at this moment, and what it is worth. */
export function bestAt(secondsLeft: number, volRatio: number): EvRow {
  return evCurve(secondsLeft, volRatio).reduce((a, b) => (b.ev > a.ev ? b : a));
}

/** The house's cut, restated where the reasoning needs it. */
export const VIG = HOUSE_EDGE;
