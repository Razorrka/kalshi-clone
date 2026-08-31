import { describe, expect, it } from 'vitest';
import { bucketWidthFor, sampleForPlot } from './plotSeries';
import type { Tick } from '../engine/types';

const T0 = 1_800_000_000_000; // an arbitrary, bucket-aligned epoch
const tape = (count: number, stepMs: number, price: (i: number) => number): Tick[] =>
  Array.from({ length: count }, (_, i) => ({ t: T0 + i * stepMs, p: price(i) }));

describe('sampleForPlot', () => {
  const series = tape(600, 200, (i) => 100 + Math.sin(i / 9) * 5);

  it('keeps every already-drawn point fixed as time moves on', () => {
    // The whole point: a drawn point must not move because the clock did.
    const bucket = 1_000;
    const first = sampleForPlot(series, T0, T0 + 60_000, bucket, 123);
    const later = sampleForPlot(series, T0, T0 + 63_400, bucket, 456);

    // Everything except each call's own pen tip must match exactly.
    const settled = (pts: Tick[]) => pts.slice(0, -1);
    const a = settled(first);
    const b = settled(later);
    expect(b.length).toBeGreaterThanOrEqual(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].t).toBe(a[i].t);
      expect(b[i].p).toBe(a[i].p);
    }
  });

  it('survives a whole window of advancing time without reshaping history', () => {
    const bucket = 1_000;
    let previous = sampleForPlot(series, T0, T0 + 40_000, bucket, 1);
    for (let step = 1; step <= 40; step++) {
      const nowMs = T0 + 40_000 + step * 317; // deliberately not bucket-aligned
      const next = sampleForPlot(series, T0, nowMs, bucket, step);
      const settled = previous.slice(0, -1);
      for (let i = 0; i < settled.length; i++) {
        expect(next[i].t).toBe(settled[i].t);
        expect(next[i].p).toBe(settled[i].p);
      }
      previous = next;
    }
  });

  it('lands settled points on bucket boundaries', () => {
    const bucket = 2_000;
    const pts = sampleForPlot(series, T0, T0 + 60_000, bucket, 1);
    for (const p of pts.slice(0, -1)) expect(p.t % bucket).toBe(0);
  });

  it('gives the pen tip the live price at the current instant', () => {
    const now = T0 + 55_555;
    const pts = sampleForPlot(series, T0, now, 1_000, 999.5);
    expect(pts[pts.length - 1]).toEqual({ t: now, p: 999.5 });
  });

  it('takes the last price seen in each bucket', () => {
    const ticks: Tick[] = [
      { t: T0 + 100, p: 10 },
      { t: T0 + 400, p: 20 },
      { t: T0 + 900, p: 30 }, // same 1s bucket; 30 wins
      { t: T0 + 1_200, p: 40 },
    ];
    const pts = sampleForPlot(ticks, T0, T0 + 1_300, 1_000, 40);
    expect(pts[0]).toEqual({ t: T0, p: 30 });
  });

  it('drops samples before the window', () => {
    const pts = sampleForPlot(series, T0 + 30_000, T0 + 60_000, 1_000, 1);
    for (const p of pts) expect(p.t).toBeGreaterThanOrEqual(T0 + 30_000);
  });

  it('thins the tape rather than returning every sample', () => {
    const pts = sampleForPlot(series, T0, T0 + 120_000, 1_000, 1);
    expect(pts.length).toBeLessThan(series.length / 3);
    expect(pts.length).toBeGreaterThan(10);
  });

  it('handles an empty tape and a nonsense bucket', () => {
    expect(sampleForPlot([], T0, T0 + 1_000, 1_000)).toEqual([]);
    expect(sampleForPlot(series, T0, T0 + 1_000, 0)).toEqual([]);
  });
});

describe('bucketWidthFor', () => {
  it('spaces points by roughly the requested pixels', () => {
    // 60s across 300px at 6px spacing is a point every 1.2s.
    expect(bucketWidthFor(60_000, 300, 6, 200)).toBeCloseTo(1_200, 6);
  });

  it('never goes finer than the tape is sampled', () => {
    expect(bucketWidthFor(1_000, 900, 6, 200)).toBe(200);
  });

  it('survives a zero-width plot', () => {
    expect(bucketWidthFor(60_000, 0, 6, 200)).toBe(200);
  });
});
