import { describe, expect, it } from 'vitest';
import { aggregateBars, toCandles } from './candles';
import type { Candle, Tick } from './types';

const MIN = 60_000;
const T0 = Date.parse('2026-03-04T15:00:00Z');

/** One tick a second for `minutes`, following the supplied shape. */
function tape(minutes: number, shape: (i: number) => number): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i < minutes * 60; i++) out.push({ t: T0 + i * 1000, p: shape(i) });
  return out;
}

describe('toCandles', () => {
  it('buckets on clock-aligned boundaries', () => {
    const bars = toCandles(tape(20, (i) => 100 + i), 5 * MIN, 10, T0 + 20 * MIN);
    for (const bar of bars) expect(bar.t % (5 * MIN)).toBe(0);
    expect(bars[0].t).toBe(T0);
  });

  it('computes open, high, low and close from the same ticks', () => {
    // A single 5-minute bucket that rises, peaks, then falls back.
    const ticks: Tick[] = [
      { t: T0 + 1_000, p: 100 },
      { t: T0 + 2_000, p: 130 },
      { t: T0 + 3_000, p: 80 },
      { t: T0 + 4_000, p: 110 },
    ];
    const [bar] = toCandles(ticks, 5 * MIN, 5, T0 + 4_000);
    expect(bar.open).toBe(100);
    expect(bar.high).toBe(130);
    expect(bar.low).toBe(80);
    expect(bar.close).toBe(110);
  });

  it('marks only the bar still being written to as live', () => {
    const now = T0 + 12 * MIN;
    const bars = toCandles(tape(13, (i) => 100 + Math.sin(i / 30) * 5), 5 * MIN, 10, now);
    const live = bars.filter((b) => b.live);
    expect(live).toHaveLength(1);
    expect(live[0]).toBe(bars[bars.length - 1]);
    expect(live[0].t).toBe(Math.floor(now / (5 * MIN)) * (5 * MIN));
  });

  it('never drifts from the line chart: the last close is the last price', () => {
    const ticks = tape(17, (i) => 78_000 + Math.sin(i / 40) * 120);
    const bars = toCandles(ticks, 5 * MIN, 12, T0 + 17 * MIN);
    expect(bars[bars.length - 1].close).toBe(ticks[ticks.length - 1].p);
    expect(bars[0].open).toBe(ticks[0].p);
  });

  it('spans the whole tape, high to low', () => {
    const ticks = tape(20, (i) => 100 + Math.sin(i / 25) * 40);
    const bars = toCandles(ticks, 5 * MIN, 20, T0 + 20 * MIN);
    const prices = ticks.map((t) => t.p);
    expect(Math.max(...bars.map((b) => b.high))).toBe(Math.max(...prices));
    expect(Math.min(...bars.map((b) => b.low))).toBe(Math.min(...prices));
  });

  it('keeps at most the requested number of bars, newest kept', () => {
    const ticks = tape(60, (i) => 100 + i);
    const bars = toCandles(ticks, 5 * MIN, 4, T0 + 60 * MIN);
    expect(bars.length).toBeLessThanOrEqual(4);
    // The newest bar is the bucket holding the newest tick. Here the tape
    // stops a second short of the hour, so that is the 55-minute bucket, not
    // the empty one the clock has just entered.
    const lastTick = ticks[ticks.length - 1];
    expect(bars[bars.length - 1].t).toBe(
      Math.floor(lastTick.t / (5 * MIN)) * (5 * MIN),
    );
    expect(bars[bars.length - 1].close).toBe(lastTick.p);
  });

  it('survives an empty or degenerate tape', () => {
    expect(toCandles([], 5 * MIN, 10)).toEqual([]);
    expect(toCandles(tape(1, () => 100), 0, 10)).toEqual([]);
    const one = toCandles([{ t: T0, p: 42 }], 5 * MIN, 10, T0);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ open: 42, high: 42, low: 42, close: 42, live: true });
  });
});

describe('accuracy against a brute-force recomputation', () => {
  /** Deterministic pseudo-random tape, so a failure can be replayed. */
  function randomTape(seed: number, count: number, stepMs: number): Tick[] {
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    let p = 78_000;
    const out: Tick[] = [];
    for (let i = 0; i < count; i++) {
      p = Math.round((p * (1 + (rnd() - 0.5) * 0.002)) * 100) / 100;
      out.push({ t: T0 + i * stepMs, p });
    }
    return out;
  }

  it('matches a bar-by-bar recomputation over many random tapes', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const stepMs = [200, 1_000, 5_000][seed % 3];
      const bucketMs = [60_000, 5 * MIN, 15 * MIN][seed % 3];
      const ticks = randomTape(seed, 1_500, stepMs);
      const now = ticks[ticks.length - 1].t;
      const bars = toCandles(ticks, bucketMs, 200, now);

      for (const bar of bars) {
        // Independently: every tick whose bucket is this bar's bucket.
        const inBucket = ticks.filter(
          (t) => Math.floor(t.t / bucketMs) * bucketMs === bar.t,
        );
        expect(inBucket.length).toBeGreaterThan(0);
        const prices = inBucket.map((t) => t.p);
        expect(bar.open).toBe(prices[0]);
        expect(bar.close).toBe(prices[prices.length - 1]);
        expect(bar.high).toBe(Math.max(...prices));
        expect(bar.low).toBe(Math.min(...prices));
      }
    }
  });

  it('keeps the invariants every candle must satisfy', () => {
    for (let seed = 100; seed < 120; seed++) {
      const ticks = randomTape(seed, 900, 1_000);
      const bars = toCandles(ticks, 5 * MIN, 50, ticks[ticks.length - 1].t);
      for (const bar of bars) {
        expect(bar.high).toBeGreaterThanOrEqual(bar.low);
        expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
        expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      }
    }
  });

  it('accounts for every tick in the window, losing none', () => {
    const ticks = randomTape(7, 1_200, 1_000);
    const now = ticks[ticks.length - 1].t;
    const bucketMs = 5 * MIN;
    const bars = toCandles(ticks, bucketMs, 500, now);
    const firstBucket = bars[0].t;
    const expected = ticks.filter((t) => t.t >= firstBucket).length;
    const counted = bars.reduce(
      (n, bar) =>
        n +
        ticks.filter((t) => Math.floor(t.t / bucketMs) * bucketMs === bar.t).length,
      0,
    );
    expect(counted).toBe(expected);
  });

  it('hands consecutive bars a continuous price, with no invented gaps', () => {
    // Sampling is dense relative to the bucket, so each bar opens where the
    // previous one closed; a jump would mean the aggregation dropped ticks.
    const ticks = randomTape(3, 2_000, 200);
    const bars = toCandles(ticks, 60_000, 100, ticks[ticks.length - 1].t);
    for (let i = 1; i < bars.length; i++) {
      const prevClose = bars[i - 1].close;
      const open = bars[i].open;
      expect(Math.abs(open - prevClose) / prevClose).toBeLessThan(0.005);
    }
  });
});

describe('aggregateBars', () => {
  const minute = (i: number, o: number, h: number, l: number, c: number): Candle => ({
    t: T0 + i * MIN,
    open: o,
    high: h,
    low: l,
    close: c,
    live: false,
  });

  it('merges minute bars into a wider one, keeping the true extremes', () => {
    const input = [
      minute(0, 100, 105, 99, 104),
      minute(1, 104, 112, 103, 108), // the run's high
      minute(2, 108, 109, 95, 97), // and its low
      minute(3, 97, 101, 96, 100),
      minute(4, 100, 102, 98, 101),
    ];
    const [bar] = aggregateBars(input, 5 * MIN, 10, T0 + 4 * MIN);
    expect(bar.t).toBe(T0);
    expect(bar.open).toBe(100); // first bar's open
    expect(bar.high).toBe(112); // highest high anywhere in the run
    expect(bar.low).toBe(95); // lowest low
    expect(bar.close).toBe(101); // last bar's close
  });

  it('splits on bucket boundaries', () => {
    const input = Array.from({ length: 12 }, (_, i) =>
      minute(i, 100 + i, 101 + i, 99 + i, 100 + i),
    );
    const out = aggregateBars(input, 5 * MIN, 10, T0 + 11 * MIN);
    expect(out.map((b) => b.t)).toEqual([T0, T0 + 5 * MIN, T0 + 10 * MIN]);
    expect(out[0].open).toBe(100);
    expect(out[0].close).toBe(104);
    expect(out[1].open).toBe(105);
  });

  it('marks only the bucket holding now as live', () => {
    const input = Array.from({ length: 12 }, (_, i) => minute(i, 100, 101, 99, 100));
    const out = aggregateBars(input, 5 * MIN, 10, T0 + 11 * MIN);
    expect(out.filter((b) => b.live)).toHaveLength(1);
    expect(out[out.length - 1].live).toBe(true);
  });

  it('never loses an extreme from any minute it covers', () => {
    let s = 99;
    const input = Array.from({ length: 240 }, (_, i) => {
      s = (s * 1103515245 + 12345) >>> 0;
      const base = 100 + (s % 50);
      return minute(i, base, base + 4, base - 4, base + 1);
    });
    const out = aggregateBars(input, 15 * MIN, 40, T0 + 239 * MIN);
    for (const bar of out) {
      const covered = input.filter(
        (m) => Math.floor(m.t / (15 * MIN)) * (15 * MIN) === bar.t,
      );
      expect(bar.high).toBe(Math.max(...covered.map((m) => m.high)));
      expect(bar.low).toBe(Math.min(...covered.map((m) => m.low)));
      expect(bar.open).toBe(covered[0].open);
      expect(bar.close).toBe(covered[covered.length - 1].close);
    }
  });

  it('keeps at most the requested count and survives empty input', () => {
    const input = Array.from({ length: 300 }, (_, i) => minute(i, 100, 101, 99, 100));
    expect(aggregateBars(input, 5 * MIN, 6, T0 + 299 * MIN).length).toBeLessThanOrEqual(6);
    expect(aggregateBars([], 5 * MIN, 10)).toEqual([]);
    expect(aggregateBars(input, 0, 10)).toEqual([]);
  });
});
