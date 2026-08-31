import { describe, expect, it } from 'vitest';
import { SIGNAL_RULES, computeSignals, ema, minimumBars, rsi } from './signals';
import type { Candle } from './types';

const MIN = 60_000;
const T0 = Date.parse('2026-03-04T15:00:00Z');

/** Closed bars from a list of closes; the last one can be marked forming. */
function bars(closes: number[], liveLast = false): Candle[] {
  return closes.map((c, i) => ({
    t: T0 + i * 5 * MIN,
    open: i === 0 ? c : closes[i - 1],
    high: Math.max(c, i === 0 ? c : closes[i - 1]),
    low: Math.min(c, i === 0 ? c : closes[i - 1]),
    close: c,
    live: liveLast && i === closes.length - 1,
  }));
}

describe('ema', () => {
  it('matches a hand-computed run', () => {
    // period 3 over 1..5: seed is the mean of the first three (2), then
    // k = 2/(3+1) = 0.5, so 4*0.5 + 2*0.5 = 3, then 5*0.5 + 3*0.5 = 4.
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('returns the constant for a flat series', () => {
    const out = ema([7, 7, 7, 7, 7, 7], 3);
    for (const v of out.slice(2)) expect(v).toBeCloseTo(7, 10);
  });

  it('is null until the window fills, and never after', () => {
    const out = ema([1, 2, 3, 4, 5, 6], 4);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    for (const v of out.slice(3)) expect(v).not.toBeNull();
  });

  it('tracks a rising series from below and keeps rising', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = ema(values, 5).filter((v): v is number => v !== null);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    expect(out[out.length - 1]).toBeLessThan(values[values.length - 1]);
  });

  it('reacts faster on a shorter period', () => {
    const values = [10, 10, 10, 10, 10, 10, 20, 20, 20, 20];
    const fast = ema(values, 3).at(-1)!;
    const slow = ema(values, 8).at(-1)!;
    expect(fast).toBeGreaterThan(slow);
  });

  it('handles a series shorter than the period', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
    expect(ema([], 5)).toEqual([]);
  });
});

describe('rsi', () => {
  it('matches a hand-computed Wilder run', () => {
    // period 2 over [10, 12, 11, 13].
    // Seed from the first two changes (+2, -1): avgGain 1, avgLoss 0.5,
    // RS 2, so RSI = 100 - 100/3.
    // Then +2: avgGain (1*1 + 2)/2 = 1.5, avgLoss (0.5*1 + 0)/2 = 0.25,
    // RS 6, so RSI = 100 - 100/7.
    const out = rsi([10, 12, 11, 13], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(100 - 100 / 3, 10);
    expect(out[3]).toBeCloseTo(100 - 100 / 7, 10);
  });

  it('pins to 100 on an unbroken rise and 0 on an unbroken fall', () => {
    const up = rsi([1, 2, 3, 4, 5, 6, 7, 8], 3).at(-1);
    const down = rsi([8, 7, 6, 5, 4, 3, 2, 1], 3).at(-1);
    expect(up).toBe(100);
    expect(down).toBe(0);
  });

  it('reads mid-scale on a flat series', () => {
    expect(rsi([5, 5, 5, 5, 5, 5], 3).at(-1)).toBe(50);
  });

  it('stays within 0 and 100 on noisy input', () => {
    let s = 12345;
    const values = Array.from({ length: 200 }, () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return 100 + (s / 4294967296) * 20;
    });
    for (const v of rsi(values, 14)) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('computeSignals', () => {
  it('stays silent until there are enough closed bars', () => {
    const few = bars(Array.from({ length: minimumBars() - 1 }, (_, i) => 100 + i));
    expect(computeSignals(few)).toEqual([]);
  });

  it('ignores the bar still being written to', () => {
    // A V that turns up hard, with the turn on the final, forming bar.
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => 120 - i * 2),
      ...Array.from({ length: 8 }, (_, i) => 82 + i * 6),
    ];
    const withLive = computeSignals(bars(closes, true));
    const allClosed = computeSignals(bars(closes, false));
    // Whatever the last bar would have produced cannot appear while it forms.
    const lastT = T0 + (closes.length - 1) * 5 * MIN;
    expect(withLive.some((s) => s.t === lastT)).toBe(false);
    expect(allClosed.length).toBeGreaterThanOrEqual(withLive.length);
  });

  it('calls a buy when the fast average crosses up through the slow one', () => {
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => 200 - i * 3),
      ...Array.from({ length: 14 }, (_, i) => 143 + i * 4),
    ];
    const signals = computeSignals(bars(closes));
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[signals.length - 1].side).toBe('buy');
  });

  it('calls a sell when it crosses back down', () => {
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => 100 + i * 3),
      ...Array.from({ length: 14 }, (_, i) => 157 - i * 4),
    ];
    const signals = computeSignals(bars(closes));
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[signals.length - 1].side).toBe('sell');
  });

  it('holds back a buy that would fire into an overbought move', () => {
    // Same upward cross, but the RSI gate shut all the way.
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => 200 - i * 3),
      ...Array.from({ length: 14 }, (_, i) => 143 + i * 4),
    ];
    const gated = computeSignals(bars(closes), { ...SIGNAL_RULES, overbought: 0 });
    expect(gated.filter((s) => s.side === 'buy')).toHaveLength(0);
  });

  it('never marks a bar that is not in the input', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const input = bars(closes);
    const times = new Set(input.map((b) => b.t));
    for (const s of computeSignals(input)) expect(times.has(s.t)).toBe(true);
  });

  it('emits each signal once, in time order', () => {
    const closes = Array.from({ length: 90 }, (_, i) => 100 + Math.sin(i / 4) * 12);
    const signals = computeSignals(bars(closes));
    const times = signals.map((s) => s.t);
    expect(new Set(times).size).toBe(times.length);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('alternates sides, since a cross must reverse before it can repeat', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 15);
    const signals = computeSignals(bars(closes));
    expect(signals.length).toBeGreaterThan(2);
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i].side).not.toBe(signals[i - 1].side);
    }
  });
});
