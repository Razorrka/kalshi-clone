import { describe, expect, it } from 'vitest';
import { Rng } from '../lib/rng';
import { probUp } from './odds';
import {
  LONG_STEP_MS,
  SHORT_STEP_MS,
  VOL_FLOOR,
  liveAnnualVol,
  realisedVol,
} from './vol';
import type { Tick } from './types';

const YEAR = 365 * 24 * 60 * 60;

/** A walk with a volatility we chose, so the estimator can be checked against it. */
function walk(opts: {
  vol: number;
  stepMs: number;
  steps: number;
  from: number;
  start?: number;
  seed?: number;
}): Tick[] {
  const rng = new Rng(opts.seed ?? 7);
  let p = opts.start ?? 79_000;
  const out: Tick[] = [];
  const sd = opts.vol * Math.sqrt(opts.stepMs / 1_000 / YEAR);
  for (let i = 0; i < opts.steps; i++) {
    p *= Math.exp(sd * rng.normal());
    out.push({ t: opts.from + i * opts.stepMs, p });
  }
  return out;
}

describe('realised volatility', () => {
  it('recovers a volatility it was given', () => {
    const now = 10_000_000;
    for (const vol of [0.2, 0.45, 0.9]) {
      const series = walk({ vol, stepMs: SHORT_STEP_MS, steps: 400, from: now - 400 * SHORT_STEP_MS });
      const got = realisedVol(series, now, 10 * 60_000, SHORT_STEP_MS)!;
      // A ten-minute window is only 120 returns, so this is a loose bound by
      // necessity — the point is that it lands on the right number, not that a
      // short sample is precise.
      expect(got).toBeGreaterThan(vol * 0.6);
      expect(got).toBeLessThan(vol * 1.6);
    }
  });

  it('is not fooled by asking a one-minute series for five-second returns', () => {
    // The seeded history arrives as one-minute candles. Sampled every five
    // seconds, eleven of every twelve returns are structurally zero.
    const now = 10_000_000;
    const series = walk({ vol: 0.45, stepMs: LONG_STEP_MS, steps: 200, from: now - 200 * LONG_STEP_MS });
    const proper = realisedVol(series, now, 180 * 60_000, LONG_STEP_MS)!;
    expect(proper).toBeGreaterThan(0.45 * 0.7);
    expect(proper).toBeLessThan(0.45 * 1.4);
  });

  it('declines to answer when there is not enough tape', () => {
    expect(realisedVol([], 1_000, 60_000, 5_000)).toBeNull();
    expect(realisedVol([{ t: 0, p: 1 }], 1_000, 60_000, 5_000)).toBeNull();
  });
});

describe('what the live board is priced on', () => {
  const now = 20_000_000;

  /** Three hours of ordinary movement, then ten minutes of near-silence. */
  function quietNow(): Tick[] {
    const history = walk({
      vol: 0.45,
      stepMs: LONG_STEP_MS,
      steps: 180,
      from: now - 190 * LONG_STEP_MS,
    });
    const last = history[history.length - 1].p;
    const still = walk({
      vol: 0.03,
      stepMs: SHORT_STEP_MS,
      steps: 120,
      from: now - 10 * 60_000,
      start: last,
      seed: 99,
    });
    return [...history, ...still];
  }

  it('will not let a still ten minutes price the next three', () => {
    const series = quietNow();
    const short = realisedVol(series, now, 10 * 60_000, SHORT_STEP_MS)!;
    const blended = liveAnnualVol(series, now)!;
    // The short window alone reads the tape as almost motionless.
    expect(short).toBeLessThan(0.1);
    // Blended with three hours of the same tape, it cannot.
    expect(blended).toBeGreaterThan(0.25);
  });

  it('quotes a tiny gap as close to a coin flip, the way the real board does', () => {
    // The exact moment from the screenshots: eight dollars under the target
    // with a little over three minutes to run. That is one hundredth of one
    // percent of the price of Bitcoin.
    const series = quietNow();
    const vol = liveAnnualVol(series, now)!;
    const p = probUp(79_661.22, 79_669.0, vol, 188_000);
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.5);
  });

  it('still follows the tape up when the tape is genuinely wild', () => {
    const wild = walk({ vol: 1.2, stepMs: SHORT_STEP_MS, steps: 400, from: now - 400 * SHORT_STEP_MS });
    const calm = walk({ vol: 0.2, stepMs: SHORT_STEP_MS, steps: 400, from: now - 400 * SHORT_STEP_MS });
    expect(liveAnnualVol(wild, now)!).toBeGreaterThan(liveAnnualVol(calm, now)!);
    expect(liveAnnualVol(wild, now)!).toBeGreaterThan(0.6);
  });

  it('never prices off a number Bitcoin has never had', () => {
    const flat: Tick[] = Array.from({ length: 300 }, (_, i) => ({
      t: now - 300 * SHORT_STEP_MS + i * SHORT_STEP_MS,
      p: 79_000,
    }));
    expect(liveAnnualVol(flat, now)).toBe(VOL_FLOOR);
  });
});
