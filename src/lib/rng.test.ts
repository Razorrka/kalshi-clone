import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.next())(new Rng(1)));
    const b = Array.from({ length: 20 }, ((r) => () => r.next())(new Rng(2)));
    expect(a).not.toEqual(b);
  });

  it('stays inside [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 20_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('draws standard normals with the right first two moments', () => {
    const r = new Rng(99);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = r.normal();
      sum += z;
      sumSq += z * z;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    // Standard error of the mean is 1/sqrt(n) ~ 0.0022 here.
    expect(Math.abs(mean)).toBeLessThan(0.015);
    expect(variance).toBeCloseTo(1, 1);
  });

  it('honours the probability given to chance()', () => {
    const r = new Rng(31337);
    let hits = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) if (r.chance(0.25)) hits++;
    expect(hits / n).toBeCloseTo(0.25, 2);
  });
});
