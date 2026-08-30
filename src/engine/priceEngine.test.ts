import { describe, expect, it } from 'vitest';
import { PriceEngine, VOL_PRESETS } from './priceEngine';
import { SECONDS_PER_YEAR } from '../lib/math';

const STEP_MS = 200;

/** Annualised standard deviation of the log returns an engine actually produces. */
function realizedVol(engine: PriceEngine, steps: number): number {
  let prev = engine.price;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < steps; i++) {
    const next = engine.step(STEP_MS);
    const r = Math.log(next / prev);
    sum += r;
    sumSq += r * r;
    prev = next;
  }
  const mean = sum / steps;
  const variance = sumSq / steps - mean * mean;
  return Math.sqrt(variance) * Math.sqrt(SECONDS_PER_YEAR / (STEP_MS / 1000));
}

describe('PriceEngine', () => {
  it('produces the volatility it was configured with', () => {
    // Diffusion only: this is the calibration that makes the quoted odds mean
    // something, since the same number is fed to the option pricer.
    for (const target of [0.15, 0.4, 0.9]) {
      const engine = new PriceEngine({
        seed: 4242,
        startPrice: 78_000,
        annualVol: target,
        volOfVol: 0,
        jumpsPerHour: 0,
        microBps: 0,
        drift: 0,
      });
      const measured = realizedVol(engine, 150_000);
      expect(measured / target).toBeGreaterThan(0.97);
      expect(measured / target).toBeLessThan(1.03);
    }
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const e = new PriceEngine({ seed: 777, startPrice: 78_000 });
      return Array.from({ length: 500 }, () => e.step(STEP_MS));
    };
    expect(run()).toEqual(run());
  });

  it('keeps prices positive, finite and quoted to the cent', () => {
    const engine = new PriceEngine({ seed: 5, startPrice: 78_000, annualVol: 1.5 });
    for (let i = 0; i < 20_000; i++) {
      const p = engine.step(STEP_MS);
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThan(0);
      // p * 100 will not be exactly integral in binary floating point even
      // when p is a whole number of cents, so compare against the rounding.
      expect(Math.abs(p * 100 - Math.round(p * 100))).toBeLessThan(1e-6);
    }
  });

  it('holds volatility inside its band under stochastic vol', () => {
    // Log-vol is an OU process, so it wanders; the clamp is what stops a run
    // from drifting into a regime the odds engine was never calibrated for.
    const engine = new PriceEngine({
      seed: 31,
      startPrice: 78_000,
      annualVol: 0.4,
      volOfVol: 3,
    });
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < 200_000; i++) {
      engine.step(STEP_MS);
      min = Math.min(min, engine.vol);
      max = Math.max(max, engine.vol);
    }
    expect(min).toBeGreaterThanOrEqual(0.4 * 0.15 - 1e-9);
    expect(max).toBeLessThanOrEqual(0.4 * 4 + 1e-9);
    // And it should actually move, otherwise the tape is a plain random walk.
    expect(max / min).toBeGreaterThan(2);
  });

  it('makes jumps fatten the tails', () => {
    const returns = (jumpsPerHour: number) => {
      const e = new PriceEngine({
        seed: 909,
        startPrice: 78_000,
        annualVol: 0.4,
        volOfVol: 0,
        microBps: 0,
        jumpsPerHour,
      });
      const out: number[] = [];
      let prev = e.price;
      for (let i = 0; i < 120_000; i++) {
        const p = e.step(STEP_MS);
        out.push(Math.log(p / prev));
        prev = p;
      }
      return out;
    };
    const kurtosis = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - m) ** 4, 0) / xs.length / v ** 2;
    };
    // A pure gaussian has kurtosis 3; jump diffusion is heavier.
    expect(kurtosis(returns(0))).toBeCloseTo(3, 0);
    expect(kurtosis(returns(30))).toBeGreaterThan(4);
  });

  it('eases into a new volatility regime rather than snapping', () => {
    const engine = new PriceEngine({
      seed: 11,
      startPrice: 78_000,
      annualVol: VOL_PRESETS.calm,
      volOfVol: 0,
    });
    const before = engine.vol;
    engine.setVol(VOL_PRESETS.wild);
    const after = engine.vol;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(VOL_PRESETS.wild);
    // It converges once the process runs on. Mean reversion is 4/day, so the
    // half-life is about four hours — this needs a day of simulated time, not
    // a few minutes.
    for (let i = 0; i < 120_000; i++) engine.step(1_000);
    expect(engine.vol).toBeCloseTo(VOL_PRESETS.wild, 1);
  });

  it('clamps absurd time steps instead of exploding', () => {
    const engine = new PriceEngine({ seed: 3, startPrice: 78_000 });
    const p = engine.step(10 * 60 * 60 * 1000);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0);
  });
});
