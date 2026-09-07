import { SECONDS_PER_YEAR, clamp } from '../lib/math';
import type { Tick } from './types';

/**
 * What volatility the live board should be priced on.
 *
 * Not simply "what the tape just did". Ten minutes of realised movement says
 * what the tape is doing now, and on its own it makes a hopeless forecast of
 * the next three minutes, because volatility mean-reverts and a still stretch
 * does not stay still.
 *
 * Priced off that short window alone, a genuinely quiet minute on Bitcoin
 * measured about 6% annualised — and at 6%, a price eight dollars under the
 * target with three minutes to run is a 26% shot. The same round on the real
 * exchange was quoted a coin flip, and the real exchange was right: eight
 * dollars is one hundredth of one percent of the price of Bitcoin, and calling
 * that a three-to-one underdog is what made the odds swing on nothing.
 */

/** How far back each window looks, and how often it samples inside it. */
export const SHORT_WINDOW_MS = 10 * 60_000;
export const SHORT_STEP_MS = 5_000;
export const LONG_WINDOW_MS = 180 * 60_000;
/** A minute, because that is the granularity the seeded history arrives at. */
export const LONG_STEP_MS = 60_000;
/** Bitcoin does not have a 5% year. */
export const VOL_FLOOR = 0.15;
export const VOL_CEILING = 3;

/** Nearest sampled price at or before `ts`, or 0 when the series starts later. */
function priceAt(series: Tick[], ts: number): number {
  if (series.length === 0) return 0;
  let best = 0;
  for (const t of series) {
    if (t.t > ts) break;
    best = t.p;
  }
  return best;
}

/**
 * Annualised realised volatility over one window.
 *
 * The sampling step has to match the data behind it. Asking a series of
 * one-minute candles for five-second returns gets eleven structural zeros for
 * every real move, which is a measurement of the sampling and not of the tape.
 */
export function realisedVol(
  series: Tick[],
  now: number,
  windowMs: number,
  stepMs: number,
): number | null {
  if (series.length < 8) return null;
  const from = Math.max(series[0].t, now - windowMs);
  const steps = Math.floor((now - from) / stepMs);
  if (steps < 12) return null;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let prev = priceAt(series, from);
  for (let i = 1; i <= steps; i++) {
    const p = priceAt(series, from + i * stepMs);
    if (p > 0 && prev > 0) {
      const r = Math.log(p / prev);
      sum += r;
      sumSq += r * r;
      count += 1;
    }
    prev = p;
  }
  if (count < 12) return null;

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return Math.sqrt(variance) * Math.sqrt(SECONDS_PER_YEAR / (stepMs / 1_000));
}

/**
 * The two windows blended, which is what the board is priced on.
 *
 * Equal weight on the variances — the standard shrinkage when a short sample
 * has to stand in for the future and there is a longer one of the same thing
 * to lean on. When the tape is genuinely wild the short window pulls the
 * number up; when it is briefly still it can no longer pull the whole board to
 * a standstill.
 */
export function liveAnnualVol(series: Tick[], now: number): number | null {
  const short = realisedVol(series, now, SHORT_WINDOW_MS, SHORT_STEP_MS);
  const long = realisedVol(series, now, LONG_WINDOW_MS, LONG_STEP_MS);
  if (short === null && long === null) return null;
  const a = short ?? long!;
  const b = long ?? short!;
  return clamp(Math.sqrt(0.5 * a * a + 0.5 * b * b), VOL_FLOOR, VOL_CEILING);
}
