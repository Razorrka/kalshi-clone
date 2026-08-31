import { describe, expect, it } from 'vitest';
import { toCandles } from './candles';
import type { Tick } from './types';

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
