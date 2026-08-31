import type { Candle, Tick } from './types';

/**
 * Aggregates the price tape into OHLC bars.
 *
 * These are built from exactly the same samples the line chart draws, so the
 * candles cannot drift away from it — the two views are the same data at two
 * resolutions, not two separate simulations.
 */
export function toCandles(
  series: Tick[],
  bucketMs: number,
  maxBars: number,
  now = Date.now(),
): Candle[] {
  if (series.length === 0 || bucketMs <= 0) return [];

  const currentBucket = Math.floor(now / bucketMs) * bucketMs;
  const from = currentBucket - (maxBars - 1) * bucketMs;

  const bars: Candle[] = [];
  let bar: Candle | null = null;

  for (const tick of series) {
    if (tick.t < from) continue;
    const bucket = Math.floor(tick.t / bucketMs) * bucketMs;
    if (!bar || bar.t !== bucket) {
      if (bar) bars.push(bar);
      bar = {
        t: bucket,
        open: tick.p,
        high: tick.p,
        low: tick.p,
        close: tick.p,
        live: false,
      };
    } else {
      if (tick.p > bar.high) bar.high = tick.p;
      if (tick.p < bar.low) bar.low = tick.p;
      bar.close = tick.p;
    }
  }
  if (bar) bars.push(bar);

  // The newest bar is still being written to.
  const last = bars[bars.length - 1];
  if (last && last.t === currentBucket) last.live = true;

  return bars;
}

/**
 * Merges finished bars into wider ones.
 *
 * The chart keeps a long history of one-minute bars rather than raw ticks —
 * a day of ticks is hundreds of thousands of points, a day of minute bars is
 * 1,440 — and every candle width the UI offers is a whole number of minutes,
 * so it can be built from them.
 */
export function aggregateBars(
  bars: Candle[],
  bucketMs: number,
  maxBars: number,
  now = Date.now(),
): Candle[] {
  if (bars.length === 0 || bucketMs <= 0) return [];

  const currentBucket = Math.floor(now / bucketMs) * bucketMs;
  const from = currentBucket - (maxBars - 1) * bucketMs;

  const out: Candle[] = [];
  let current: Candle | null = null;

  for (const bar of bars) {
    if (bar.t < from) continue;
    const bucket = Math.floor(bar.t / bucketMs) * bucketMs;
    if (!current || current.t !== bucket) {
      if (current) out.push(current);
      current = { ...bar, t: bucket, live: false };
    } else {
      if (bar.high > current.high) current.high = bar.high;
      if (bar.low < current.low) current.low = bar.low;
      current.close = bar.close;
    }
  }
  if (current) out.push(current);

  const last = out[out.length - 1];
  if (last && last.t === currentBucket) last.live = true;
  return out;
}
