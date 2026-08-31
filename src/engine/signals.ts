import type { Candle } from './types';

/**
 * Buy / sell markers for the candle chart.
 *
 * These rules are a stated default, not a copy of any particular system:
 * a fast/slow EMA crossover for direction, filtered by RSI so the marker does
 * not fire into an already-exhausted move. Swap `SIGNAL_RULES` to change what
 * fires; everything downstream reads from it.
 */

export interface SignalConfig {
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  /** Do not call a buy when RSI is already above this. */
  overbought: number;
  /** Do not call a sell when RSI is already below this. */
  oversold: number;
}

export const SIGNAL_RULES: SignalConfig = {
  fastPeriod: 5,
  slowPeriod: 13,
  rsiPeriod: 9,
  overbought: 72,
  oversold: 28,
};

export interface Signal {
  /** Bucket time of the bar the signal belongs to. */
  t: number;
  side: 'buy' | 'sell';
  price: number;
  rsi: number;
}

/**
 * Exponential moving average, seeded with the simple average of the first
 * `period` values so early output is not dragged by a single price.
 * Returns one value per input, with nulls until the window fills.
 */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's RSI: the original smoothing, where each new average carries
 * (period - 1) parts of the old one. Returns one value per input, with nulls
 * until enough changes have accumulated.
 */
export function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** How many closed bars are needed before anything can fire. */
export function minimumBars(config: SignalConfig = SIGNAL_RULES): number {
  return Math.max(config.slowPeriod, config.rsiPeriod + 1) + 1;
}

/**
 * Signals for a series of candles.
 *
 * Only closed bars are considered. A still-forming bar's close moves with
 * every tick, so a marker drawn on it would appear and vanish as the price
 * wobbles — the repainting that makes a chart untrustworthy.
 */
export function computeSignals(
  candles: Candle[],
  config: SignalConfig = SIGNAL_RULES,
): Signal[] {
  const closed = candles.filter((c) => !c.live);
  if (closed.length < minimumBars(config)) return [];

  const closes = closed.map((c) => c.close);
  const fast = ema(closes, config.fastPeriod);
  const slow = ema(closes, config.slowPeriod);
  const strength = rsi(closes, config.rsiPeriod);

  const out: Signal[] = [];
  for (let i = 1; i < closed.length; i++) {
    const f = fast[i];
    const s = slow[i];
    const pf = fast[i - 1];
    const ps = slow[i - 1];
    const r = strength[i];
    if (f === null || s === null || pf === null || ps === null || r === null) continue;

    const crossedUp = pf <= ps && f > s;
    const crossedDown = pf >= ps && f < s;

    if (crossedUp && r < config.overbought) {
      out.push({ t: closed[i].t, side: 'buy', price: closed[i].close, rsi: r });
    } else if (crossedDown && r > config.oversold) {
      out.push({ t: closed[i].t, side: 'sell', price: closed[i].close, rsi: r });
    }
  }
  return out;
}
