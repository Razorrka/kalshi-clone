import { Rng } from '../lib/rng';
import { SECONDS_PER_YEAR, clamp } from '../lib/math';

/**
 * A price process that behaves like a real crypto tape rather than a plain
 * random walk. Four ingredients, all standard:
 *
 *   1. Geometric Brownian motion for the trend/diffusion.
 *   2. Stochastic volatility — log-vol mean-reverts (an Ornstein–Uhlenbeck
 *      process), so the tape has genuinely calm stretches and genuinely
 *      violent ones instead of a constant wiggle.
 *   3. Poisson jumps, so the occasional candle gaps the way news does.
 *   4. A mean-reverting microstructure term layered on top of the "true"
 *      price, which is what makes the last few seconds look like an order
 *      book rather than a smooth curve.
 *
 * Everything is seeded, so a run can be replayed exactly.
 */

export interface SimConfig {
  seed: number;
  startPrice: number;
  /** Annualised volatility of the diffusion term, e.g. 0.35 = 35%. */
  annualVol: number;
  /** Annualised drift. Kept at ~0 so neither side has an edge. */
  drift: number;
  /** Speed of mean reversion of log-vol, per day. */
  volMeanReversion: number;
  /** Volatility of log-vol, per sqrt(day). */
  volOfVol: number;
  /** Expected jumps per hour. */
  jumpsPerHour: number;
  /** Jump size as a multiple of the per-second diffusion sigma. */
  jumpSize: number;
  /** Microstructure noise amplitude, in basis points of price. */
  microBps: number;
}

export const VOL_PRESETS = {
  calm: 0.18,
  normal: 0.4,
  wild: 0.95,
} as const;

export type VolPreset = keyof typeof VOL_PRESETS;

export const DEFAULT_SIM_CONFIG: SimConfig = {
  seed: 0,
  startPrice: 78_254.88,
  annualVol: VOL_PRESETS.normal,
  drift: 0,
  volMeanReversion: 4,
  volOfVol: 1.6,
  jumpsPerHour: 6,
  jumpSize: 9,
  microBps: 0.4,
};

export class PriceEngine {
  private cfg: SimConfig;
  private rng: Rng;
  /** log of the latent "true" price */
  private logPrice: number;
  /** log of the current annualised vol */
  private logVol: number;
  private logVolMean: number;
  /** AR(1) microstructure state, in bps */
  private micro = 0;
  private lastPrice: number;

  constructor(config: Partial<SimConfig> = {}) {
    this.cfg = { ...DEFAULT_SIM_CONFIG, ...config };
    this.rng = new Rng(this.cfg.seed || undefined);
    this.logPrice = Math.log(this.cfg.startPrice);
    this.logVolMean = Math.log(this.cfg.annualVol);
    this.logVol = this.logVolMean;
    this.lastPrice = this.cfg.startPrice;
  }

  /** Current annualised volatility of the process. Drives the live odds. */
  get vol(): number {
    return Math.exp(this.logVol);
  }

  get price(): number {
    return this.lastPrice;
  }

  setVol(annualVol: number) {
    this.cfg.annualVol = annualVol;
    this.logVolMean = Math.log(annualVol);
    // Nudge current vol toward the new regime instead of snapping, so a
    // settings change does not put a discontinuity in the tape.
    this.logVol = this.logVol * 0.35 + this.logVolMean * 0.65;
  }

  reseed(seed: number, startPrice = this.lastPrice) {
    this.rng = new Rng(seed || undefined);
    this.logPrice = Math.log(startPrice);
    this.logVol = this.logVolMean;
    this.micro = 0;
    this.lastPrice = startPrice;
  }

  /** Advance the process by `dtMs` milliseconds and return the new price. */
  step(dtMs: number): number {
    const dt = Math.max(1, Math.min(dtMs, 5_000)) / 1000; // seconds
    const cfg = this.cfg;

    // --- stochastic volatility (OU on log-vol) -----------------------------
    const dtDays = dt / 86_400;
    this.logVol +=
      cfg.volMeanReversion * (this.logVolMean - this.logVol) * dtDays +
      cfg.volOfVol * Math.sqrt(dtDays) * this.rng.normal();
    // Keep vol in a sane band: 15% to 400% of the configured regime.
    this.logVol = clamp(
      this.logVol,
      this.logVolMean + Math.log(0.15),
      this.logVolMean + Math.log(4),
    );

    const sigma = Math.exp(this.logVol);
    const sqrtDt = Math.sqrt(dt / SECONDS_PER_YEAR);
    const stepSigma = sigma * sqrtDt;

    // --- diffusion ---------------------------------------------------------
    this.logPrice +=
      (cfg.drift - 0.5 * sigma * sigma) * (dt / SECONDS_PER_YEAR) +
      stepSigma * this.rng.normal();

    // --- jumps -------------------------------------------------------------
    const jumpProb = (cfg.jumpsPerHour * dt) / 3600;
    if (this.rng.chance(jumpProb)) {
      this.logPrice += stepSigma * cfg.jumpSize * this.rng.normal();
    }

    // --- microstructure ----------------------------------------------------
    // AR(1) with a ~1.2s half-life: bid/ask bounce and thin-book noise that
    // reverts rather than accumulating into the trend.
    const decay = Math.exp(-dt / 1.7);
    this.micro =
      this.micro * decay + cfg.microBps * Math.sqrt(1 - decay * decay) * this.rng.normal();

    const price = Math.exp(this.logPrice) * (1 + this.micro / 10_000);
    // Exchanges quote to the cent; rounding here is what gives the tape its
    // discrete steps at high zoom.
    this.lastPrice = Math.round(price * 100) / 100;
    return this.lastPrice;
  }
}
