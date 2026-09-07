import { PriceEngine, VOL_PRESETS } from './priceEngine';
import { multiplierFor, probUp } from './odds';
import { findEdge } from './edge';
import { volRatioOf } from './calibration';
import type { Side } from './types';

/**
 * The proving ground.
 *
 * Any rule can be described as "when X, bet Y". This runs one over thousands
 * of independent rounds and reports what it actually did — with an interval,
 * against a control, and split into a half it was chosen on and a half it was
 * not. That last part is what separates a strategy from a story.
 *
 * It exists because the answer to "will this idea work" is cheap to measure
 * and expensive to argue about, and because anyone can hand you a list of
 * nine ideas that all sound right.
 */

export interface Snapshot {
  /** Closes so far this round, oldest first. */
  closes: number[];
  price: number;
  strike: number;
  quoted: number;
  multiplier: number;
  msLeft: number;
  vol: number;
}

/** A rule: look at the round so far, return a side to back or nothing. */
export type Rule = (s: Snapshot) => Side | null;

export interface StrategyResult {
  name: string;
  bets: number;
  wins: number;
  /** Wins over bets. Easy to inflate — read the return, not this. */
  winRate: number;
  /** Return per $1 staked. This is the only number that decides anything. */
  ev: number;
  /** Half-width of the 95% interval on that return. */
  ci: number;
  /** Gross winnings over gross losses. Above 1 is a profit. */
  profitFactor: number;
  /** Worst peak-to-trough fall of a flat-staked bankroll, as a fraction. */
  maxDrawdown: number;
  /** The same return, on rounds the rule was never tuned against. */
  holdoutEv: number;
  holdoutBets: number;
  averagePayout: number;
}

const ROUND_MS = 15 * 60_000;
/**
 * How finely the tape is stepped.
 *
 * This is not a free choice, and it has to be the app's own 60ms tick.
 *
 * The engine adds at most one jump per step, of a size fixed relative to that
 * step. So the variance jumps contribute over a second is proportional to the
 * step, while the diffusion's is not — stepping coarsely makes the tape
 * genuinely wilder than the one on screen. Measured over 20,000 rounds the
 * spread of outcomes is 22.02bp at 60ms, 22.26bp at 250ms, 23.52bp at 1s and
 * 24.79bp at 2s, and 1 + 0.0081*(step/60ms) predicts every one of those to
 * within half a point.
 *
 * An earlier version ran at 2s, testing every rule against a tape 12.6% wilder
 * than the real one. That is harmless for a rule that only reads direction and
 * fatal for one that trades on the gap between quoted and realised volatility,
 * which is the only kind that has ever measured positive here.
 */
const STEP_MS = 60;
/** Picks stop being accepted this close to settlement, as in the live market. */
const LOCK_MS = 5_000;
/**
 * How often a rule gets to see a new close.
 *
 * Deliberately separate from the engine's step. A rule that reads "the last 10
 * closes" means a length of time, not a number of array slots, so decimating
 * the tape to a fixed 2s here keeps every rule meaning exactly what it meant
 * when the engine was stepped at 2s — while the engine underneath now runs at
 * the app's real tick.
 */
const CLOSE_MS = 2_000;

/** Simple moving average of the last `n`. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  return gain + loss === 0 ? 50 : (100 * gain) / (gain + loss);
}

function emaOf(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let e = mean(values.slice(0, period));
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Which way the last `back` closes moved. */
function direction(closes: number[], back: number): number {
  const past = closes[Math.max(0, closes.length - 1 - back)];
  return Math.sign(closes[closes.length - 1] - past);
}

/**
 * The rules on offer, including every mechanical one from the usual list of
 * "make it more accurate" advice, so they can be checked rather than argued
 * about.
 */
export const RULES: { key: string; name: string; blurb: string; rule: Rule }[] = [
  {
    key: 'random',
    name: 'Coin flip (control)',
    blurb: 'Backs a side at random. The line every other rule has to beat.',
    rule: (s) => (s.closes.length % 2 === 0 ? 'up' : 'down'),
  },
  {
    key: 'favourite',
    name: 'Always the favourite',
    blurb: 'Backs whichever side is ahead. High win rate, and that is the trap.',
    rule: (s) => (s.quoted >= 0.5 ? 'up' : 'down'),
  },
  {
    key: 'underdog',
    name: 'Always the underdog',
    blurb: 'Backs the long shot every time.',
    rule: (s) => (s.quoted < 0.5 ? 'up' : 'down'),
  },
  {
    key: 'multiframe',
    name: 'Multi-timeframe agreement',
    blurb:
      'Backs the short-term direction only when the three longer lookbacks agree with it.',
    rule: (s) => {
      if (s.closes.length < 200) return null;
      const d = direction(s.closes, 10);
      if (d === 0) return null;
      const agree = [30, 90, 180].every((b) => direction(s.closes, b) === d);
      return agree ? (d > 0 ? 'up' : 'down') : null;
    },
  },
  {
    key: 'rsi',
    name: 'RSI extremes (mean reversion)',
    blurb: 'Backs against the move when RSI(14) is past 70 or under 30.',
    rule: (s) => {
      if (s.closes.length < 60) return null;
      const r = rsi(s.closes.filter((_, i) => i % 4 === 0));
      if (r > 70) return 'down';
      if (r < 30) return 'up';
      return null;
    },
  },
  {
    key: 'macd',
    name: 'MACD crossover',
    blurb: 'Backs the side the MACD line is on relative to its signal.',
    rule: (s) => {
      if (s.closes.length < 200) return null;
      const bars = s.closes.filter((_, i) => i % 4 === 0);
      const fast = emaOf(bars, 12);
      const slow = emaOf(bars, 26);
      if (fast === null || slow === null) return null;
      return fast > slow ? 'up' : 'down';
    },
  },
  {
    key: 'bollinger',
    name: 'Bollinger band reversion',
    blurb: 'Backs a return to the middle when price is outside the bands.',
    rule: (s) => {
      if (s.closes.length < 120) return null;
      const bars = s.closes.filter((_, i) => i % 4 === 0).slice(-20);
      const m = mean(bars);
      const sd = Math.sqrt(mean(bars.map((b) => (b - m) ** 2)));
      if (!(sd > 0)) return null;
      const z = (s.price - m) / (2 * sd);
      if (z > 1) return 'down';
      if (z < -1) return 'up';
      return null;
    },
  },
  {
    key: 'tail',
    name: 'Long shots only (7x and out)',
    blurb: 'Backs the underdog only when it pays more than 7x — the least-bad band.',
    rule: (s) => {
      const under = Math.min(s.quoted, 1 - s.quoted);
      if (multiplierFor(under) < 7) return null;
      return s.quoted < 0.5 ? 'up' : 'down';
    },
  },
  {
    key: 'lateTail',
    name: 'Long shots, late only',
    blurb:
      'The same long shots, but only inside the last 45 seconds — where the ' +
      'quote is furthest from the truth.',
    rule: (s) => {
      if (s.msLeft > 45_000) return null;
      const under = Math.min(s.quoted, 1 - s.quoted);
      if (under < 0.01 || multiplierFor(under) < 6) return null;
      return s.quoted < 0.5 ? 'up' : 'down';
    },
  },
  {
    key: 'lateEarly',
    name: 'The same long shots, early only',
    blurb:
      'The control for the one above: identical prices, taken with more than ' +
      'four minutes left instead.',
    rule: (s) => {
      if (s.msLeft < 240_000) return null;
      const under = Math.min(s.quoted, 1 - s.quoted);
      if (under < 0.01 || multiplierFor(under) < 6) return null;
      return s.quoted < 0.5 ? 'up' : 'down';
    },
  },
  {
    key: 'hunter',
    name: 'The gold edge hunter, patient',
    blurb:
      'Backs exactly what the gold light picks at its most selective — only ' +
      'prices the calibration says actually make money.',
    rule: (s) => {
      const pick = findEdge({
        pUp: s.quoted,
        balance: 1_000,
        aggression: 0,
        tradable: true,
        secondsLeft: s.msLeft / 1_000,
        volRatio: volRatioOf(s.vol, VOL_PRESETS.normal),
      });
      return pick ? pick.side : null;
    },
  },
  {
    key: 'hunterWide',
    name: 'The gold edge hunter, wide open',
    blurb:
      'The same hunter with the slider all the way up, which buys far more ' +
      'signals at far worse prices. The control for the one above.',
    rule: (s) => {
      const pick = findEdge({
        pUp: s.quoted,
        balance: 1_000,
        aggression: 1,
        tradable: true,
        secondsLeft: s.msLeft / 1_000,
        volRatio: volRatioOf(s.vol, VOL_PRESETS.normal),
      });
      return pick ? pick.side : null;
    },
  },
  {
    key: 'subPenny',
    name: 'Long shots priced under 1%',
    blurb:
      'Below 1% the payout stops improving but the odds keep getting worse. ' +
      'Here to show what that costs.',
    rule: (s) => {
      const under = Math.min(s.quoted, 1 - s.quoted);
      if (under >= 0.01) return null;
      return s.quoted < 0.5 ? 'up' : 'down';
    },
  },
];

/**
 * Runs every rule over the same independent rounds, at most one bet each per
 * round, so no two of a rule's results share an outcome and its interval means
 * what it says.
 *
 * Every rule sees the *same* tape. That is worth more than it costs: the tape
 * is by far the expensive part, so sharing it runs eight rules for the price of
 * one, and it makes the comparison between two rules paired rather than two
 * separate draws — if one beats another here, it is not because it happened to
 * get luckier rounds.
 */
export function backtestAll(
  entries: { name: string; rule: Rule }[],
  rounds = 4_000,
  seedBase = 991,
  onProgress?: (done: number, total: number) => void,
): StrategyResult[] {
  const results: { won: boolean; multiplier: number }[][] = entries.map(() => []);
  const placed: ({ side: Side; multiplier: number } | null)[] = entries.map(() => null);

  for (let r = 0; r < rounds; r++) {
    const engine = new PriceEngine({
      seed: (r * 2246822519 + seedBase) >>> 0,
      startPrice: 78_000,
      annualVol: VOL_PRESETS.normal,
    });
    const strike = engine.price;
    const closes: number[] = [];
    // One decision moment per round, and the clock reading at that moment is
    // drawn log-uniformly rather than uniformly.
    //
    // Uniform sampling spends 95% of its looks in the first fourteen minutes
    // and visits the closing seconds almost never — a rule that only trades
    // there got 3 bets in 1,000 rounds, which is not a measurement. Time left
    // is what the quote's error depends on, and it spans two and a half orders
    // of magnitude, so it is sampled on the scale it varies over. The draw
    // does not look at the price, and every rule is offered the same moment,
    // so this changes which questions get answered, not the answers.
    const u = ((r * 7919) % 10_007) / 10_007;
    const msLeft0 = LOCK_MS * Math.pow((ROUND_MS - 60_000) / LOCK_MS, u);
    const at = ROUND_MS - msLeft0;
    placed.fill(null);
    let decided = false;

    let nextClose = CLOSE_MS;
    for (let t = STEP_MS; t <= ROUND_MS; t += STEP_MS) {
      const price = engine.step(STEP_MS);
      if (t < nextClose) continue;
      nextClose += CLOSE_MS;
      closes.push(price);
      if (!decided && t >= at) {
        const msLeft = ROUND_MS - t;
        if (msLeft < LOCK_MS) continue;
        decided = true;
        const quoted = probUp(price, strike, engine.vol, msLeft);
        const snapshot: Snapshot = {
          closes,
          price,
          strike,
          quoted,
          multiplier: multiplierFor(quoted),
          msLeft,
          vol: engine.vol,
        };
        for (let i = 0; i < entries.length; i++) {
          const side = entries[i].rule(snapshot);
          // A rule that declines here gets no second look this round.
          if (!side) continue;
          const p = side === 'up' ? quoted : 1 - quoted;
          placed[i] = { side, multiplier: multiplierFor(p) };
        }
      }
    }
    const finishedUp = engine.price > strike;
    for (let i = 0; i < entries.length; i++) {
      const bet = placed[i];
      if (!bet) continue;
      results[i].push({ won: (bet.side === 'up') === finishedUp, multiplier: bet.multiplier });
    }
    if (onProgress && (r & 255) === 0) onProgress(r, rounds);
  }
  if (onProgress) onProgress(rounds, rounds);

  return entries.map((e, i) =>
    summarise(e.name, results[i], Math.floor(results[i].length / 2)),
  );
}

/** One rule, same thing. Kept because a single rule is what a test asks about. */
export function backtest(
  rule: Rule,
  name: string,
  rounds = 4_000,
  seedBase = 991,
): StrategyResult {
  return backtestAll([{ name, rule }], rounds, seedBase)[0];
}

/** Turns a run of settled bets into the numbers worth reading. */
export function summarise(
  name: string,
  results: { won: boolean; multiplier: number }[],
  holdoutFrom: number,
): StrategyResult {
  const n = results.length;
  if (n === 0) {
    return {
      name, bets: 0, wins: 0, winRate: 0, ev: 0, ci: 0, profitFactor: 0,
      maxDrawdown: 0, holdoutEv: 0, holdoutBets: 0, averagePayout: 0,
    };
  }

  let wins = 0;
  let returned = 0;
  let gross = 0;
  let lost = 0;
  let bank = 0;
  let peak = 0;
  let worst = 0;
  let payout = 0;

  for (const r of results) {
    payout += r.multiplier;
    if (r.won) {
      wins += 1;
      returned += r.multiplier;
      gross += r.multiplier - 1;
      bank += r.multiplier - 1;
    } else {
      lost += 1;
      bank -= 1;
    }
    peak = Math.max(peak, bank);
    // Measured against the peak plus the stake actually risked to reach it,
    // so the first loss of a run is not an infinite drawdown.
    worst = Math.max(worst, (peak - bank) / Math.max(peak + n * 0.02, 1));
  }

  const rate = wins / n;
  const ev = returned / n - 1;
  const avg = payout / n;
  const ci = 1.96 * avg * Math.sqrt((rate * (1 - rate)) / n);

  const held = results.slice(holdoutFrom);
  const heldReturn = held.reduce((a, r) => a + (r.won ? r.multiplier : 0), 0);

  return {
    name,
    bets: n,
    wins,
    winRate: rate,
    ev,
    ci,
    profitFactor: lost > 0 ? gross / lost : gross > 0 ? Infinity : 0,
    maxDrawdown: worst,
    holdoutEv: held.length > 0 ? heldReturn / held.length - 1 : 0,
    holdoutBets: held.length,
    averagePayout: avg,
  };
}
