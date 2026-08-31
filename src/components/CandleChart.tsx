import { useEffect, useRef } from 'react';
import { market } from '../store/marketStore';
import { toCandles } from '../engine/candles';
import { computeSignals } from '../engine/signals';
import { fmtAxis, fmtUsd } from '../lib/format';
import { niceStep } from '../lib/math';

const GUTTER = 94;
const PAD_TOP = 34;
const PAD_BOTTOM = 24;
const SLOT = 17; // one candle plus its gap
/** Bars fed to the indicators, well past what fits on screen. */
const SIGNAL_LOOKBACK = 160;
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

      // Indicators need warm-up well past the edge of the screen: a 13-bar
      // average over the ~17 bars that fit would leave only a few evaluable
      // points. Signals are computed over a long window and then drawn only
      // where that window overlaps what is on screen.
      const signalBars = toCandles(market.series, market.candleMs, SIGNAL_LOOKBACK);
      const study = market.signalsOn
        ? computeSignals(signalBars)
        : { signals: [], trail: [], dema: [] };

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
      // Bars are placed by their bucket's time, not their index, so a period
      // with no data leaves a visible gap instead of silently closing up.
      const newest = bars[bars.length - 1].t;
      const xOf = (barT: number) =>
        plotRight - ((newest - barT) / market.candleMs) * SLOT - SLOT / 2;

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
      // Far denser than the line chart's: this view is for reading levels off
      // the side, so it carries a rung roughly every 34px plus a live tag.
      const rungs = Math.max(4, Math.min(9, Math.floor(plotHeight / 34)));
      const step = niceStep(span / rungs);
      const priceY = yOf(market.price);
      const font = getComputedStyle(document.body).fontFamily;

      ctx.font = '600 12px ' + font;
      ctx.textBaseline = 'middle';
      const first = Math.ceil(lo / step) * step;
      for (let v = first; v <= hi; v += step) {
        const y = yOf(v);
        if (y < plotTop - 2 || y > plotBottom + 2) continue;
        // Yield to the target line and to the live price tag.
        if (Math.abs(y - ty) < 11) continue;
        if (Math.abs(y - priceY) < 16) continue;

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();

        ctx.textAlign = 'right';
        ctx.fillStyle = '#7b828c';
        ctx.fillText(fmtAxis(v, step), width - 10, y);
      }

      // ---- candles ---------------------------------------------------------
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const x = xOf(b.t);
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

      // ---- DEMA overlay ------------------------------------------------------
      if (market.signalsOn && study.dema.length) {
        ctx.beginPath();
        let drawing = false;
        for (let i = 0; i < signalBars.length; i++) {
          const v = study.dema[i];
          if (v === null || v === undefined) {
            drawing = false;
            continue;
          }
          const x = xOf(signalBars[i].t);
          const y = yOf(v);
          if (drawing) ctx.lineTo(x, y);
          else {
            ctx.moveTo(x, y);
            drawing = true;
          }
        }
        ctx.strokeStyle = 'rgba(0,221,148,0.85)';
        ctx.lineWidth = 1.4;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // ---- buy / sell labels -------------------------------------------------
      const visible = new Map(bars.map((b) => [b.t, b]));
      for (const sig of study.signals) {
        const bar = visible.get(sig.t);
        if (!bar) continue;
        const x = xOf(sig.t);
        if (x < -SLOT || x > plotRight + SLOT) continue;

        const buy = sig.side === 'buy';
        const colour = buy ? '#00c07b' : '#f0434c';
        const text = buy ? 'Buy' : 'Sell';

        ctx.font = '800 10px ' + font;
        const tw = ctx.measureText(text).width;
        const boxW = tw + 11;
        const boxH = 16;
        // Clear of the bar it refers to: under the low for a buy, over the
        // high for a sell, so the label never covers the price action.
        const boxY = buy ? yOf(bar.low) + 7 : yOf(bar.high) - 7 - boxH;
        const boxX = Math.max(2, Math.min(plotRight - boxW - 2, x - boxW / 2));

        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 3);
        ctx.fill();
        // The little pointer back to the bar.
        ctx.beginPath();
        if (buy) {
          ctx.moveTo(x, boxY - 4);
          ctx.lineTo(x - 4, boxY + 1);
          ctx.lineTo(x + 4, boxY + 1);
        } else {
          ctx.moveTo(x, boxY + boxH + 4);
          ctx.lineTo(x - 4, boxY + boxH - 1);
          ctx.lineTo(x + 4, boxY + boxH - 1);
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, boxX + boxW / 2, boxY + boxH / 2 + 0.5);
      }

      // ---- live price tag --------------------------------------------------
      {
        const label = fmtUsd(market.price);
        ctx.font = '800 11px ' + font;
        const tw = ctx.measureText(label).width;
        const tagH = 19;
        const tagX = plotRight + 5;
        const tagY = Math.max(plotTop + tagH / 2, Math.min(plotBottom - tagH / 2, priceY));

        ctx.save();
        ctx.strokeStyle = 'rgba(255,159,25,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, priceY);
        ctx.lineTo(tagX, priceY);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#ff9f19';
        const r = 4;
        const w = Math.min(tw + 12, width - tagX - 3);
        ctx.beginPath();
        ctx.roundRect(tagX, tagY - tagH / 2, w, tagH, r);
        ctx.fill();

        ctx.fillStyle = '#05130d';
        ctx.textAlign = 'center';
        ctx.fillText(label, tagX + w / 2, tagY);
      }

      // ---- interval label --------------------------------------------------
      const minutes = Math.round(market.candleMs / 60_000);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
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
