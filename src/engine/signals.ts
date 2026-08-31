import type { Candle } from './types';

/**
 * UT Bot Alerts, with a DEMA overlay — the pair used on the TradingView
 * layout this mirrors.
 *
 * UT Bot is an ATR trailing stop: the stop ratchets in the direction of the
 * trend and never loosens, and a signal fires on the bar where price crosses
 * it. `keyValue` scales how far the stop sits from price (bigger = less
 * sensitive), `atrPeriod` is the ATR length.
 */

export interface SignalConfig {
  /** "Key Value" — the ATR multiple the stop trails by. */
  keyValue: number;
  atrPeriod: number;
  /** Period for the DEMA drawn over the candles. */
  demaPeriod: number;
}

export const SIGNAL_RULES: SignalConfig = {
  keyValue: 1,
  atrPeriod: 10,
  demaPeriod: 9,
};

export interface Signal {
  /** Bucket time of the bar the signal belongs to. */
  t: number;
  side: 'buy' | 'sell';
  price: number;
}

export interface SignalState {
  /** Which side of the trailing stop price is currently on. */
  bias: 'long' | 'short' | null;
  /** Where the stop sits right now. */
  stop: number | null;
  /** Distance from the last close to the stop, in price. */
  distance: number | null;
  /** The most recent confirmed signal, if any. */
  last: Signal | null;
  /** Bars since that signal. */
  barsSince: number | null;
}

export interface SignalResult {
  signals: Signal[];
  /** The ATR trailing stop, aligned to the input candles. */
  trail: (number | null)[];
  /** The DEMA overlay, aligned to the input candles. */
  dema: (number | null)[];
  /** A plain-language snapshot of where the indicator stands. */
  state: SignalState;
}

/**
 * Exponential moving average, seeded with the simple average of the first
 * `period` values. One value per input, null until the window fills.
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
 * Double EMA: 2 * EMA(n) - EMA(EMA(n), n). It tracks price more closely than
 * a plain EMA by subtracting most of the lag the second pass measures.
 */
export function dema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const first = ema(values, period);

  // The second pass runs over the first's output, which starts partway in.
  const start = first.findIndex((v) => v !== null);
  if (start < 0) return out;
  const inner = first.slice(start) as number[];
  const second = ema(inner, period);

  for (let i = 0; i < second.length; i++) {
    const a = inner[i];
    const b = second[i];
    if (b === null) continue;
    out[start + i] = 2 * a - b;
  }
  return out;
}

/** True range: the widest of today's span and the gaps from yesterday's close. */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  });
}

/**
 * Average true range using Wilder's smoothing, which is what TradingView's
 * `atr()` uses: seed with the mean of the first `period` ranges, then each
 * new average keeps (period - 1) parts of the old one.
 */
export function atr(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period) return out;

  const tr = trueRange(candles);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** How many closed bars are needed before anything can fire. */
export function minimumBars(config: SignalConfig = SIGNAL_RULES): number {
  return Math.max(config.atrPeriod, config.demaPeriod * 2) + 2;
}

/**
 * The UT Bot trailing stop and its crossings.
 *
 * The stop only ever tightens while price stays on one side of it: above the
 * stop it ratchets up to `price - keyValue * ATR` and never back down; below,
 * it ratchets down. When price closes through it, the stop flips to the other
 * side and that bar is the signal.
 */
export function computeSignals(
  candles: Candle[],
  config: SignalConfig = SIGNAL_RULES,
): SignalResult {
  // A forming bar's close moves with every tick, so a marker on it would
  // appear and vanish as price wobbles. Only closed bars are considered.
  const closed = candles.filter((c) => !c.live);
  const emptyState: SignalState = {
    bias: null,
    stop: null,
    distance: null,
    last: null,
    barsSince: null,
  };
  const empty: SignalResult = { signals: [], trail: [], dema: [], state: emptyState };
  if (closed.length < minimumBars(config)) return empty;

  const src = closed.map((c) => c.close);
  const ranges = atr(closed, config.atrPeriod);
  const demaLine = dema(src, config.demaPeriod);

  const trail: (number | null)[] = new Array(closed.length).fill(null);
  const signals: Signal[] = [];

  let prevStop = 0;
  let started = false;

  for (let i = 0; i < closed.length; i++) {
    const nLoss = ranges[i] === null ? null : config.keyValue * (ranges[i] as number);
    if (nLoss === null) continue;

    const price = src[i];
    const prevPrice = i > 0 ? src[i - 1] : price;

    let stop: number;
    if (price > prevStop && prevPrice > prevStop) {
      // Both bars above: ratchet the stop up, never down.
      stop = Math.max(prevStop, price - nLoss);
    } else if (price < prevStop && prevPrice < prevStop) {
      // Both bars below: ratchet it down, never up.
      stop = Math.min(prevStop, price + nLoss);
    } else {
      // Price has crossed; the stop flips to the other side.
      stop = price > prevStop ? price - nLoss : price + nLoss;
    }
    trail[i] = stop;

    if (started) {
      const crossedUp = prevPrice <= prevStop && price > stop;
      const crossedDown = prevPrice >= prevStop && price < stop;
      if (price > stop && crossedUp) {
        signals.push({ t: closed[i].t, side: 'buy', price });
      } else if (price < stop && crossedDown) {
        signals.push({ t: closed[i].t, side: 'sell', price });
      }
    }

    prevStop = stop;
    started = true;
  }

  const lastClose = src[src.length - 1];
  const lastStop = trail[trail.length - 1];
  const last = signals.length ? signals[signals.length - 1] : null;
  const lastIndex = last ? closed.findIndex((c) => c.t === last.t) : -1;

  return {
    signals,
    trail,
    dema: demaLine,
    state: {
      bias: lastStop === null ? null : lastClose > lastStop ? 'long' : 'short',
      stop: lastStop,
      distance: lastStop === null ? null : lastClose - lastStop,
      last,
      barsSince: lastIndex >= 0 ? closed.length - 1 - lastIndex : null,
    },
  };
}
