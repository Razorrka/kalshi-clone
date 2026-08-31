import { describe, expect, it } from 'vitest';
import {
  HOUSE_EDGE,
  displayPercents,
  limitFills,
  markToMarket,
  multiplierAtCents,
  multiplierFor,
  probUp,
  sideCents,
} from './odds';

const MIN = 60_000;

describe('probUp', () => {
  it('is a coin flip when the price sits exactly on the target', () => {
    // Slightly under 0.5: the -sigma^2/2 drift term in d2 is a real effect,
    // not a rounding artifact, but it is tiny over fifteen minutes.
    const p = probUp(78_000, 78_000, 0.4, 15 * MIN);
    expect(p).toBeLessThan(0.5);
    expect(p).toBeGreaterThan(0.499);
  });

  it('rises with the price and falls with distance below the target', () => {
    const args = [0.4, 15 * MIN] as const;
    const below = probUp(77_800, 78_000, ...args);
    const at = probUp(78_000, 78_000, ...args);
    const above = probUp(78_200, 78_000, ...args);
    expect(below).toBeLessThan(at);
    expect(at).toBeLessThan(above);
  });

  it('converges to certainty as the round runs out', () => {
    const wide = probUp(78_100, 78_000, 0.4, 15 * MIN);
    const narrow = probUp(78_100, 78_000, 0.4, 30_000);
    const done = probUp(78_100, 78_000, 0.4, 0);
    // Same $100 lead prices higher the less time is left to give it back.
    expect(narrow).toBeGreaterThan(wide);
    expect(done).toBe(1);
    expect(probUp(77_900, 78_000, 0.4, 0)).toBe(0);
  });

  it('settles a tie as Down', () => {
    expect(probUp(78_000, 78_000, 0.4, 0)).toBe(0);
  });

  it('prices a bigger move as less likely at higher distance-to-vol ratio', () => {
    const calm = probUp(78_200, 78_000, 0.1, 5 * MIN);
    const wild = probUp(78_200, 78_000, 1.2, 5 * MIN);
    // With little volatility a $200 lead is nearly safe; with a lot it is not.
    expect(calm).toBeGreaterThan(0.95);
    expect(wild).toBeLessThan(calm);
  });

  it('stays inside [0, 1] for extreme inputs', () => {
    for (const spot of [1, 78_000, 5_000_000]) {
      for (const vol of [0.01, 0.4, 5]) {
        for (const left of [0, 1, 60_000, 3_600_000]) {
          const p = probUp(spot, 78_000, vol, left);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          expect(Number.isFinite(p)).toBe(true);
        }
      }
    }
  });
});

describe('multiplierFor', () => {
  it('quotes the reference ladder', () => {
    // The screenshot this was built from shows 49% paying 1.93x.
    expect(multiplierFor(0.49)).toBeCloseTo(1.94, 2);
    expect(multiplierFor(0.5)).toBeCloseTo(1.9, 2);
    expect(multiplierFor(0.25)).toBeCloseTo(3.7, 2);
  });

  it('takes the edge out of winnings, never the stake', () => {
    // Expected value per $1 is (1 - edge) on the winnings portion only, so it
    // approaches $1 as the outcome approaches certainty.
    for (const p of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      const ev = p * multiplierFor(p);
      expect(ev).toBeLessThan(1);
      expect(ev).toBeCloseTo(1 - HOUSE_EDGE * (1 - p), 6);
    }
  });

  it('never pays less than the stake back', () => {
    for (const p of [0.999, 0.99, 0.5, 0.001]) {
      expect(multiplierFor(p)).toBeGreaterThanOrEqual(1.01);
    }
  });

  it('agrees with the percentage shown beside it', () => {
    // A side displayed at 1% must pay what 1% is worth: the multiplier clamp
    // and the display clamp are the same band.
    const { up } = displayPercents(0.001);
    expect(up).toBe(1);
    expect(multiplierFor(0.001)).toBeCloseTo(multiplierFor(0.01), 6);
    expect(multiplierFor(0.01)).toBeCloseTo(1 + 99 * (1 - HOUSE_EDGE), 6);
  });

  it('is monotonically decreasing in probability', () => {
    let prev = Infinity;
    for (let p = 0.02; p < 0.99; p += 0.01) {
      const m = multiplierFor(p);
      expect(m).toBeLessThan(prev);
      prev = m;
    }
  });
});

describe('displayPercents', () => {
  it('always sums to 100', () => {
    for (let i = 0; i <= 100; i++) {
      const { up, down } = displayPercents(i / 100);
      expect(up + down).toBe(100);
    }
  });

  it('never shows a market as 0% or 100%', () => {
    expect(displayPercents(0)).toEqual({ up: 1, down: 99 });
    expect(displayPercents(1)).toEqual({ up: 99, down: 1 });
  });
});

describe('markToMarket', () => {
  it('values a ticket at its payout times the chance of getting it', () => {
    // $10 at 2x pays $20 if it lands; at a 60% chance that is worth $12.
    expect(markToMarket(10, 2, 0.6)).toBeCloseTo(12, 10);
    expect(markToMarket(10, 2, 1)).toBeCloseTo(20, 10);
    expect(markToMarket(10, 2, 0)).toBe(0);
  });

  it('is worth slightly less than the stake the moment it is opened', () => {
    // The entry spread is the house edge on the losing side of the payout.
    for (const p of [0.2, 0.5, 0.8]) {
      const m = multiplierFor(p);
      const value = markToMarket(100, m, p);
      expect(value).toBeLessThan(100);
      expect(value).toBeCloseTo(100 * (1 - HOUSE_EDGE * (1 - p)), 6);
    }
  });

  it('leaves no arbitrage in closing both sides at once', () => {
    // Buying both sides and cashing out immediately must never profit.
    for (const p of [0.1, 0.35, 0.5, 0.77, 0.95]) {
      const up = markToMarket(50, multiplierFor(p), p);
      const down = markToMarket(50, multiplierFor(1 - p), 1 - p);
      expect(up + down).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('tracks the probability, so P&L moves with the price', () => {
    const m = multiplierFor(0.5);
    const worse = markToMarket(20, m, 0.3);
    const same = markToMarket(20, m, 0.5);
    const better = markToMarket(20, m, 0.7);
    expect(worse).toBeLessThan(same);
    expect(same).toBeLessThan(better);
  });
});

describe('limit orders', () => {
  it('fills a buy only at its price or cheaper', () => {
    expect(limitFills(45, 45)).toBe(true);
    expect(limitFills(40, 45)).toBe(true);
    expect(limitFills(46, 45)).toBe(false);
  });

  it('quotes each side out of 100 cents', () => {
    expect(sideCents('up', 0.62)).toBe(62);
    expect(sideCents('down', 0.62)).toBe(38);
    expect(sideCents('up', 0)).toBe(1);
    expect(sideCents('up', 1)).toBe(99);
  });

  it('pays a bigger multiplier for a cheaper fill', () => {
    expect(multiplierAtCents(20)).toBeGreaterThan(multiplierAtCents(50));
    expect(multiplierAtCents(50)).toBeGreaterThan(multiplierAtCents(80));
    expect(multiplierAtCents(50)).toBeCloseTo(multiplierFor(0.5), 10);
  });
});
