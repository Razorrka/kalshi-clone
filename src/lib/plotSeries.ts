import type { Tick } from '../engine/types';

/**
 * Reduces a tape to the points a line chart should draw.
 *
 * Buckets are anchored to absolute time, never to screen position. Bucketing
 * on a pixel grid looks equivalent but is not: the grid scrolls with the
 * window, so which samples share a bucket changes every frame and the whole
 * line reshuffles under you. Anchored to the clock, a point that has been
 * drawn keeps its time and its price for good — only the viewport moves past
 * it.
 *
 * The final bucket is still filling, so its point rides at `now` with the
 * latest price: that is the pen tip, and it is the only point that moves.
 */
export function sampleForPlot(
  series: Tick[],
  from: number,
  now: number,
  bucketMs: number,
  livePrice?: number,
): Tick[] {
  const out: Tick[] = [];
  if (series.length === 0 || bucketMs <= 0) return out;

  let lastKey = Number.NaN;
  for (const s of series) {
    if (s.t < from) continue;
    const key = Math.floor(s.t / bucketMs);
    if (key !== lastKey) {
      out.push({ t: key * bucketMs, p: s.p });
      lastKey = key;
    } else {
      out[out.length - 1].p = s.p;
    }
  }
  if (out.length === 0) return out;

  const head = livePrice ?? out[out.length - 1].p;
  const currentKey = Math.floor(now / bucketMs);
  if (lastKey === currentKey) {
    // The forming bucket is the pen tip: pin it to now.
    out[out.length - 1] = { t: now, p: head };
  } else {
    out.push({ t: now, p: head });
  }
  return out;
}

/** Bucket width that puts plotted points roughly `spacing` pixels apart. */
export function bucketWidthFor(
  windowMs: number,
  plotWidth: number,
  spacing: number,
  floorMs: number,
): number {
  if (plotWidth <= 0) return floorMs;
  return Math.max(floorMs, (windowMs * spacing) / plotWidth);
}
