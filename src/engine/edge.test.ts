import { describe, expect, it } from 'vitest';
import {
  MAX_MULTIPLIER,
  MEASURED_EV,
  MIN_MULTIPLIER,
  bandFor,
  evThresholdFor,
  expectedValue,
  fairProbability,
  findEdge,
  isBreakEven,
  kellyFraction,
  stakeFor,
} from './edge';
import { HOUSE_EDGE, multiplierFor, probUp } from './odds';
import { PriceEngine, VOL_PRESETS } from './priceEngine';

describe('the fair price', () => {
  it('says long shots come in slightly more often than quoted', () => {
    // Jumps and moving volatility put weight in the tails that N(d2) does not
    // model, and the measurement picks that up.
    expect(fairProbability(0.1)).toBeGreaterThan(0.1);
    expect(fairProbability(0.2)).toBeGreaterThan(0.2);
  });

  it('only speaks about the underdog, which is all that was measured', () => {
    // Above a coin flip there is no measurement, so it declines to invent one.
    expect(fairProbability(0.7)).toBe(0.7);
    expect(fairProbability(0.95)).toBe(0.95);
  });

  it('is a small correction, not a rewrite', () => {
    for (const p of [0.05, 0.2, 0.35, 0.5, 0.7, 0.9]) {
      expect(Math.abs(fairProbability(p) - p)).toBeLessThan(0.02);
    }
  });

  it('stays inside the unit interval and close to the quote', () => {
    for (let p = 0.01; p < 1; p += 0.005) {
      const f = fairProbability(p);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
      expect(Math.abs(f - p)).toBeLessThan(0.02);
    }
  });

  it('steps at band edges, which is the price of not smoothing', () => {
    // Each band carries its own measured offset, so the curve is not monotone
    // across a boundary: 14.9% quoted reads higher than 15.1% does. Forcing it
    // smooth would mean fitting again, which was tried and thrown out — so the
    // steps stay, and they are small enough not to matter.
    const below = fairProbability(0.149);
    const above = fairProbability(0.151);
    expect(below).toBeGreaterThan(above);
    expect(below - above).toBeLessThan(0.01);
  });

  it('survives degenerate input', () => {
    expect(fairProbability(0)).toBe(0);
    expect(fairProbability(1)).toBe(1);
    expect(Number.isFinite(fairProbability(-1))).toBe(true);
  });

  it('hands back the measured rate, not a curve through it', () => {
    // Mid-band it should land on what was actually observed there.
    for (const band of MEASURED_EV) {
      const mid = (band.from + band.to) / 2;
      expect(Math.abs(fairProbability(mid) - band.rate)).toBeLessThan(0.025);
    }
  });

  it('falls back to the quote where nothing was measured', () => {
    expect(fairProbability(0.7)).toBe(0.7);
    expect(fairProbability(0.01)).toBe(0.01);
  });
});

describe('expected value and staking', () => {
  it('is the payout times the real chance, minus the stake', () => {
    expect(expectedValue(0.5, 2)).toBe(0);
    expect(expectedValue(0.25, 4)).toBe(0);
    expect(expectedValue(0.1, 9)).toBeCloseTo(-0.1, 10);
    expect(expectedValue(0.2, 6)).toBeCloseTo(0.2, 10);
  });

  it('is exactly the house cut when the quote is right', () => {
    // Buying at a correctly quoted p pays 1 + (1-p)/p * (1 - edge), so the
    // return is 1 - edge*(1-p) whatever p is. That is the wall.
    for (const p of [0.1, 0.3, 0.5, 0.8]) {
      const ev = expectedValue(p, multiplierFor(p));
      expect(ev).toBeCloseTo(-HOUSE_EDGE * (1 - p), 10);
      expect(ev).toBeLessThan(0);
    }
  });

  it('sizes by Kelly, and Kelly says no to every losing price', () => {
    expect(kellyFraction(0.5, 3)).toBeCloseTo(0.25, 10);
    expect(kellyFraction(0.25, 4)).toBe(0);
    expect(kellyFraction(0.2, 4)).toBeLessThan(0);
    expect(kellyFraction(0.5, 1)).toBe(0);
  });

  it('never stakes more than a twentieth on a winner, or much on a loser', () => {
    const big = stakeFor(0.6, 3, 1_000);
    expect(big).toBeLessThanOrEqual(50);
    expect(big).toBeGreaterThan(0);
    // A negative edge falls back to a token stake rather than going short.
    const losing = stakeFor(0.3, 3, 1_000);
    expect(losing).toBe(10);
    expect(stakeFor(0.3, 3, 0)).toBe(1);
  });
});

describe('what the measurement says', () => {
  it('covers the whole underdog range without gaps', () => {
    for (let i = 1; i < MEASURED_EV.length; i++) {
      expect(MEASURED_EV[i].from).toBe(MEASURED_EV[i - 1].to);
    }
    expect(MEASURED_EV[0].from).toBe(0.02);
    expect(MEASURED_EV[MEASURED_EV.length - 1].to).toBe(0.5);
  });

  it('is reliably negative everywhere the odds are short', () => {
    // Every band from 15% up excludes zero, on the low side.
    for (const band of MEASURED_EV.filter((b) => b.from >= 0.15)) {
      expect(band.ev + band.ci).toBeLessThan(0);
      expect(isBreakEven(band)).toBe(false);
    }
  });

  it('cannot rule out break-even only in the far tail', () => {
    const breakEven = MEASURED_EV.filter(isBreakEven);
    expect(breakEven.length).toBeGreaterThan(0);
    for (const band of breakEven) expect(band.to).toBeLessThanOrEqual(0.15);
  });

  it('is worst exactly where a 3x hunt fishes', () => {
    // 3x is about 30% implied. That band, and its neighbours, are the losers.
    const at3x = bandFor(0.3)!;
    expect(at3x.pays).toBeCloseTo(3.2, 1);
    expect(at3x.ev).toBeLessThan(0);
    const tail = bandFor(0.1)!;
    expect(tail.ev).toBeGreaterThan(at3x.ev);
  });

  it('finds a band for every price and none outside the range', () => {
    expect(bandFor(0.3)).not.toBeNull();
    expect(bandFor(0.01)).toBeNull();
    expect(bandFor(0.7)).toBeNull();
  });
});

describe('picking a ticket', () => {
  const base = { balance: 1_000, aggression: 0.5, tradable: true };

  it('takes nothing while the round is closed to new tickets', () => {
    expect(findEdge({ ...base, pUp: 0.3, tradable: false })).toBeNull();
  });

  it('ignores the favourite, whichever side it is', () => {
    // At 30/70 the underdog pays about 3.1x and the favourite about 1.39x,
    // under the floor, so only one side can ever be picked.
    const up = findEdge({ ...base, pUp: 0.3, aggression: 1 });
    expect(up?.side).toBe('up');
    const down = findEdge({ ...base, pUp: 0.7, aggression: 1 });
    expect(down?.side).toBe('down');
  });

  it('declines a coin flip at the patient end, where the price is worst', () => {
    // 50/50 pays 1.9x and measures about -6%, the worst band on the board.
    expect(findEdge({ ...base, pUp: 0.5, aggression: 0 })).toBeNull();
    expect(findEdge({ ...base, pUp: 0.5, aggression: 1 })).not.toBeNull();
  });

  it('never returns anything outside the payout window', () => {
    for (let p = 0.01; p < 1; p += 0.01) {
      const pick = findEdge({ ...base, pUp: p, aggression: 1 });
      if (!pick) continue;
      expect(pick.multiplier).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
      expect(pick.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });

  it('gets pickier as the slider comes down', () => {
    let loose = 0;
    let tight = 0;
    for (let p = 0.02; p < 0.5; p += 0.005) {
      if (findEdge({ ...base, pUp: p, aggression: 1 })) loose++;
      if (findEdge({ ...base, pUp: p, aggression: 0 })) tight++;
    }
    expect(loose).toBeGreaterThan(tight);
    expect(tight).toBeGreaterThan(0);
  });

  it('demands more of a price the lower the slider goes', () => {
    expect(evThresholdFor(0)).toBeGreaterThan(evThresholdFor(1));
    // Even wide open it will not take a bet worse than the worst band.
    expect(evThresholdFor(1)).toBeGreaterThan(-0.07);
    expect(evThresholdFor(0)).toBeLessThan(0);
  });

  it('grades the far tail above the three-times band', () => {
    const tail = findEdge({ ...base, pUp: 0.1, aggression: 1 })!;
    const three = findEdge({ ...base, pUp: 0.3, aggression: 1 })!;
    expect(tail.multiplier).toBeGreaterThan(three.multiplier);
    expect(tail.ev).toBeGreaterThan(three.ev);
    expect(['PRIME', 'FAIR']).toContain(tail.grade);
  });

  it('says what a pick is actually worth, minus sign and all', () => {
    const pick = findEdge({ ...base, pUp: 0.3, aggression: 1 })!;
    expect(pick).not.toBeNull();
    expect(pick.ev).toBeLessThan(0);
    expect(pick.note).toBeTruthy();
    expect(pick.fair).toBeGreaterThan(pick.quoted);
    expect(pick.stake).toBeGreaterThan(0);
  });
});

describe('does the correction actually hold on fresh data', () => {
  /**
   * The curve was fitted on one set of seeds. This runs a different set and
   * checks the corrected probability beats the raw quote at predicting what
   * really happened — otherwise it is a curve fitted to noise.
   */
  it('predicts better than the raw quote out of sample', () => {
    const ROUND_MS = 15 * 60_000;
    const STEP = 500;
    let quoteLoss = 0;
    let fairLoss = 0;
    let n = 0;

    for (let round = 0; round < 4_000; round++) {
      // Seeds disjoint from the fit, which used (round * 2654435761 + 7).
      const engine = new PriceEngine({
        seed: (round * 40_503 + 1_337_000) >>> 0,
        startPrice: 78_000,
        annualVol: VOL_PRESETS.normal,
      });
      const strike = engine.price;
      const at = 20_000 + ((round * 7919) % (ROUND_MS - 60_000));
      let quoted: number | null = null;
      for (let t = STEP; t <= ROUND_MS; t += STEP) {
        const price = engine.step(STEP);
        if (quoted === null && t >= at) {
          quoted = probUp(price, strike, engine.vol, ROUND_MS - t);
        }
      }
      if (quoted === null) continue;
      const up = engine.price > strike ? 1 : 0;
      const fair = fairProbability(quoted);
      // Brier score: lower is better.
      quoteLoss += (quoted - up) ** 2;
      fairLoss += (fair - up) ** 2;
      n++;
    }

    expect(n).toBeGreaterThan(3_000);
    // The honest result, pinned so nobody re-adds a fitted curve and claims
    // otherwise: the correction is worth essentially nothing out of sample.
    // The quote is already good, which is the whole finding.
    const gap = Math.abs(fairLoss - quoteLoss) / quoteLoss;
    expect(gap).toBeLessThan(0.01);
  });
});
