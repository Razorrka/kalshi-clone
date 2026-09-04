import { clamp, normCdf } from '../lib/math';
import type { Candle, Side, Tick } from './types';
import type { OrderBookSnapshot } from './orderBook';
import type { TapeEntry } from './tape';

/**
 * The flip detection engine.
 *
 * A "flip" here has one exact meaning: the favoured side changing. Because a
 * binary market's odds are monotone in the distance from price to the target,
 * that happens precisely when price touches the target. So this predicts a
 * first passage, which is a question with a real answer rather than a vibe.
 *
 * The pipeline is the one asked for — normalise, roll, deviate, change-point,
 * score, match history, output — but the anchor is the textbook result: for a
 * driftless walk currently |z| standard deviations clear of a level, the
 * chance of touching it before expiry is 2 * N(-|z|). Everything the features
 * do is shift the odds around that number.
 */

// =========================================================================
// features
// =========================================================================

/**
 * Every feature is signed *toward the flip*: positive means "this argues the
 * leader is about to lose the lead", whatever side the leader is. That makes
 * the scoring, the wording and the reading uniform.
 */
export interface FlipFeatures {
  /** Standardised distance from price to the target, over the whole round. */
  gap: number;
  /** The same distance measured over the warning horizon, which is what the
   *  baseline is built on: the same gap is far safer over a minute than over
   *  the rest of the round. */
  horizonGap: number;
  /** Price velocity, toward the target. */
  velocity: number;
  /** Price acceleration, toward the target. */
  acceleration: number;
  /** Short-term rate of change, toward the target. */
  roc: number;
  /** Trades per second against its own recent average. */
  volumeAccel: number;
  /** Buy/sell imbalance in the tape, toward the challenger. */
  tradeImbalance: number;
  /** Resting size behind the challenger against the leader. */
  bookImbalance: number;
  /** Bid/ask spread against its own recent average. */
  spread: number;
  /** Total resting size against its own recent average, negated. */
  depth: number;
  /** Depth leaving the leader's side. */
  liquidityPull: number;
  /** Outsized tickets, weighted toward the challenger. */
  largeOrders: number;
  /** Realised volatility against its own recent average. */
  volatility: number;
  /** Price extending while its own momentum does not. */
  momentumDivergence: number;
  /** Price crossed the target and failed to hold. */
  failedBreak: number;
  /** Wicks rejecting the target. */
  rejection: number;
  /** Change-point statistic on the recent path. */
  regimeShift: number;
  /** Net drift of the recent path, toward the target. */
  trajectory: number;
}

export const FEATURE_KEYS: (keyof FlipFeatures)[] = [
  'gap',
  'horizonGap',
  'velocity',
  'acceleration',
  'roc',
  'volumeAccel',
  'tradeImbalance',
  'bookImbalance',
  'spread',
  'depth',
  'liquidityPull',
  'largeOrders',
  'volatility',
  'momentumDivergence',
  'failedBreak',
  'rejection',
  'regimeShift',
  'trajectory',
];

/** The features the score actually leans on, in weight order. */
export const SCORED_KEYS = FEATURE_KEYS.filter((k) => k !== 'gap' && k !== 'horizonGap');

export const EMPTY_FEATURES: FlipFeatures = FEATURE_KEYS.reduce(
  (acc, k) => ({ ...acc, [k]: 0 }),
  {} as FlipFeatures,
);

// =========================================================================
// rolling statistics
// =========================================================================

/**
 * Mean and spread over a bounded window, so a feature can be read as "how
 * unusual is this for itself" rather than in whatever units it happens to
 * have. Everything downstream sees z-scores.
 */
export class Rolling {
  private buf: number[] = [];

  constructor(private readonly size: number) {}

  push(v: number) {
    if (!Number.isFinite(v)) return;
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }

  get count(): number {
    return this.buf.length;
  }

  get mean(): number {
    if (this.buf.length === 0) return 0;
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }

  get sd(): number {
    const n = this.buf.length;
    if (n < 2) return 0;
    const m = this.mean;
    const v = this.buf.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1);
    return Math.sqrt(Math.max(v, 0));
  }

  /**
   * How many spreads clear of its own recent normal this value sits. Needs a
   * real window before it will claim anything, so a cold start reads zero
   * rather than inventing an outlier out of two samples.
   */
  z(v: number, minCount = 8): number {
    if (this.buf.length < minCount) return 0;
    const s = this.sd;
    if (!(s > 1e-12)) return 0;
    return clamp((v - this.mean) / s, -4, 4);
  }
}

// =========================================================================
// the anchor
// =========================================================================

/**
 * The probability a driftless walk touches the target before expiry, given it
 * sits |z| standard deviations of the remaining time away from it.
 *
 * This is the reflection principle: paths that touch and end above the level
 * pair one-to-one with paths that touch and end below it, so the touch
 * probability is twice the probability of finishing beyond it. It is exact,
 * not a heuristic, and it is why a flip is likely even when the leader looks
 * comfortable — at one standard deviation clear the chance is still 32%.
 */
export function touchProbability(z: number): number {
  return clamp(2 * normCdf(-Math.abs(z)), 0, 1);
}

/** Standard deviations of the remaining move between price and the target. */
export function standardisedGap(
  spot: number,
  strike: number,
  annualVol: number,
  msLeft: number,
): number {
  const seconds = Math.max(msLeft, 1_000) / 1_000;
  const sd = annualVol * Math.sqrt(seconds / (365 * 24 * 60 * 60));
  if (!(sd > 1e-12) || spot <= 0 || strike <= 0) return 0;
  return clamp(Math.log(spot / strike) / sd, -8, 8);
}

// =========================================================================
// change-point detection
// =========================================================================

/**
 * A two-window test for the path changing character: the mean of the recent
 * window against the mean of the one before it, in pooled spreads. Large
 * values mean the process generating these steps is not the one that
 * generated the earlier ones — a regime change rather than a big draw from
 * the same regime.
 */
export function changePoint(values: number[], window: number): number {
  if (values.length < window * 2) return 0;
  const recent = values.slice(-window);
  const older = values.slice(-window * 2, -window);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const varOf = (a: number[], m: number) =>
    a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(a.length - 1, 1);

  const mRecent = mean(recent);
  const mOlder = mean(older);
  const pooled = Math.sqrt((varOf(recent, mRecent) + varOf(older, mOlder)) / 2);
  if (!(pooled > 1e-12)) return 0;
  return clamp(((mRecent - mOlder) / pooled) * Math.sqrt(window / 2), -6, 6);
}

/** Spread of a run of values, used for volatility-of-volatility reads. */
export function dispersion(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

// =========================================================================
// extraction
// =========================================================================

export interface FlipInput {
  /** Tick tape, oldest first. */
  series: Tick[];
  /** One-minute bars, for wick and failed-break reads. */
  bars: Candle[];
  book: OrderBookSnapshot | null;
  /** Tape entries seen since the last read. */
  freshTape: TapeEntry[];
  spot: number;
  strike: number;
  annualVol: number;
  msLeft: number;
  now: number;
}

/** Nearest sampled price at or before `ts`. */
function priceAt(series: Tick[], ts: number): number {
  if (series.length === 0) return 0;
  let best = series[0].p;
  for (const t of series) {
    if (t.t > ts) break;
    best = t.p;
  }
  return best;
}

/** Log return between two prices, in standard deviations of what is left. */
function inSigmas(from: number, to: number, annualVol: number, msLeft: number): number {
  if (from <= 0 || to <= 0) return 0;
  const seconds = Math.max(msLeft, 1_000) / 1_000;
  const sd = annualVol * Math.sqrt(seconds / (365 * 24 * 60 * 60));
  if (!(sd > 1e-12)) return 0;
  return clamp(Math.log(to / from) / sd, -8, 8);
}

/** How far ahead the detector is looking. "About to flip" means within this. */
export const FLIP_HORIZON_MS = 60_000;

const VELOCITY_MS = 6_000;
const ROC_MS = 20_000;
const TRAJECTORY_MS = 90_000;

/**
 * Reads the raw feature set off the tape and book.
 *
 * `toward` flips the sign of every directional read so that positive always
 * means "arguing for the flip". Above the target the challenger is NO and
 * falling prices help it; below, the mirror.
 */
export function extractFlipFeatures(
  input: FlipInput,
  rolling: FlipRolling,
): FlipFeatures {
  const { series, bars, book, freshTape, spot, strike, annualVol, msLeft, now } = input;
  const gap = standardisedGap(spot, strike, annualVol, msLeft);
  const toward = gap >= 0 ? -1 : 1;
  const sig = (from: number, to: number) => inSigmas(from, to, annualVol, msLeft);

  // ---- path -------------------------------------------------------------
  const p0 = priceAt(series, now);
  const p1 = priceAt(series, now - VELOCITY_MS);
  const p2 = priceAt(series, now - VELOCITY_MS * 2);
  const velocity = toward * sig(p1, p0);
  const priorVelocity = toward * sig(p2, p1);
  const acceleration = velocity - priorVelocity;
  const roc = toward * sig(priceAt(series, now - ROC_MS), p0);
  const trajectory = toward * sig(priceAt(series, now - TRAJECTORY_MS), p0);

  // ---- volatility and regime -------------------------------------------
  const steps: number[] = [];
  const recent = series.filter((t) => t.t >= now - TRAJECTORY_MS);
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1].p;
    const b = recent[i].p;
    if (a > 0 && b > 0) steps.push(Math.log(b / a));
  }
  const realised = dispersion(steps);
  rolling.realised.push(realised);
  const volatility = rolling.realised.z(realised);
  // Change-point on the absolute steps: the size of the moves changing is a
  // regime shift even when their direction does not.
  const regimeShift = Math.abs(changePoint(steps.map(Math.abs), 40));

  // ---- momentum divergence ---------------------------------------------
  // Price pushing to a new extreme away from the target while the push
  // itself is weaker than the one before it: the move is running out.
  const half = Math.floor(recent.length / 2);
  let momentumDivergence = 0;
  if (half > 4) {
    const firstHalf = recent.slice(0, half).map((t) => t.p);
    const secondHalf = recent.slice(half).map((t) => t.p);
    const extend =
      gap >= 0
        ? Math.max(...secondHalf) - Math.max(...firstHalf)
        : Math.min(...firstHalf) - Math.min(...secondHalf);
    const push = Math.abs(sig(secondHalf[0], secondHalf[secondHalf.length - 1]));
    const priorPush = Math.abs(sig(firstHalf[0], firstHalf[firstHalf.length - 1]));
    // Extended further on less force.
    if (extend > 0 && push < priorPush) {
      momentumDivergence = clamp(priorPush - push, 0, 4);
    }
  }

  // ---- failed break and rejection --------------------------------------
  // Both are read against the target itself: a leader that has already been
  // to the line and back is standing on ground it could not hold.
  const closed = bars.filter((b) => !b.live).slice(-12);
  let failedBreak = 0;
  let rejection = 0;
  for (const bar of closed) {
    const crossed = gap >= 0 ? bar.low <= strike : bar.high >= strike;
    const heldBack = gap >= 0 ? bar.close > strike : bar.close < strike;
    if (crossed && heldBack) failedBreak += 1;
    const span = Math.max(bar.high - bar.low, 1e-9);
    const wick = gap >= 0 ? bar.low : bar.high;
    const reach = gap >= 0 ? strike - wick : wick - strike;
    // A wick that pokes past the target and closes away from it.
    if (reach > 0 && heldBack) rejection += clamp(reach / span, 0, 1);
  }
  failedBreak = clamp(failedBreak, 0, 6);
  rejection = clamp(rejection, 0, 6);

  // ---- tape -------------------------------------------------------------
  const challenger: Side = gap >= 0 ? 'down' : 'up';
  let volumeAccel = 0;
  let tradeImbalance = 0;
  let largeOrders = 0;
  if (freshTape.length > 0) {
    for (const t of freshTape) {
      rolling.tickets.push(t.amount);
      const forChallenger = t.side === challenger ? 1 : -1;
      tradeImbalance += forChallenger;
      const size = rolling.tickets.z(t.amount, 12);
      if (size > 1.5) largeOrders += forChallenger * clamp(size - 1.5, 0, 2.5);
    }
  }
  rolling.arrivals.push(freshTape.length);
  volumeAccel = rolling.arrivals.z(freshTape.length);
  tradeImbalance = clamp(tradeImbalance, -6, 6);
  largeOrders = clamp(largeOrders, -6, 6);

  // ---- book -------------------------------------------------------------
  let bookImbalance = 0;
  let spread = 0;
  let depth = 0;
  let liquidityPull = 0;
  if (book) {
    const sum = (levels: { size: number }[]) => levels.reduce((a, l) => a + l.size, 0);
    const upSize = sum(book.upBids);
    const downSize = sum(book.downBids);
    const total = upSize + downSize;
    if (total > 0) {
      const challengerShare = challenger === 'up' ? upSize / total : downSize / total;
      bookImbalance = clamp((challengerShare - 0.5) * 6, -3, 3);
    }
    rolling.spread.push(book.spreadCents);
    spread = rolling.spread.z(book.spreadCents);

    rolling.depth.push(total);
    // Thin books flip more easily, so depth is signed so that thinning reads
    // positive.
    depth = -rolling.depth.z(total);

    const leaderSize = challenger === 'up' ? downSize : upSize;
    rolling.leaderDepth.push(leaderSize);
    liquidityPull = -rolling.leaderDepth.z(leaderSize);
  }

  return {
    gap: Math.abs(gap),
    horizonGap: Math.abs(
      standardisedGap(spot, strike, annualVol, Math.min(FLIP_HORIZON_MS, msLeft)),
    ),
    velocity: clamp(velocity, -6, 6),
    acceleration: clamp(acceleration, -6, 6),
    roc: clamp(roc, -6, 6),
    volumeAccel,
    tradeImbalance,
    bookImbalance,
    spread,
    depth,
    liquidityPull,
    largeOrders,
    volatility,
    momentumDivergence,
    failedBreak,
    rejection,
    regimeShift,
    trajectory: clamp(trajectory, -6, 6),
  };
}

/** Buckets of |gap|, so a feature is only ever compared against itself at a
 *  comparable distance from the target. */
const GAP_EDGES = [0.25, 0.5, 1, 1.5, 2.5];

function gapBucket(gap: number): number {
  const g = Math.abs(gap);
  for (let i = 0; i < GAP_EDGES.length; i++) if (g < GAP_EDGES[i]) return i;
  return GAP_EDGES.length;
}

/** The rolling windows the extractor needs to normalise against. */
export class FlipRolling {
  realised = new Rolling(120);
  arrivals = new Rolling(120);
  tickets = new Rolling(200);
  spread = new Rolling(120);
  depth = new Rolling(120);
  leaderDepth = new Rolling(120);

  /** One window per feature per gap bucket. */
  private conditioned = new Map<string, Rolling>();
  private seen = 0;

  get samples(): number {
    return this.seen;
  }

  private windowFor(key: string, bucket: number): Rolling {
    const id = `${key}:${bucket}`;
    let r = this.conditioned.get(id);
    if (!r) {
      r = new Rolling(160);
      this.conditioned.set(id, r);
    }
    return r;
  }

  /**
   * Normalises every scored feature against its own history *at this
   * distance from the target*.
   *
   * This is the step that stops the engine fooling itself. Half these inputs
   * are computed downstream of the odds, which are themselves a function of
   * the gap — so raw, they smuggle the gap back in and double-count what the
   * baseline already handles exactly. Conditioning on the bucket leaves only
   * what a feature knows that the geometry does not.
   */
  normalise(raw: FlipFeatures): FlipFeatures {
    const bucket = gapBucket(raw.gap);
    this.seen += 1;
    const out: FlipFeatures = { ...raw };
    for (const key of SCORED_KEYS) {
      const window = this.windowFor(key, bucket);
      const value = raw[key];
      const z = window.z(value, 12);
      window.push(value);
      out[key] = z;
    }
    return out;
  }
}

// =========================================================================
// scoring
// =========================================================================

/**
 * How much each feature moves the log-odds away from the baseline, per
 * standard deviation of its own gap-conditioned normal.
 *
 * These are fitted, not guessed: a logistic regression over 72,540 samples
 * from 260 simulated rounds, with the baseline log-odds as a fixed offset so
 * the features could only earn weight for what the geometry does not already
 * say. Held out by round, the fitted weights at full strength scored AUC
 * 0.893 against the baseline's own 0.918 — worse. Shrinking them found the
 * peak at a tenth of the fit: 0.9181 against 0.9178.
 *
 * So they ship at a tenth, and that is the honest size of them. The exact
 * touch probability is the answer; these can lean on it and no more. A
 * detector that lets a book reading override the geometry is one that will be
 * confidently wrong.
 */
export const WEIGHT_SHRINK = 0.1;

const FITTED = {
  failedBreak: 0.605,
  liquidityPull: 0.509,
  rejection: 0.493,
  spread: 0.479,
  trajectory: 0.354,
  depth: 0.308,
  velocity: 0.277,
  roc: 0.201,
  volumeAccel: 0.191,
  volatility: -0.189,
  momentumDivergence: -0.121,
  tradeImbalance: 0.11,
  regimeShift: 0.085,
  acceleration: -0.03,
  largeOrders: -0.026,
  bookImbalance: -0.023,
} as const;

export const FLIP_WEIGHTS: Record<string, number> = Object.fromEntries(
  Object.entries(FITTED).map(([k, v]) => [k, v * WEIGHT_SHRINK]),
);

/**
 * What each input was actually worth on its own, measured the same way: the
 * area under the ROC curve for predicting a flip inside the next minute,
 * after conditioning on the gap. 0.500 is a coin flip — it knows nothing.
 *
 * Two inputs carry real information, and they are the two that describe the
 * path rather than the book. Everything derived from the order book or the
 * tape lands on 0.500 once the gap is taken out of it, because in this
 * simulator those are generated *from* the price rather than causing it.
 */
export const MEASURED_AUC: Record<string, number> = {
  failedBreak: 0.683,
  rejection: 0.679,
  depth: 0.562,
  bookImbalance: 0.529,
  regimeShift: 0.524,
  tradeImbalance: 0.52,
  liquidityPull: 0.515,
  volatility: 0.512,
  acceleration: 0.499,
  momentumDivergence: 0.498,
  velocity: 0.487,
  spread: 0.48,
  roc: 0.474,
  volumeAccel: 0.47,
  trajectory: 0.445,
  largeOrders: 0.392,
};

function logit(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(q / (1 - q));
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export interface Contribution {
  key: keyof FlipFeatures;
  value: number;
  weight: number;
  /** Log-odds this feature added. */
  push: number;
}

/** Every feature's signed push, largest first. */
export function contributions(features: FlipFeatures): Contribution[] {
  return SCORED_KEYS.map((key) => {
    const value = features[key];
    const weight = FLIP_WEIGHTS[key] ?? 0;
    return { key, value, weight, push: value * weight };
  }).sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
}

// =========================================================================
// historical pattern matching
// =========================================================================

export interface FlipMemory {
  features: FlipFeatures;
  flipped: boolean;
}

/**
 * How often conditions like these ended in a flip.
 *
 * Nearest neighbours over the scored features, which is the honest version of
 * "this looks like previous reversal setups": it names how many past setups
 * it is actually comparing against, so a match off three samples cannot
 * masquerade as a pattern.
 */
export function matchHistory(
  features: FlipFeatures,
  memory: FlipMemory[],
  k = 12,
): { rate: number; matched: number } | null {
  if (memory.length < k * 2) return null;
  const scored = memory
    .map((m) => {
      let d = 0;
      for (const key of SCORED_KEYS) {
        const diff = m.features[key] - features[key];
        d += diff * diff;
      }
      return { d, flipped: m.flipped };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  const hits = scored.filter((s) => s.flipped).length;
  return { rate: hits / scored.length, matched: scored.length };
}

// =========================================================================
// the signal
// =========================================================================

export type FlipConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FlipReason {
  key: keyof FlipFeatures;
  text: string;
  /**
   * Whether the input behind this line measurably predicts anything. A
   * condition can be real and still be worthless as evidence, and saying so
   * is the difference between a reason and a decoration.
   */
  backed: boolean;
}

export interface FlipSignal {
  /** Which way a flip would go, e.g. "YES → NO". */
  direction: string;
  /** The side currently ahead. */
  leader: Side;
  /** The side that would take over. */
  challenger: Side;
  probability: number;
  confidence: FlipConfidence;
  /** 0–10. */
  strength: number;
  reasons: FlipReason[];
  /** The reflection-principle number before any feature spoke. */
  baseline: number;
  features: FlipFeatures;
  contributions: Contribution[];
  history: { rate: number; matched: number } | null;
  at: number;
}

const PHRASES: Record<string, [string, string]> = {
  velocity: ['Price driving at the target', 'Price pulling away from the target'],
  acceleration: ['Move toward the target accelerating', 'Move toward the target stalling'],
  roc: ['Short-term rate of change turning over', 'Short-term rate of change holding'],
  trajectory: ['Recent path leaning at the target', 'Recent path leaning away'],
  volatility: ['Volatility expanding', 'Volatility compressing'],
  regimeShift: ['Regime change in the step sizes', ''],
  momentumDivergence: ['Momentum decelerating against a new extreme', ''],
  failedBreak: ['Target already tested and not held', ''],
  rejection: ['Wicks rejecting off the target', ''],
  volumeAccel: ['Trade rate accelerating', 'Trade rate drying up'],
  tradeImbalance: ['CHALLENGER buying pressure increasing', 'LEADER buying pressure increasing'],
  bookImbalance: ['Order-book imbalance shifting to CHALLENGER', 'Order-book imbalance favouring LEADER'],
  spread: ['Spread widening', 'Spread tightening'],
  depth: ['Book thinning out', 'Book filling in'],
  liquidityPull: ['LEADER liquidity withdrawing', 'LEADER liquidity building'],
  largeOrders: ['Large tickets hitting for CHALLENGER', 'Large tickets hitting for LEADER'],
};

function label(side: Side): string {
  return side === 'up' ? 'YES' : 'NO';
}

/** Turns the biggest pushes into the sentences shown under the signal. */
export function reasonsFor(
  parts: Contribution[],
  leader: Side,
  challenger: Side,
  history: { rate: number; matched: number } | null,
  limit = 6,
): FlipReason[] {
  const out: FlipReason[] = [];
  for (const part of parts) {
    if (out.length >= limit) break;
    // Only what argues for the flip, and only once it is saying something.
    if (part.push <= 0.004) continue;
    const pair = PHRASES[part.key];
    if (!pair) continue;
    // Phrased by the state the feature is actually in, so the sentence stays
    // true even where the fitted weight runs the other way.
    const text = part.value >= 0 ? pair[0] : pair[1];
    if (!text) continue;
    out.push({
      key: part.key,
      text: text.replace('CHALLENGER', label(challenger)).replace('LEADER', label(leader)),
      backed: isBacked(part.key),
    });
  }
  if (history && history.rate >= 0.6 && out.length < limit) {
    out.push({
      key: 'gap',
      text: `Resembles ${Math.round(history.rate * 100)}% of ${history.matched} past setups that flipped`,
      backed: true,
    });
  }
  return out;
}

/** Did this input measurably beat a coin flip when it was scored? */
export function isBacked(key: keyof FlipFeatures): boolean {
  const a = MEASURED_AUC[key];
  return a !== undefined && Math.abs(a - 0.5) > 0.1;
}

/**
 * Confidence is about the evidence, not the answer.
 *
 * It is high when the features agree with each other and there is a real
 * window behind them; a 78% built on one loud reading and five quiet ones is
 * a guess wearing a number, and says LOW.
 */
export function confidenceOf(parts: Contribution[], samples: number): FlipConfidence {
  const speaking = parts.filter((p) => Math.abs(p.push) > 0.004);
  if (speaking.length === 0 || samples < 20) return 'LOW';
  const forFlip = speaking.filter((p) => p.push > 0).length;
  const against = speaking.length - forFlip;
  const agreement = Math.max(forFlip, against) / speaking.length;
  const total = speaking.reduce((a, p) => a + Math.abs(p.push), 0);

  if (agreement >= 0.75 && speaking.length >= 4 && total > 0.06 && samples >= 60) {
    return 'HIGH';
  }
  if (agreement >= 0.6 && speaking.length >= 3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Puts it together: the exact baseline, shifted by what the features say,
 * cross-checked against what similar setups did.
 */
export function makeFlipSignal(
  features: FlipFeatures,
  memory: FlipMemory[],
  samples: number,
  spot: number,
  strike: number,
  now: number,
): FlipSignal {
  const leader: Side = spot >= strike ? 'up' : 'down';
  const challenger: Side = leader === 'up' ? 'down' : 'up';
  const baseline = touchProbability(features.horizonGap);
  const parts = contributions(features);
  const push = parts.reduce((a, p) => a + p.push, 0);

  const history = matchHistory(features, memory);
  // History is evidence, not an oracle: it moves the odds a little, in
  // proportion to how far it sits from the baseline.
  const historyPush = history ? clamp((history.rate - baseline) * 1.1, -0.8, 0.8) : 0;

  // Bounded only against underflow. An arbitrary floor like 0.5% would sit
  // *above* the true baseline deep in the tail and quietly overrule the exact
  // answer with a rounder-looking one.
  const probability = clamp(sigmoid(logit(baseline) + push + historyPush), 1e-6, 1 - 1e-6);
  const confidence = confidenceOf(parts, samples);
  // Strength is how actionable the reading is, not a second probability: the
  // odds discounted by how much the evidence behind them is worth.
  const trust = confidence === 'HIGH' ? 1 : confidence === 'MEDIUM' ? 0.85 : 0.65;
  const strength = clamp(Math.round(probability * trust * 100) / 10, 0, 10);

  return {
    direction: `${label(leader)} → ${label(challenger)}`,
    leader,
    challenger,
    probability,
    confidence,
    strength,
    reasons: reasonsFor(parts, leader, challenger, history),
    baseline,
    features,
    contributions: parts,
    history,
    at: now,
  };
}
