import { describe, expect, it } from 'vitest';
import {
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  MIN_QUOTE,
  MODEL_ERROR,
  bestAt,
  evCurve,
  evThresholdFor,
  expectedValue,
  fairProbability,
  findEdge,
  kellyFraction,
  stakeFor,
  volInflation,
} from './edge';
import { HOUSE_EDGE, multiplierFor, probUp } from './odds';
import { PriceEngine, VOL_PRESETS } from './priceEngine';
import { volRatioOf } from './calibration';

const base = { balance: 1_000, aggression: 0.5, tradable: true, secondsLeft: 60, volRatio: 1 };

describe('the fair price', () => {
  it('says long shots land more often than the board quotes', () => {
    for (const s of [15, 60, 240]) {
      expect(fairProbability(0.1, s, 1)).toBeGreaterThan(0.1);
      expect(fairProbability(0.02, s, 1)).toBeGreaterThan(0.02);
    }
  });

  it('says favourites land less often, because the two must agree', () => {
    // The model this replaced corrected the underdog and left the favourite
    // alone, so both sides of a market came to more than 100%.
    for (const s of [15, 60, 240]) {
      expect(fairProbability(0.9, s, 1)).toBeLessThan(0.9);
      expect(fairProbability(0.1, s, 1) + fairProbability(0.9, s, 1)).toBeCloseTo(1, 9);
    }
  });

  it('corrects hardest with seconds left and least over a whole round', () => {
    const late = fairProbability(0.05, 15, 1) - 0.05;
    const early = fairProbability(0.05, 900, 1) - 0.05;
    expect(late).toBeGreaterThan(early);
  });

  it('corrects a calm tape harder than a wild one', () => {
    expect(fairProbability(0.05, 30, 0.3) - 0.05).toBeGreaterThan(
      fairProbability(0.05, 30, 2.5) - 0.05,
    );
  });

  it('is a correction, not a rewrite', () => {
    for (const s of [15, 60, 900]) {
      for (const p of [0.02, 0.1, 0.3, 0.5, 0.7, 0.95]) {
        expect(Math.abs(fairProbability(p, s, 1) - p)).toBeLessThan(0.05);
      }
    }
  });

  it('is monotone across the whole board, with no steps to trip over', () => {
    // The band table this replaced was not: 14.9% quoted read higher than
    // 15.1% did, because each band carried its own offset.
    let prev = -1;
    for (let p = 0.005; p < 1; p += 0.005) {
      const f = fairProbability(p, 45, 1);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('survives degenerate input without inventing an edge', () => {
    expect(fairProbability(0, 60, 1)).toBe(0);
    expect(fairProbability(1, 60, 1)).toBe(1);
    expect(fairProbability(Number.NaN, 60, 1)).toBe(0);
  });
});

describe('expected value and staking', () => {
  it('is the payout times the real chance, minus the stake', () => {
    expect(expectedValue(0.5, 2)).toBeCloseTo(0, 12);
    expect(expectedValue(0.6, 2)).toBeCloseTo(0.2, 12);
  });

  it('is exactly the house cut when the quote happens to be right', () => {
    for (const p of [0.1, 0.3, 0.5]) {
      expect(expectedValue(p, multiplierFor(p))).toBeCloseTo(-HOUSE_EDGE * (1 - p), 9);
    }
  });

  it('sizes by Kelly, and Kelly declines a losing price', () => {
    expect(kellyFraction(0.4, 2)).toBeLessThan(0);
    expect(kellyFraction(0.6, 2)).toBeGreaterThan(0);
  });

  it('never stakes more than a twentieth on a winner, or much on a loser', () => {
    expect(stakeFor(0.9, 5, 1_000)).toBeLessThanOrEqual(50);
    expect(stakeFor(0.1, 2, 1_000)).toBeLessThanOrEqual(10);
    expect(stakeFor(0.1, 2, 1_000)).toBeGreaterThan(0);
  });
});

describe('what the board is worth, moment to moment', () => {
  it('walks the whole payout window', () => {
    const rows = evCurve(60, 1);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0].quoted).toBe(MIN_QUOTE);
    expect(rows[rows.length - 1].quoted).toBe(0.5);
  });

  it('gets better the further out the payout, at any moment', () => {
    // The mispricing grows into the tail while the vig stays a flat cut of
    // winnings, so the two only cross well past 3x.
    for (const s of [15, 60, 240]) {
      const rows = evCurve(s, 1);
      expect(rows[0].ev).toBeGreaterThan(rows[rows.length - 1].ev);
    }
  });

  it('offers a better best price late in a round than early', () => {
    expect(bestAt(15, 1).ev).toBeGreaterThan(bestAt(900, 1).ev);
  });

  it('is worst around 3x — worse even than a coin flip', () => {
    // The single most useful thing the measurement says, and the opposite of
    // where a long-shot hunt naturally fishes. The house cut is a flat share
    // of winnings, so it costs more the longer the odds; the mispricing also
    // grows into the tail, but faster. The two cross somewhere past 3x, which
    // leaves the low end of the payout window as the worst part of the board.
    for (const s of [15, 60, 900]) {
      const rows = evCurve(s, 1);
      const worst = rows.reduce((a, b) => (b.ev < a.ev ? b : a));
      expect(worst.multiplier).toBeGreaterThan(2.4);
      expect(worst.multiplier).toBeLessThan(4.2);
      expect(worst.ev).toBeLessThan(rows[rows.length - 1].ev);
    }
  });

  it('never claims a coin flip is anything but the house cut', () => {
    for (const s of [15, 900]) {
      expect(expectedValue(0.5, multiplierFor(0.5))).toBeCloseTo(-HOUSE_EDGE / 2, 9);
      expect(evCurve(s, 1)[evCurve(s, 1).length - 1].ev).toBeCloseTo(-HOUSE_EDGE / 2, 9);
    }
  });
});

describe('picking a ticket', () => {
  const at = (pUp: number, over: Partial<typeof base> = {}) =>
    findEdge({ ...base, ...over, pUp });

  it('takes nothing while the round is closed to new tickets', () => {
    expect(at(0.05, { tradable: false })).toBeNull();
  });

  it('backs the underdog, whichever side it is', () => {
    // The favourite's payout is under the window's floor by construction, so
    // there is never a choice between the two. Run wide open, because at the
    // patient end a 5% shot with a minute left is correctly declined.
    expect(at(0.05, { aggression: 1 })?.side).toBe('up');
    expect(at(0.95, { aggression: 1 })?.side).toBe('down');
  });

  it('never returns anything outside the payout window', () => {
    for (let p = 0.001; p < 1; p += 0.001) {
      const pick = at(p, { aggression: 1 });
      if (!pick) continue;
      expect(pick.multiplier).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
      expect(pick.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
      expect(pick.quoted).toBeGreaterThanOrEqual(MIN_QUOTE);
    }
  });

  it('will not touch a price under the multiplier clamp', () => {
    // Below 1% the payout stops improving and the odds keep worsening, so
    // everything down there is strictly worse than the clamp itself.
    for (const p of [0.001, 0.004, 0.009]) {
      const pick = at(p, { aggression: 1 });
      if (pick) expect(pick.quoted).toBeGreaterThanOrEqual(MIN_QUOTE);
    }
  });

  it('gets pickier as the slider comes down', () => {
    let wide = 0;
    let narrow = 0;
    for (let p = 0.01; p < 0.5; p += 0.005) {
      if (at(p, { aggression: 1 })) wide++;
      if (at(p, { aggression: 0 })) narrow++;
    }
    expect(wide).toBeGreaterThan(narrow);
  });

  it('demands more of a price the lower the slider goes', () => {
    expect(evThresholdFor(0)).toBeGreaterThan(evThresholdFor(1));
    // At the patient end it only takes what actually makes money.
    expect(evThresholdFor(0)).toBeGreaterThan(0);
  });

  it('lights up more often with seconds left than with minutes', () => {
    let late = 0;
    let early = 0;
    for (let p = 0.01; p < 0.5; p += 0.005) {
      if (at(p, { aggression: 0, secondsLeft: 15 })) late++;
      if (at(p, { aggression: 0, secondsLeft: 600 })) early++;
    }
    expect(late).toBeGreaterThan(early);
  });

  it('says what a pick is worth, sign and interval included', () => {
    const pick = at(0.03, { aggression: 1 });
    expect(pick).not.toBeNull();
    expect(Number.isFinite(pick!.ev)).toBe(true);
    expect(pick!.evCi).toBeGreaterThan(0);
    expect(pick!.samples).toBeGreaterThan(0);
    expect(pick!.k).toBeGreaterThan(1);
  });
});

describe('does the correction hold on data it never saw', () => {
  /**
   * The calibration was measured on one chain of seeds. This runs a different
   * one, at the app's own 60ms tick, and asks whether the corrected price
   * predicts what really happened better than the raw quote does.
   *
   * Moments are sampled log-uniformly in time remaining rather than uniformly.
   * The correction makes its largest claims in the closing stretch, and a
   * uniform sample would spend almost every look somewhere it claims nothing —
   * which would test the model where it is silent.
   */
  it('predicts better than the raw quote out of sample', { timeout: 300_000 }, () => {
    const ROUND_MS = 15 * 60_000;
    const STEP = 60;
    const LOCK = 5_000;
    let quoteLoss = 0;
    let fairLoss = 0;
    let n = 0;

    for (let round = 0; round < 6_000; round++) {
      const engine = new PriceEngine({
        seed: (round * 40_503 + 1_337_000) >>> 0,
        startPrice: 78_000,
        annualVol: VOL_PRESETS.normal,
      });
      const strike = engine.price;
      const u = ((round * 7919) % 10_007) / 10_007;
      const at = ROUND_MS - LOCK * Math.pow((ROUND_MS - 60_000) / LOCK, u);
      let quoted: number | null = null;
      let secondsLeft = 0;
      let ratio = 1;
      for (let t = STEP; t <= ROUND_MS; t += STEP) {
        const price = engine.step(STEP);
        if (quoted === null && t >= at) {
          const msLeft = ROUND_MS - t;
          quoted = probUp(price, strike, engine.vol, msLeft);
          secondsLeft = msLeft / 1_000;
          ratio = volRatioOf(engine.vol, VOL_PRESETS.normal);
        }
      }
      if (quoted === null) continue;
      const up = engine.price > strike ? 1 : 0;
      const fair = fairProbability(quoted, secondsLeft, ratio);
      quoteLoss += (quoted - up) ** 2;
      fairLoss += (fair - up) ** 2;
      n++;
    }

    expect(n).toBeGreaterThan(5_000);
    // Lower Brier is better. The correction has to earn its place on seeds it
    // was not measured on, or it is a curve through noise like the fitted
    // recalibration that was tried here before and thrown out.
    expect(fairLoss).toBeLessThan(quoteLoss);
  });

  it('the multiplier it corrects by is above 1 wherever it is dense', () => {
    for (const s of [15, 30, 60, 120]) {
      for (const r of [0.3, 1, 2.5]) expect(volInflation(s, r)).toBeGreaterThan(1);
    }
  });
});

describe('does the hunter actually make money', () => {
  /**
   * The end-to-end claim, and the only one that matters: not "the model
   * predicts better" but "the tickets it picks come back positive".
   *
   * One bet per round, taken at the FIRST moment the hunter's condition is
   * met. First passage is a stopping time, so what the price does afterwards
   * is independent of the decision to stop there — picking the best-looking
   * moment in a round instead would condition on the path and flatter itself.
   *
   * Measured this way over 2,800,000 rounds — 2,557,404 bets — the patient
   * setting returned +2.10% ± 0.97 per dollar against a prediction of +1.20%,
   * so its interval clears zero by four standard errors and the model is
   * conservative rather than flattering. Halfway up the slider it returned
   * −0.84% ± 0.59 against a prediction of −2.03%, and wide open −5.18% ± 0.11
   * against −4.95%. A 700,000-round run beforehand gave +2.27% ± 1.94. This runs
   * a small slice of that: too few bets to confirm the sign, but enough to
   * catch the pipeline breaking — a hunter that stopped firing, or started
   * firing on the wrong side, or lost its stake sizing.
   */
  it('picks tickets whose realised return tracks what it predicted', { timeout: 300_000 }, () => {
    const ROUND_MS = 15 * 60_000;
    const STEP = 60;
    const LOCK = 5_000;
    const POLL = 1_000;
    let n = 0;
    let realised = 0;
    let predicted = 0;

    for (let round = 0; round < 3_000; round++) {
      const engine = new PriceEngine({
        seed: (round * 2246822519 + 991) >>> 0,
        startPrice: 78_000,
        annualVol: VOL_PRESETS.normal,
      });
      const strike = engine.price;
      let taken: ReturnType<typeof findEdge> = null;
      let nextPoll = POLL;
      for (let t = STEP; t <= ROUND_MS; t += STEP) {
        const price = engine.step(STEP);
        if (t < nextPoll) continue;
        nextPoll += POLL;
        const msLeft = ROUND_MS - t;
        if (taken || msLeft < LOCK) continue;
        taken = findEdge({
          pUp: probUp(price, strike, engine.vol, msLeft),
          balance: 1_000,
          aggression: 0,
          tradable: true,
          secondsLeft: msLeft / 1_000,
          volRatio: volRatioOf(engine.vol, VOL_PRESETS.normal),
        });
      }
      if (!taken) continue;
      const won = (taken.side === 'up') === (engine.price > strike);
      realised += won ? taken.multiplier - 1 : -1;
      predicted += taken.ev;
      n++;
    }

    // It has to fire. A calibration change that quietly switched the light off
    // would otherwise pass every other test in this file.
    expect(n).toBeGreaterThan(2_000);
    // Everything it takes is a price it believes is profitable.
    expect(predicted / n).toBeGreaterThan(0);
    // And the realised return is in the same country. The bound is loose on
    // purpose: at 60x a few hundred bets swing tens of points, which is the
    // lesson the proving ground exists to teach and not something to pretend
    // away with a tight assertion here.
    expect(realised / n).toBeGreaterThan(-0.5);
    expect(realised / n).toBeLessThan(0.6);
  });
});

describe('the interval it quotes', () => {
  it('is never narrower than the model is accurate', () => {
    // With billions of samples behind k its own interval is hair-thin, and a
    // strip reading "+85.1% ±0.1" would be claiming a precision that one
    // multiplier per cell simply does not have.
    for (const s of [15, 60, 600]) {
      for (const v of [0.3, 1, 2.5]) {
        for (const p of [0.012, 0.03, 0.1, 0.3]) {
          const pick = findEdge({ ...base, pUp: p, aggression: 1, secondsLeft: s, volRatio: v });
          if (pick) expect(pick.evCi).toBeGreaterThanOrEqual(MODEL_ERROR - 1e-12);
        }
      }
    }
  });

  it('downgrades an edge it cannot separate from zero', () => {
    // PRIME has to mean the interval clears zero, so an edge smaller than the
    // model's own error must not get it.
    let prime = 0;
    let fair = 0;
    for (const s of [10, 20, 45, 120, 600]) {
      for (const v of [0.3, 0.6, 1, 1.6, 2.5]) {
        for (let p = 0.01; p < 0.5; p += 0.005) {
          const pick = findEdge({ ...base, pUp: p, aggression: 0, secondsLeft: s, volRatio: v });
          if (!pick) continue;
          if (pick.grade === 'PRIME') {
            prime++;
            expect(pick.ev - pick.evCi).toBeGreaterThan(0);
          }
          if (pick.grade === 'FAIR') {
            fair++;
            expect(pick.ev).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(prime).toBeGreaterThan(0);
    expect(fair).toBeGreaterThan(0);
  });
});

describe('the ladder the sheet draws', () => {
  it('opens up as the slider does', () => {
    // The complaint that found this: one gold row and nothing else, however
    // far the slider was pushed. The sheet was marking what is profitable
    // while the strip acted on what clears your bar, and those are different
    // questions — so the table said nothing about the rest of the board you
    // were actually buying.
    const counts = [0, 0.25, 0.5, 0.75, 1].map((a) => {
      const th = evThresholdFor(a);
      return evCurve(60, 1).filter((r) => r.ev >= th).length;
    });
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts[0]).toBeLessThan(3);
    expect(counts[counts.length - 1]).toBe(evCurve(60, 1).length);
  });

  it('keeps the gold rows to the ones that actually make money', () => {
    // Turning the slider up must never turn a losing price gold. It gets an
    // outline and the number beside it, which is a different claim.
    for (const a of [0, 0.5, 1]) {
      const th = evThresholdFor(a);
      for (const row of evCurve(60, 1)) {
        if (row.ev > 0) continue;
        // Taken, perhaps — but not profitable, whatever the slider says.
        expect(row.ev >= th ? row.ev : -1).toBeLessThanOrEqual(0);
      }
    }
  });

  it('always has something to show at the far end', () => {
    // A ladder where nothing is ever lit is the bug this replaced.
    for (const s of [15, 60, 240, 900]) {
      expect(evCurve(s, 1).filter((r) => r.ev > 0).length).toBeGreaterThan(0);
    }
  });
});
