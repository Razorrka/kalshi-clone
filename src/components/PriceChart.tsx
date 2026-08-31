import { useEffect, useRef } from 'react';
import { market } from '../store/marketStore';
import { TIMEFRAME_MS, type Tick } from '../engine/types';
import { fmtAxis } from '../lib/format';
import { niceStep } from '../lib/math';
import { traceSmooth, type Point } from '../lib/curve';

const GUTTER = 86; // right-hand strip reserved for the price axis
const PAD_TOP = 34;
const PAD_BOTTOM = 18;
const LINE = '#ff9f19';
/**
 * Pixels between plotted points. One point per pixel drew every 200ms
 * bid/ask wobble as a corner; spacing them out and curving between leaves a
 * line that follows the move rather than the noise.
 */
const POINT_SPACING = 6;

interface Bucket {
  x: number;
  min: number;
  max: number;
  last: number;
}

/** Index of the first sample at or after `t`. */
function lowerBound(series: Tick[], t: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The chart is a canvas driven by its own animation frame rather than React
 * state: at 5 samples a second, re-rendering the tree for every tick would be
 * pure waste. It reads the store directly and repaints.
 */
export function PriceChart() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = Date.now();
      const anim = performance.now();

      ctx.clearRect(0, 0, width, height);
      // Live mode with no price yet: nothing true to draw.
      if (market.awaitingFeed) return;

      const plotRight = width - GUTTER;
      const plotTop = PAD_TOP;
      const plotBottom = height - PAD_BOTTOM;
      const plotHeight = plotBottom - plotTop;
      if (plotRight <= 8 || plotHeight <= 8) return;

      const windowMs = TIMEFRAME_MS[market.timeframe];
      const tEnd = now;
      const tStart = tEnd - windowMs;

      const series = market.series;
      const startIdx = Math.max(0, lowerBound(series, tStart) - 1);

      // ---- reduce the visible samples to one point every few pixels ------
      const buckets: Bucket[] = [];
      let lo = Infinity;
      let hi = -Infinity;
      const xOf = (t: number) => ((t - tStart) / windowMs) * plotRight;

      // NaN so the first sample always opens a bucket, even at x === -1.
      let cursor = Number.NaN;
      for (let i = startIdx; i < series.length; i++) {
        const s = series[i];
        if (s.t < tStart) {
          // Keep the straddling sample so the line reaches the left edge.
          if (i + 1 < series.length && series[i + 1].t < tStart) continue;
        }
        const x = Math.round(xOf(s.t) / POINT_SPACING) * POINT_SPACING;
        if (x !== cursor) {
          buckets.push({ x, min: s.p, max: s.p, last: s.p });
          cursor = x;
        } else {
          const b = buckets[buckets.length - 1];
          if (s.p < b.min) b.min = s.p;
          if (s.p > b.max) b.max = s.p;
          b.last = s.p;
        }
        // The y range still comes from every sample, so the frame never cuts
        // off a high the reduced line happens to skip.
        if (s.p < lo) lo = s.p;
        if (s.p > hi) hi = s.p;
      }

      // The head always sits exactly on the right edge, at the live price.
      const head = market.price;
      if (buckets.length === 0 || buckets[buckets.length - 1].x < plotRight) {
        buckets.push({ x: plotRight, min: head, max: head, last: head });
      } else {
        buckets[buckets.length - 1].x = plotRight;
        buckets[buckets.length - 1].last = head;
      }
      if (head < lo) lo = head;
      if (head > hi) hi = head;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;

      // ---- y scale -------------------------------------------------------
      const strike = market.round.strike;
      let span = hi - lo;
      if (span < 0.02) {
        const mid = (hi + lo) / 2;
        lo = mid - 0.05;
        hi = mid + 0.05;
        span = hi - lo;
      }
      // Pull the target line into frame when it is close, but let it sit
      // off-screen (and get pinned) when the price has run away from it.
      if (strike > hi && strike - hi < span * 0.28) hi = strike;
      if (strike < lo && lo - strike < span * 0.28) lo = strike;
      span = hi - lo;
      const pad = span * 0.16;
      lo -= pad;
      hi += pad;
      span = hi - lo;

      const yOf = (p: number) => plotBottom - ((p - lo) / span) * plotHeight;

      const strikeY = yOf(strike);
      const pinnedUp = strikeY < plotTop;
      const pinnedDown = strikeY > plotBottom;
      const ty = pinnedUp ? plotTop : pinnedDown ? plotBottom : strikeY;

      // ---- price axis on the right ---------------------------------------
      const step = niceStep(span / 3.4);
      ctx.font = '600 14px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#7b828c';
      const first = Math.ceil((lo + pad * 0.4) / step) * step;
      for (let v = first; v <= hi - pad * 0.3; v += step) {
        const y = yOf(v);
        if (y < plotTop - 4 || y > plotBottom + 4) continue;
        // The target line runs the full width, so a tick that lands on it
        // would be struck through. The tick is the one that yields.
        if (Math.abs(y - ty) < 13) continue;
        ctx.fillText(fmtAxis(v, step), width - 12, y);
      }

      // ---- target line ----------------------------------------------------
      ctx.font = '800 13px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'left';
      ctx.letterSpacing = '1.4px';
      const labelWidth = ctx.measureText('TARGET').width;
      // A chevron marks a target that has run off the top or bottom of the
      // frame. Drawn rather than typed, so no font has to own the glyph.
      const chevWidth = pinnedUp || pinnedDown ? 15 : 0;
      const labelX = (plotRight - labelWidth - chevWidth) / 2;
      const gapEnd = labelX + labelWidth + chevWidth;

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 4.5]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(labelX - 14, ty);
      ctx.moveTo(gapEnd + 14, ty);
      ctx.lineTo(width, ty);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#aab1bb';
      ctx.textBaseline = 'middle';
      ctx.fillText('TARGET', labelX, ty);
      ctx.letterSpacing = '0px';

      if (chevWidth) {
        // Points the way the target lies: up when it is above the frame.
        const cx = labelX + labelWidth + 8;
        const shoulderY = ty + (pinnedUp ? 2 : -2);
        const tipY = ty + (pinnedUp ? -3 : 3);
        ctx.save();
        ctx.strokeStyle = '#aab1bb';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - 4.5, shoulderY);
        ctx.lineTo(cx, tipY);
        ctx.lineTo(cx + 4.5, shoulderY);
        ctx.stroke();
        ctx.restore();
      }

      // ---- entry markers for open tickets ---------------------------------
      for (const pos of market.openPositions) {
        const py = yOf(pos.entryPrice);
        if (py < plotTop - 20 || py > plotBottom + 20) continue;
        const px = Math.max(4, Math.min(plotRight, xOf(pos.placedAt)));
        const colour = pos.side === 'up' ? '20,226,160' : '255,77,94';
        ctx.save();
        ctx.strokeStyle = `rgba(${colour},0.32)`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(plotRight, py);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = `rgb(${colour})`;
        ctx.beginPath();
        ctx.arc(px, py, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- the price line + gradient fill ---------------------------------
      const path: Point[] = buckets.map((b) => ({ x: b.x, y: yOf(b.last) }));

      const fill = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      fill.addColorStop(0, 'rgba(255,159,25,0.30)');
      fill.addColorStop(0.55, 'rgba(255,159,25,0.10)');
      fill.addColorStop(1, 'rgba(255,159,25,0)');

      ctx.save();
      ctx.beginPath();
      traceSmooth(ctx, path);
      ctx.lineTo(path[path.length - 1].x, plotBottom + 40);
      ctx.lineTo(path[0].x, plotBottom + 40);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      traceSmooth(ctx, path);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 2.8;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // ---- head ------------------------------------------------------------
      const hx = plotRight;
      const hy = yOf(head);
      const phase = (anim % 1800) / 1800;
      ctx.save();
      ctx.globalAlpha = 0.32 * (1 - phase);
      ctx.fillStyle = LINE;
      ctx.beginPath();
      ctx.arc(hx, hy, 6 + phase * 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = 'rgba(255,159,25,0.85)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = LINE;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="chart-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
