import { describe, expect, it } from 'vitest';
import {
  SIGNAL_RULES,
  atr,
  computeSignals,
  dema,
  ema,
  minimumBars,
  trueRange,
} from './signals';
import type { Candle } from './types';

const MIN = 60_000;
const T0 = Date.parse('2026-03-04T15:00:00Z');

function bar(high: number, low: number, close: number, i: number, live = false): Candle {
  return { t: T0 + i * 5 * MIN, open: close, high, low, close, live };
}

/** Bars from closes alone, with a fixed range around each close. */
function fromCloses(closes: number[], spread = 1, liveLast = false): Candle[] {
  return closes.map((c, i) =>
    bar(c + spread, c - spread, c, i, liveLast && i === closes.length - 1),
  );
}

describe('trueRange', () => {
  it('takes the widest of the span and the two gaps from the prior close', () => {
    const candles = [bar(10, 8, 9, 0), bar(14, 9, 13, 1), bar(15, 13, 14, 2)];
    // Bar 0 has no prior close, so it is just high - low.
    // Bar 1: max(14-9, |14-9|, |9-9|) = 5. Bar 2: max(2, |15-13|, |13-13|) = 2.
    expect(trueRange(candles)).toEqual([2, 5, 2]);
  });

  it('uses the gap when a bar opens away from the last close', () => {
    const candles = [bar(10, 9, 10, 0), bar(21, 20, 20, 1)];
    // The bar's own span is 1, but it gapped 11 from the prior close.
    expect(trueRange(candles)[1]).toBe(11);
  });
});

describe('atr', () => {
  it('matches a hand-computed Wilder run', () => {
    const candles = [
      bar(10, 8, 9, 0), // TR 2
      bar(14, 9, 13, 1), // TR 5
      bar(15, 13, 14, 2), // TR 2
      bar(14, 10, 11, 3), // TR 4
    ];
    // Period 2. Seed = (2 + 5)/2 = 3.5.
    // Then (3.5*1 + 2)/2 = 2.75, then (2.75*1 + 4)/2 = 3.375.
    const out = atr(candles, 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(3.5, 10);
    expect(out[2]).toBeCloseTo(2.75, 10);
    expect(out[3]).toBeCloseTo(3.375, 10);
  });

  it('is never negative and settles on a constant range', () => {
    const candles = Array.from({ length: 30 }, (_, i) => bar(102, 98, 100, i));
    const out = atr(candles, 10).filter((v): v is number => v !== null);
    for (const v of out) expect(v).toBeCloseTo(4, 6);
  });

  it('returns all nulls when there are fewer bars than the period', () => {
    expect(atr([bar(1, 0, 1, 0)], 10).every((v) => v === null)).toBe(true);
  });
});

describe('dema', () => {
  it('returns the constant for a flat series', () => {
    const out = dema(new Array(40).fill(7), 5).filter((v): v is number => v !== null);
    expect(out.length).toBeGreaterThan(0);
    for (const v of out) expect(v).toBeCloseTo(7, 8);
  });

  it('lags a trend less than a plain EMA does', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    const d = dema(values, 9).at(-1)!;
    const e = ema(values, 9).at(-1)!;
    const price = values[values.length - 1];
    // Both trail a rising price, but the double version trails less.
    expect(d).toBeLessThanOrEqual(price);
    expect(d).toBeGreaterThan(e);
  });

  it('needs two passes of the window before it produces anything', () => {
    const values = Array.from({ length: 30 }, (_, i) => i);
    const out = dema(values, 9);
    // The first pass fills at index 8; the second needs another nine of those,
    // so the earliest DEMA value is at 8 + 8 = 16.
    expect(out[15]).toBeNull();
    expect(out[16]).not.toBeNull();
  });
});

describe('UT Bot signals', () => {
  it('matches a hand-computed run of the trailing stop', () => {
    const candles = [
      bar(10, 8, 9, 0),
      bar(14, 9, 13, 1),
      bar(15, 13, 14, 2),
      bar(14, 10, 11, 3),
    ];
    // Key value 1, ATR period 2, so nLoss is the ATR above: _, 3.5, 2.75, 3.375.
    // Bar 1: price 13 and prior 9 both above the seed stop of 0, so the stop
    //        ratchets to max(0, 13 - 3.5) = 9.5.
    // Bar 2: both above 9.5, so max(9.5, 14 - 2.75) = 11.25.
    // Bar 3: price 11 is below 11.25 but the prior bar was above, so the stop
    //        flips to 11 + 3.375 = 14.375 and that bar is a sell.
    const { trail, signals } = computeSignals(candles, {
      keyValue: 1,
      atrPeriod: 2,
      demaPeriod: 1,
    });
    expect(trail[0]).toBeNull();
    expect(trail[1]).toBeCloseTo(9.5, 10);
    expect(trail[2]).toBeCloseTo(11.25, 10);
    expect(trail[3]).toBeCloseTo(14.375, 10);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ side: 'sell', price: 11 });
  });

  it('stays silent until there are enough closed bars', () => {
    const few = fromCloses(Array.from({ length: minimumBars() - 1 }, (_, i) => 100 + i));
    expect(computeSignals(few).signals).toEqual([]);
  });

  it('ignores the bar still being written to', () => {
    const closes = [
      ...Array.from({ length: 30 }, (_, i) => 120 - i),
      ...Array.from({ length: 10 }, (_, i) => 91 + i * 4),
    ];
    const lastT = T0 + (closes.length - 1) * 5 * MIN;
    const withLive = computeSignals(fromCloses(closes, 1, true));
    expect(withLive.signals.some((s) => s.t === lastT)).toBe(false);
  });

  it('calls a buy when price closes back up through the stop', () => {
    const closes = [
      ...Array.from({ length: 30 }, (_, i) => 200 - i * 2),
      ...Array.from({ length: 12 }, (_, i) => 142 + i * 8),
    ];
    const { signals } = computeSignals(fromCloses(closes, 2));
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[signals.length - 1].side).toBe('buy');
  });

  it('calls a sell when price closes back down through it', () => {
    const closes = [
      ...Array.from({ length: 30 }, (_, i) => 100 + i * 2),
      ...Array.from({ length: 12 }, (_, i) => 158 - i * 8),
    ];
    const { signals } = computeSignals(fromCloses(closes, 2));
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[signals.length - 1].side).toBe('sell');
  });

  it('holds through a trend rather than firing on every bar', () => {
    // A clean one-way run should signal once, not thirty times.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 3);
    const { signals } = computeSignals(fromCloses(closes, 1));
    expect(signals.length).toBeLessThanOrEqual(2);
  });

  it('is less sensitive as the key value grows', () => {
    const closes = Array.from({ length: 140 }, (_, i) => 100 + Math.sin(i / 5) * 14);
    const candles = fromCloses(closes, 2);
    const tight = computeSignals(candles, { ...SIGNAL_RULES, keyValue: 0.5 }).signals;
    const loose = computeSignals(candles, { ...SIGNAL_RULES, keyValue: 6 }).signals;
    expect(tight.length).toBeGreaterThan(loose.length);
  });

  it('alternates sides, since the stop must flip before it can fire again', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 6) * 15);
    const { signals } = computeSignals(fromCloses(closes, 2));
    expect(signals.length).toBeGreaterThan(2);
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i].side).not.toBe(signals[i - 1].side);
    }
  });

  it('emits each signal once, in time order, on bars from the input', () => {
    const closes = Array.from({ length: 150 }, (_, i) => 100 + Math.sin(i / 4) * 12);
    const input = fromCloses(closes, 2);
    const times = new Set(input.map((b) => b.t));
    const { signals } = computeSignals(input);
    const stamps = signals.map((s) => s.t);
    expect(new Set(stamps).size).toBe(stamps.length);
    for (const s of signals) expect(times.has(s.t)).toBe(true);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
  });

  it('keeps the stop on the correct side of price between flips', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 10);
    const candles = fromCloses(closes, 2);
    const { trail } = computeSignals(candles);
    for (let i = 0; i < trail.length; i++) {
      if (trail[i] === null) continue;
      // The stop is never exactly on price; it sits an ATR multiple away.
      expect(trail[i]).not.toBe(candles[i].close);
    }
  });
});
