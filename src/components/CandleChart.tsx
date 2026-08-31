import { useEffect, useRef } from 'react';
import { market } from '../store/marketStore';
import { toCandles } from '../engine/candles';
import { fmtAxis } from '../lib/format';
import { niceStep } from '../lib/math';

const GUTTER = 86;
const PAD_TOP = 34;
const PAD_BOTTOM = 24;
const SLOT = 17; // one candle plus its gap
const BODY = 11;

/**
 * Candlesticks built from the same tape the line chart draws, so the two views
 * can never disagree — they are one price series at two resolutions.
 */
export function CandleChart() {
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
      ctx.clearRect(0, 0, width, height);
      if (market.awaitingFeed) return;

      const plotRight = width - GUTTER;
      const plotTop = PAD_TOP;
      const plotBottom = height - PAD_BOTTOM;
      const plotHeight = plotBottom - plotTop;
      if (plotRight <= 8 || plotHeight <= 8) return;

      const maxBars = Math.max(3, Math.floor(plotRight / SLOT));
      const bars = toCandles(market.series, market.candleMs, maxBars);
      if (bars.length === 0) return;

      let lo = Infinity;
      let hi = -Infinity;
      for (const b of bars) {
        if (b.low < lo) lo = b.low;
        if (b.high > hi) hi = b.high;
      }

      const strike = market.round.strike;
      let span = hi - lo;
      if (span < 0.02) {
        const mid = (hi + lo) / 2;
        lo = mid - 0.05;
        hi = mid + 0.05;
        span = hi - lo;
      }
      if (strike > hi && strike - hi < span * 0.28) hi = strike;
      if (strike < lo && lo - strike < span * 0.28) lo = strike;
      span = hi - lo;
      const pad = span * 0.14;
      lo -= pad;
      hi += pad;
      span = hi - lo;

      const yOf = (p: number) => plotBottom - ((p - lo) / span) * plotHeight;
      // Newest bar sits at the right edge, older ones march left.
      const xOf = (i: number) => plotRight - (bars.length - 1 - i) * SLOT - SLOT / 2;

      // ---- target line -----------------------------------------------------
      const strikeY = yOf(strike);
      const pinnedUp = strikeY < plotTop;
      const pinnedDown = strikeY > plotBottom;
      const ty = pinnedUp ? plotTop : pinnedDown ? plotBottom : strikeY;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4.5]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(width, ty);
      ctx.stroke();
      ctx.restore();

      // ---- price axis ------------------------------------------------------
      const step = niceStep(span / 3.4);
      ctx.font = '600 13px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#7b828c';
      const first = Math.ceil((lo + pad * 0.4) / step) * step;
      for (let v = first; v <= hi - pad * 0.3; v += step) {
        const y = yOf(v);
        if (y < plotTop - 4 || y > plotBottom + 4) continue;
        if (Math.abs(y - ty) < 12) continue;
        ctx.fillText(fmtAxis(v, step), width - 12, y);
      }

      // ---- candles ---------------------------------------------------------
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const x = xOf(i);
        if (x < -SLOT) continue;
        const rising = b.close >= b.open;
        const colour = rising ? '#00dd94' : '#ff454d';

        ctx.strokeStyle = colour;
        ctx.fillStyle = colour;
        ctx.globalAlpha = b.live ? 1 : 0.92;

        // wick
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, yOf(b.high));
        ctx.lineTo(x, yOf(b.low));
        ctx.stroke();

        // body — a doji still needs a visible line
        const yOpen = yOf(b.open);
        const yClose = yOf(b.close);
        const top = Math.min(yOpen, yClose);
        const h = Math.max(1.5, Math.abs(yClose - yOpen));
        ctx.fillRect(x - BODY / 2, top, BODY, h);

        // the bar still being written to gets a marker on its close
        if (b.live) {
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = colour;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(0, yClose);
          ctx.lineTo(x - BODY / 2 - 2, yClose);
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      // ---- interval label --------------------------------------------------
      const minutes = Math.round(market.candleMs / 60_000);
      ctx.textAlign = 'left';
      ctx.font = '800 11px ' + getComputedStyle(document.body).fontFamily;
      ctx.fillStyle = '#6a707a';
      ctx.letterSpacing = '0.8px';
      ctx.fillText(`${minutes}M CANDLES`, 14, plotTop - 16);
      ctx.letterSpacing = '0px';
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
