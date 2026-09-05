import { clamp } from '../lib/math';
import { HOUSE_EDGE, multiplierFor } from './odds';
import type { Side } from './types';

/**
 * The edge hunter.
 *
 * This looks for long-shot tickets whose price is better than they deserve,
 * and it is built on a measurement rather than a hope. 120,000 independent
 * bets through the simulator — one per round, so no two share an outcome —
 * gave the realised win rate at every quoted price, and from that the real
 * expected value of every bet on the board.
 *
 * The headline is worth reading before trusting a gold light: nothing here is
 * profitable. The house takes 10% of winnings, and the fat tails in the price
 * process — jumps and moving volatility, which the N(d2) quote does not model
 * — only hand back enough to cancel that at the very far end. The band that
 * pays 2x to 4x, which is where a 3x hunt naturally fishes, is the *worst* on
 * the board at roughly -5%.
 *
 * So this ranks, it does not promise. It finds the best-priced moment
 * available and says exactly what that is worth, minus sign included.
 */

// =========================================================================
// the fair price
// =========================================================================

/**
 * How often a side quoted here actually won, straight off the measurement.
 *
 * An earlier version of this fitted a smooth recalibration curve through
 * those points — logit(fair) = a + b*logit(quote), the textbook move. Run
 * against fresh seeds it scored 661.73 against the raw quote's 661.70 on
 * Brier loss: no better, marginally worse. It was a curve through noise, so
 * it is gone.
 *
 * What is left is the measurement itself, which needs no fitting and comes
 * with an interval. Between bands it interpolates; outside them it hands back
 * the quote, because there is nothing measured to say otherwise.
 */
export function fairProbability(quoted: number): number {
  if (!(quoted > 0) || !(quoted < 1)) return clamp(quoted, 0, 1);
  const band = bandFor(quoted);
  if (!band) return quoted;
  // The band's own miss, applied to this quote. An earlier version blended
  // toward the neighbouring bands' rates to smooth the steps, which pulled
  // every value toward its lower neighbour and reported a 47.4% band that
  // measured 47.06% as 46.5% — distorting the measurement it exists to
  // report. This adds the offset that was actually observed and nothing else.
  return clamp(quoted + (band.rate - band.quotedAvg), 1e-6, 1 - 1e-6);
}

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
// what was actually measured
// =========================================================================

export interface EvBand {
  /** Quoted probability at the low end of the band. */
  from: number;
  to: number;
  /** Average multiplier bets in this band paid. */
  pays: number;
  /** Average price actually quoted to bets in this band. */
  quotedAvg: number;
  /** How often the side actually won, measured. */
  rate: number;
  /** Realised return per $1, over independent bets. */
  ev: number;
  /** Half-width of the 95% interval, in the same units. */
  ci: number;
  n: number;
}

/**
 * Realised expected value by quoted price, from 120,000 independent bets.
 *
 * Read the interval, not the point. The far tail looks positive and is not:
 * at 28x a handful of extra wins moves the estimate ten points, which is why
 * its interval is enormous. Everything from 15% up is reliably negative and
 * its intervals say so.
 */
export const MEASURED_EV: EvBand[] = [
  { from: 0.02, to: 0.05, pays: 28.3, quotedAvg: 0.035, rate: 0.0371, ev: 0.049, ci: 0.129, n: 6530 },
  { from: 0.05, to: 0.08, pays: 14.2, quotedAvg: 0.064, rate: 0.0693, ev: -0.013, ci: 0.097, n: 5278 },
  { from: 0.08, to: 0.11, pays: 9.6, quotedAvg: 0.094, rate: 0.1045, ev: 0.009, ci: 0.082, n: 4965 },
  { from: 0.11, to: 0.15, pays: 7.1, quotedAvg: 0.129, rate: 0.1411, ev: -0.002, ci: 0.06, n: 6433 },
  { from: 0.15, to: 0.2, pays: 5.3, quotedAvg: 0.174, rate: 0.1782, ev: -0.06, ci: 0.044, n: 8429 },
  { from: 0.2, to: 0.26, pays: 4.0, quotedAvg: 0.228, rate: 0.2356, ev: -0.053, ci: 0.032, n: 10891 },
  { from: 0.26, to: 0.33, pays: 3.2, quotedAvg: 0.294, rate: 0.3056, ev: -0.036, ci: 0.024, n: 14438 },
  { from: 0.33, to: 0.4, pays: 2.6, quotedAvg: 0.364, rate: 0.3763, ev: -0.035, ci: 0.019, n: 17294 },
  { from: 0.4, to: 0.45, pays: 2.2, quotedAvg: 0.424, rate: 0.4225, ev: -0.063, ci: 0.018, n: 14221 },
  { from: 0.45, to: 0.5, pays: 2.0, quotedAvg: 0.474, rate: 0.4706, ev: -0.061, ci: 0.016, n: 15358 },
];

/** The measured band a quoted probability falls in, if any. */
export function bandFor(quoted: number): EvBand | null {
  return MEASURED_EV.find((b) => quoted >= b.from && quoted < b.to) ?? null;
}

/** True when the measurement cannot tell this band apart from break-even. */
export function isBreakEven(band: EvBand): boolean {
  return Math.abs(band.ev) <= band.ci;
}

// =========================================================================
// picking one
// =========================================================================

/** The payout window worth hunting in. Nothing shorter, nothing sillier. */
export const MIN_MULTIPLIER = 1.8;
export const MAX_MULTIPLIER = 11;
/** Where the hunt is aimed when nothing better presents itself. */
export const TARGET_MULTIPLIER = 3;

/**
 * How picky to be, 0 to 1, and what expected value that demands.
 *
 * At 0 it only takes the far tail, where the measurement cannot rule out
 * break-even. Turning it up buys more signals with worse prices, which is the
 * real trade and the reason this is a slider rather than a constant.
 */
export function evThresholdFor(aggression: number): number {
  const a = clamp(aggression, 0, 1);
  // Anchored to what the measurement says is actually on the board. Inside
  // the 1.8x-11x window the best price runs about -1% and the worst about
  // -6%, so a threshold outside that range would either never light or never
  // decline anything.
  return -0.012 - a * 0.05;
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
  /** Quarter-Kelly, as a fraction of the balance. */
  stakeFraction: number;
  /** Dollars, rounded to something you would actually type. */
  stake: number;
  grade: EdgeGrade;
  band: EvBand | null;
  /** Why it was picked, or why nothing was. */
  note: string;
}

function gradeFor(ev: number, band: EvBand | null): EdgeGrade {
  if (band && isBreakEven(band) && ev > -0.02) return 'PRIME';
  if (ev > -0.04) return 'FAIR';
  return 'THIN';
}

/** Quarter Kelly, floored at nothing and capped so one ticket cannot ruin you. */
export function stakeFor(fair: number, multiplier: number, balance: number): number {
  const kelly = kellyFraction(fair, multiplier);
  // Kelly is negative on every bet here, so a losing edge stakes the minimum
  // rather than going short — you cannot sell, only decline.
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
}

/**
 * The best ticket on the board inside the payout window, or nothing.
 *
 * Only one side can be in the window at a time — they are complements, so if
 * Up pays 3x then Down pays about 1.5x and is out of range by construction.
 * That makes this a filter and a grade rather than a choice between two.
 */
export function findEdge(input: EdgeInput): EdgePick | null {
  const { pUp, balance, aggression, tradable } = input;
  if (!tradable) return null;

  const threshold = evThresholdFor(aggression);
  let best: EdgePick | null = null;

  for (const side of ['up', 'down'] as Side[]) {
    const quoted = side === 'up' ? pUp : 1 - pUp;
    const multiplier = multiplierFor(quoted);
    if (multiplier < MIN_MULTIPLIER || multiplier > MAX_MULTIPLIER) continue;

    const fair = fairProbability(quoted);
    const ev = expectedValue(fair, multiplier);
    if (ev < threshold) continue;

    const band = bandFor(quoted);
    const kelly = kellyFraction(fair, multiplier);
    const pick: EdgePick = {
      side,
      quoted,
      fair,
      multiplier,
      ev,
      stakeFraction: clamp(kelly / 4, 0, 0.05),
      stake: stakeFor(fair, multiplier, balance),
      grade: gradeFor(ev, band),
      band,
      note:
        band && isBreakEven(band)
          ? 'Best-priced band on the board — the measurement cannot tell it from break-even'
          : `Measured at ${((band?.ev ?? ev) * 100).toFixed(1)}% per $1 over ${band?.n ?? 0} bets`,
    };
    if (!best || pick.ev > best.ev) best = pick;
  }
  return best;
}

/** The house's cut, restated where the reasoning needs it. */
export const VIG = HOUSE_EDGE;
