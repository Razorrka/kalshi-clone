import { useEffect, useRef } from 'react';
import { market } from '../store/marketStore';
import { TIMEFRAME_MS, type Tick } from '../engine/types';
import { fmtAxis } from '../lib/format';
import { niceStep } from '../lib/math';

const GUTTER = 86; // right-hand strip reserved for the price axis
const PAD_TOP = 26;
const PAD_BOTTOM = 18;
const LINE = '#ff9f19';

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

      // ---- bucket the visible samples down to one column per pixel -------
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
        const x = Math.round(xOf(s.t));
        if (x !== cursor) {
          buckets.push({ x, min: s.p, max: s.p, last: s.p });
          cursor = x;
        } else {
          const b = buckets[buckets.length - 1];
          if (s.p < b.min) b.min = s.p;
          if (s.p > b.max) b.max = s.p;
          b.last = s.p;
        }
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
        ctx.fillText(fmtAxis(v, step), width - 12, y);
      }

      // ---- target line ----------------------------------------------------
      const strikeY = yOf(strike);
      const pinnedUp = strikeY < plotTop;
      const pinnedDown = strikeY > plotBottom;
      const ty = pinnedUp ? plotTop : pinnedDown ? plotBottom : strikeY;
      const label = 'TARGET';
      ctx.font = '800 13px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'left';
      const chev = pinnedUp ? ' ⌃' : pinnedDown ? ' ⌄' : '';
      const labelText = label + chev;
      ctx.letterSpacing = '1.4px';
      const labelWidth = ctx.measureText(labelText).width;
      const labelX = (plotRight - labelWidth) / 2;

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 4.5]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(labelX - 14, ty);
      ctx.moveTo(labelX + labelWidth + 14, ty);
      ctx.lineTo(width, ty);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#aab1bb';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, labelX, ty);
      ctx.letterSpacing = '0px';

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
      ctx.beginPath();
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        const y = yOf(b.last);
        if (i === 0) ctx.moveTo(b.x, y);
        else ctx.lineTo(b.x, y);
      }

      const fill = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      fill.addColorStop(0, 'rgba(255,159,25,0.30)');
      fill.addColorStop(0.55, 'rgba(255,159,25,0.10)');
      fill.addColorStop(1, 'rgba(255,159,25,0)');

      ctx.save();
      ctx.lineTo(buckets[buckets.length - 1].x, plotBottom + 40);
      ctx.lineTo(buckets[0].x, plotBottom + 40);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        const y = yOf(b.last);
        if (i === 0) ctx.moveTo(b.x, y);
        else ctx.lineTo(b.x, y);
      }
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
