import { describe, expect, it } from 'vitest';
import { normCdf } from '../lib/math';
import {
  CAL_K,
  CAL_SECONDS,
  TOUCH_HORIZONS,
  TOUCH_SHIFT,
  touchProbabilityAt,
  touchSamples,
  fairProbability,
  volInflation,
  volRatioOf,
  inflationCi,
  calibrationSamples,
} from './calibration';

describe('the recalibrated price', () => {
  it('is a coherent pair of probabilities', () => {
    // The failure of the model this replaced: it put Up at 30% and Down at
    // 70% together at 101.16%. Two sides of one market have to sum to one.
    for (const p of [0.005, 0.03, 0.1, 0.25, 0.4, 0.49, 0.5, 0.6, 0.8, 0.97]) {
      for (const s of [10, 45, 300, 900]) {
        expect(fairProbability(p, s, 1) + fairProbability(1 - p, s, 1)).toBeCloseTo(1, 9);
      }
    }
  });

  it('leaves an even-money price exactly alone', () => {
    for (const s of [5, 60, 600]) {
      for (const r of [0.2, 1, 3]) {
        expect(fairProbability(0.5, s, r)).toBeCloseTo(0.5, 8);
      }
    }
  });

  it('says long shots are underpriced and favourites are dear', () => {
    for (const s of [15, 60, 240]) {
      for (const p of [0.02, 0.1, 0.3]) {
        expect(fairProbability(p, s, 1)).toBeGreaterThan(p);
        expect(fairProbability(1 - p, s, 1)).toBeLessThan(1 - p);
      }
    }
  });

  it('is monotone in the quote', () => {
    let prev = -1;
    for (let p = 0.01; p < 1; p += 0.01) {
      const f = fairProbability(p, 30, 1);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('never leaves the unit interval, whatever it is handed', () => {
    for (const p of [0, 1, -5, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = fairProbability(p, 30, 1);
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    // A broken state must price as a loser, never as free money.
    expect(fairProbability(Number.NaN, 30, 1)).toBe(0);
  });
});

describe('the volatility multiplier', () => {
  it('is largest when the tape is calm and the clock is short', () => {
    // Both directions of the mechanism: a fixed microstructure bounce is a
    // bigger share of a small move, and of a short window.
    expect(volInflation(15, 0.25)).toBeGreaterThan(volInflation(15, 3));
    expect(volInflation(15, 0.25)).toBeGreaterThan(volInflation(900, 0.25));
  });

  it('is above 1 everywhere the measurement is dense', () => {
    for (const s of [15, 30, 60, 120]) {
      for (const r of [0.3, 0.5, 0.9, 1.4, 2.5]) {
        expect(volInflation(s, r)).toBeGreaterThan(1);
      }
    }
  });

  it('interpolates between measured cells rather than jumping', () => {
    const a = volInflation(15, 1);
    const b = volInflation(30, 1);
    const mid = volInflation(21, 1);
    expect(mid).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
  });

  it('holds still outside the range it was measured over', () => {
    expect(volInflation(1, 1)).toBe(volInflation(CAL_SECONDS[0], 1));
    expect(volInflation(9_999, 1)).toBe(volInflation(CAL_SECONDS[CAL_SECONDS.length - 1], 1));
  });

  it('carries its own interval and sample count', () => {
    expect(inflationCi(30, 1)).toBeGreaterThan(0);
    expect(calibrationSamples(30, 1)).toBeGreaterThan(0);
  });

  it('has a table the right shape', () => {
    expect(CAL_K).toHaveLength(CAL_SECONDS.length);
    for (const row of CAL_K) expect(row).toHaveLength(CAL_K[0].length);
  });
});

describe('volRatioOf', () => {
  it('is the tape against its own long-run level', () => {
    expect(volRatioOf(0.2, 0.4)).toBeCloseTo(0.5, 12);
    expect(volRatioOf(0.4, 0.4)).toBeCloseTo(1, 12);
  });

  it('falls back to 1 rather than dividing by nothing', () => {
    expect(volRatioOf(0.4, 0)).toBe(1);
    expect(volRatioOf(0, 0.4)).toBe(1);
  });
});

describe('the measured touch probability', () => {
  it('undercuts the textbook formula on a moving tape', () => {
    // The reflection principle watches the level continuously. The app looks
    // once a second, so a cross that comes straight back is not a flip, and
    // the formula promises flips that never register. On a wild tape that is
    // the whole story and the formula is too high everywhere.
    for (const h of [15, 30, 60]) {
      for (const z of [0.25, 0.5, 1, 1.5, 2]) {
        expect(touchProbabilityAt(z, h, 2.5)).toBeLessThan(2 * normCdf(-z));
      }
    }
  });

  it('exceeds it on a calm tape, where the noise floor and jumps dominate', () => {
    // The other mechanism, and it wins outright when the diffusion is small:
    // a fixed microstructure bounce and the odd jump reach the level far more
    // often than a lognormal of that width would.
    for (const h of [15, 60, 240]) {
      for (const z of [0.25, 1, 2, 3]) {
        expect(touchProbabilityAt(z, h, 0.3)).toBeGreaterThan(2 * normCdf(-z));
      }
    }
  });

  it('has the two effects trading off, not one masking the other', () => {
    // At normal volatility the discrete check wins near the target and the
    // fat tail wins far out, so the correction changes sign across z.
    expect(touchProbabilityAt(0.25, 60, 1)).toBeLessThan(2 * normCdf(-0.25));
    expect(touchProbabilityAt(3, 60, 1)).toBeGreaterThan(2 * normCdf(-3));
  });

  it('recovers the known continuity correction where the theory applies', () => {
    // For a discretely watched barrier the level effectively sits further away
    // by 0.5826 * sigma * sqrt(dt) — a standard result. In the cells where the
    // tape is closest to plain diffusion the fitted shift lands on it.
    for (const [i, h] of TOUCH_HORIZONS.entries()) {
      const theory = 0.5826 * Math.sqrt(1 / h);
      const fitted = TOUCH_SHIFT[i][TOUCH_SHIFT[i].length - 1];
      expect(Math.abs(fitted - theory)).toBeLessThan(0.005);
    }
  });

  it('is a probability, monotone in the distance to the level', () => {
    for (const h of [15, 60, 240]) {
      for (const r of [0.3, 1, 2.5]) {
        let prev = 2;
        for (let z = 0; z < 5; z += 0.05) {
          const p = touchProbabilityAt(z, h, r);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          expect(p).toBeLessThanOrEqual(prev + 1e-12);
          prev = p;
        }
      }
    }
  });

  it('reads the same either side of the level', () => {
    for (const z of [0.4, 1.2, 2.5]) {
      expect(touchProbabilityAt(z, 60, 1)).toBe(touchProbabilityAt(-z, 60, 1));
    }
  });

  it('carries the sample count behind it', () => {
    expect(touchSamples(60, 1)).toBeGreaterThan(1_000_000);
  });
});
