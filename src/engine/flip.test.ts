import { describe, expect, it } from 'vitest';
import {
  EMPTY_FEATURES,
  FLIP_HORIZON_MS,
  FLIP_WEIGHTS,
  FlipRolling,
  MEASURED_AUC,
  Rolling,
  SCORED_KEYS,
  changePoint,
  confidenceOf,
  contributions,
  dispersion,
  extractFlipFeatures,
  makeFlipSignal,
  matchHistory,
  reasonsFor,
  standardisedGap,
  touchProbability,
  type FlipFeatures,
  type FlipMemory,
} from './flip';
import { normCdf } from '../lib/math';
import { PriceEngine } from './priceEngine';
import type { Candle, Tick } from './types';

function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4_294_967_296;
  };
}

describe('the touch probability', () => {
  it('is certain when price is sitting on the target', () => {
    expect(touchProbability(0)).toBe(1);
  });

  it('is twice the chance of finishing beyond the level', () => {
    // The reflection principle, which is what makes this exact rather than a
    // fitted curve: paths that touch and finish above pair one-to-one with
    // paths that touch and finish below.
    for (const z of [0.25, 0.5, 1, 2, 3]) {
      expect(touchProbability(z)).toBeCloseTo(2 * normCdf(-z), 12);
    }
  });

  it('does not care which side of the target price is on', () => {
    for (const z of [0.4, 1.1, 2.6]) {
      expect(touchProbability(z)).toBe(touchProbability(-z));
    }
  });

  it('falls away as the leader gets clear, and stays a probability', () => {
    let prev = 1.1;
    for (const z of [0, 0.5, 1, 1.5, 2, 3, 6, 12]) {
      const p = touchProbability(z);
      expect(p).toBeLessThanOrEqual(prev);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
  });

  it('says a one-sigma lead is still a coin flip away from gone', () => {
    // Worth pinning as a number, because it is the whole point of the
    // feature: "comfortably ahead" is not comfortable.
    expect(touchProbability(1)).toBeCloseTo(0.317, 3);
    expect(touchProbability(2)).toBeCloseTo(0.046, 3);
  });

  it('matches what the price engine actually does', () => {
    const ANNUAL_VOL = 0.4;
    const HORIZON = 6 * 60_000;
    const sd = ANNUAL_VOL * Math.sqrt(HORIZON / 1000 / (365 * 24 * 60 * 60));

    for (const z of [0.5, 1, 2]) {
      let touched = 0;
      const trials = 900;
      for (let i = 0; i < trials; i++) {
        const engine = new PriceEngine({
          seed: (i * 2654435761 + z * 7919) >>> 0,
          startPrice: 78_000,
          annualVol: ANNUAL_VOL,
        });
        const strike = engine.price * Math.exp(-z * sd);
        for (let t = 0; t < HORIZON; t += 500) {
          if (engine.step(500) <= strike) {
            touched++;
            break;
          }
        }
      }
      // Wide enough for 900 trials and the engine's jumps, tight enough that
      // a wrong formula could not pass.
      expect(touched / trials).toBeCloseTo(touchProbability(z), 1);
    }
  });
});

describe('standardisedGap', () => {
  it('is zero on the target and signed by the side', () => {
    expect(standardisedGap(78_000, 78_000, 0.4, 600_000)).toBe(0);
    expect(standardisedGap(78_500, 78_000, 0.4, 600_000)).toBeGreaterThan(0);
    expect(standardisedGap(77_500, 78_000, 0.4, 600_000)).toBeLessThan(0);
  });

  it('grows as the clock runs down on the same dollar lead', () => {
    const early = standardisedGap(78_200, 78_000, 0.4, 10 * 60_000);
    const late = standardisedGap(78_200, 78_000, 0.4, 60_000);
    expect(late).toBeGreaterThan(early);
  });

  it('survives degenerate inputs', () => {
    expect(standardisedGap(0, 78_000, 0.4, 60_000)).toBe(0);
    expect(standardisedGap(78_000, 0, 0.4, 60_000)).toBe(0);
    expect(standardisedGap(78_100, 78_000, 0, 60_000)).toBe(0);
    expect(Number.isFinite(standardisedGap(78_100, 78_000, 0.4, 0))).toBe(true);
  });
});

describe('rolling statistics', () => {
  it('tracks mean and spread over its window', () => {
    const r = new Rolling(4);
    for (const v of [1, 2, 3, 4]) r.push(v);
    expect(r.count).toBe(4);
    expect(r.mean).toBe(2.5);
    expect(r.sd).toBeCloseTo(1.2909944, 6);
  });

  it('forgets past its window', () => {
    const r = new Rolling(3);
    for (const v of [100, 1, 2, 3]) r.push(v);
    expect(r.count).toBe(3);
    expect(r.mean).toBe(2);
  });

  it('claims nothing until it has seen enough', () => {
    const r = new Rolling(50);
    r.push(1);
    r.push(9);
    expect(r.z(100)).toBe(0);
  });

  it('reads an outlier once it has a window, and stays bounded', () => {
    const r = new Rolling(50);
    const next = xorshift32(11);
    for (let i = 0; i < 40; i++) r.push(next());
    expect(r.z(0.5)).toBeLessThan(1);
    expect(r.z(50)).toBe(4);
    expect(r.z(-50)).toBe(-4);
  });

  it('reads zero when nothing ever varies, rather than dividing by nothing', () => {
    const r = new Rolling(50);
    for (let i = 0; i < 30; i++) r.push(7);
    expect(r.z(7)).toBe(0);
    expect(r.z(99)).toBe(0);
  });

  it('ignores values that are not numbers', () => {
    const r = new Rolling(10);
    r.push(Number.NaN);
    r.push(Number.POSITIVE_INFINITY);
    expect(r.count).toBe(0);
  });
});

describe('change-point detection', () => {
  it('says nothing without two full windows', () => {
    expect(changePoint([1, 2, 3], 5)).toBe(0);
  });

  it('says nothing about a run that never changes character', () => {
    const next = xorshift32(4242);
    const flat = Array.from({ length: 80 }, () => next() - 0.5);
    expect(Math.abs(changePoint(flat, 20))).toBeLessThan(2.5);
  });

  it('catches the level shifting', () => {
    const next = xorshift32(99);
    const before = Array.from({ length: 40 }, () => next() * 0.1);
    const after = Array.from({ length: 40 }, () => next() * 0.1 + 1);
    expect(changePoint([...before, ...after], 40)).toBeGreaterThan(4);
  });

  it('is signed by which way the level moved', () => {
    const before = Array.from({ length: 30 }, (_, i) => (i % 2) * 0.02 + 1);
    const after = Array.from({ length: 30 }, (_, i) => (i % 2) * 0.02);
    expect(changePoint([...before, ...after], 30)).toBeLessThan(0);
    expect(changePoint([...after, ...before], 30)).toBeGreaterThan(0);
  });

  it('does not blow up on a run with no spread at all', () => {
    expect(changePoint(new Array(60).fill(3), 30)).toBe(0);
  });
});

describe('dispersion', () => {
  it('is zero for one value or a flat run', () => {
    expect(dispersion([5])).toBe(0);
    expect(dispersion([2, 2, 2, 2])).toBe(0);
  });

  it('is the sample standard deviation', () => {
    expect(dispersion([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });
});

/** A tape of ticks walking from `from` to `to` over `ms`. */
function ramp(now: number, ms: number, from: number, to: number): Tick[] {
  const out: Tick[] = [];
  const steps = Math.floor(ms / 200);
  for (let i = 0; i <= steps; i++) {
    out.push({ t: now - ms + i * 200, p: from + ((to - from) * i) / steps });
  }
  return out;
}

const NOW = 1_700_000_000_000;
const VOL = 0.4;
const LEFT = 8 * 60_000;

function features(over: Partial<Parameters<typeof extractFlipFeatures>[0]> = {}): FlipFeatures {
  return extractFlipFeatures(
    {
      series: ramp(NOW, 120_000, 78_200, 78_200),
      bars: [],
      book: null,
      freshTape: [],
      spot: 78_200,
      strike: 78_000,
      annualVol: VOL,
      msLeft: LEFT,
      now: NOW,
      ...over,
    },
    new FlipRolling(),
  );
}

describe('reading the features off the tape', () => {
  it('signs every read toward the flip, whichever side leads', () => {
    // Leader is YES and price is falling at the target: that argues for a flip.
    const falling = features({
      series: ramp(NOW, 120_000, 78_400, 78_100),
      spot: 78_100,
    });
    expect(falling.velocity).toBeGreaterThan(0);
    expect(falling.trajectory).toBeGreaterThan(0);

    // Mirror it: leader is NO, price rising at the target, same positive sign.
    const rising = features({
      series: ramp(NOW, 120_000, 77_600, 77_900),
      spot: 77_900,
    });
    expect(rising.velocity).toBeGreaterThan(0);
    expect(rising.trajectory).toBeGreaterThan(0);
  });

  it('reads a leader running away as arguing against the flip', () => {
    const away = features({
      series: ramp(NOW, 120_000, 78_100, 78_600),
      spot: 78_600,
    });
    expect(away.velocity).toBeLessThan(0);
    expect(away.trajectory).toBeLessThan(0);
  });

  it('reports the gap unsigned, and smaller over the horizon than the round', () => {
    const f = features();
    expect(f.gap).toBeGreaterThan(0);
    expect(features({ spot: 77_800 }).gap).toBeGreaterThan(0);
    // A minute of movement is less than eight minutes of it, so the same
    // dollar gap is more standard deviations over the horizon.
    expect(f.horizonGap).toBeGreaterThan(f.gap);
    expect(FLIP_HORIZON_MS).toBe(60_000);
  });

  it('counts a target that was tested and not held', () => {
    const bar = (low: number, close: number): Candle => ({
      t: NOW - 60_000,
      open: 78_200,
      high: 78_300,
      low,
      close,
      live: false,
    });
    // Poked below the target twice and closed back above it both times.
    const tested = features({ bars: [bar(77_900, 78_150), bar(77_950, 78_180)] });
    expect(tested.failedBreak).toBe(2);
    expect(tested.rejection).toBeGreaterThan(0);

    // Never went near it.
    const untested = features({ bars: [bar(78_100, 78_150), bar(78_120, 78_180)] });
    expect(untested.failedBreak).toBe(0);
    expect(untested.rejection).toBe(0);
  });

  it('ignores the bar still forming, which has no close yet', () => {
    const live: Candle = {
      t: NOW,
      open: 78_200,
      high: 78_300,
      low: 77_900,
      close: 78_150,
      live: true,
    };
    expect(features({ bars: [live] }).failedBreak).toBe(0);
  });

  it('holds every feature inside its bounds on nonsense input', () => {
    const wild = features({
      series: ramp(NOW, 120_000, 1, 900_000),
      spot: 900_000,
      strike: 1,
      msLeft: 0,
    });
    for (const key of SCORED_KEYS) {
      expect(Number.isFinite(wild[key])).toBe(true);
      expect(Math.abs(wild[key])).toBeLessThanOrEqual(8);
    }
  });
});

describe('normalising against the gap', () => {
  it('says nothing until it has a window at this distance', () => {
    const rolling = new FlipRolling();
    const raw = { ...EMPTY_FEATURES, gap: 1, velocity: 3 };
    expect(rolling.normalise(raw).velocity).toBe(0);
  });

  it('strips out what the gap already explains', () => {
    // A feature that is nothing but a copy of the gap. Raw it looks
    // informative; conditioned on the gap it has nothing left to say, which
    // is exactly what stops the engine counting the geometry twice.
    const rolling = new FlipRolling();
    const next = xorshift32(2024);
    let last = 0;
    for (let i = 0; i < 400; i++) {
      const gap = next() * 3;
      const raw = { ...EMPTY_FEATURES, gap, velocity: gap };
      last = rolling.normalise(raw).velocity;
    }
    expect(Math.abs(last)).toBeLessThan(1);
  });

  it('still hears a feature that moves for its own reasons', () => {
    const rolling = new FlipRolling();
    const next = xorshift32(777);
    for (let i = 0; i < 400; i++) {
      rolling.normalise({ ...EMPTY_FEATURES, gap: next() * 3, velocity: next() });
    }
    // A value far outside what this feature has ever done at this distance.
    const spike = rolling.normalise({ ...EMPTY_FEATURES, gap: 1.5, velocity: 40 });
    expect(spike.velocity).toBeGreaterThan(2);
  });

  it('leaves the gap itself alone and counts what it has seen', () => {
    const rolling = new FlipRolling();
    const out = rolling.normalise({ ...EMPTY_FEATURES, gap: 1.25, horizonGap: 2.5 });
    expect(out.gap).toBe(1.25);
    expect(out.horizonGap).toBe(2.5);
    expect(rolling.samples).toBe(1);
  });
});

describe('weights and what they are worth', () => {
  it('ships every scored feature with a weight and a measured score', () => {
    for (const key of SCORED_KEYS) {
      expect(FLIP_WEIGHTS[key]).toBeDefined();
      expect(Number.isFinite(FLIP_WEIGHTS[key])).toBe(true);
      expect(MEASURED_AUC[key]).toBeDefined();
    }
  });

  it('keeps every weight small enough that the geometry still decides', () => {
    // Measured: at full fitted strength the features made the answer worse
    // (AUC 0.893 against the baseline's 0.918). They ship at a tenth.
    for (const key of SCORED_KEYS) {
      expect(Math.abs(FLIP_WEIGHTS[key])).toBeLessThan(0.07);
    }

    // The pathological ceiling: every one of the sixteen pinned at a
    // four-sigma outlier and all arguing the same way. That is 1.60 in
    // log-odds, and it is a number worth knowing rather than hiding — it is
    // the most the features could ever overrule the geometry by.
    const ceiling = SCORED_KEYS.reduce((a, k) => a + Math.abs(FLIP_WEIGHTS[k]) * 4, 0);
    expect(ceiling).toBeCloseTo(1.6, 1);

    // What actually happens: a feature set all sitting a sigma out, which is
    // already an unusual reading, barely moves a 32% baseline.
    const ordinary = SCORED_KEYS.reduce((a, k) => a + Math.abs(FLIP_WEIGHTS[k]), 0);
    const shifted = 1 / (1 + Math.exp(-(Math.log(0.317 / 0.683) + ordinary)));
    expect(shifted).toBeGreaterThan(0.32);
    expect(shifted).toBeLessThan(0.42);
  });

  it('is honest that most of the inputs know nothing', () => {
    const useful = SCORED_KEYS.filter((k) => Math.abs(MEASURED_AUC[k] - 0.5) > 0.1);
    expect(useful).toContain('failedBreak');
    expect(useful).toContain('rejection');
    // The order-book reads are generated from the price in this simulator, so
    // once the gap is conditioned out they are coin flips.
    for (const k of ['bookImbalance', 'spread', 'tradeImbalance'] as const) {
      expect(Math.abs(MEASURED_AUC[k] - 0.5)).toBeLessThan(0.1);
    }
  });
});

describe('turning the score into a signal', () => {
  const memory: FlipMemory[] = [];

  it('names the direction as leader to challenger', () => {
    const above = makeFlipSignal(
      { ...EMPTY_FEATURES, gap: 1, horizonGap: 2 }, memory, 100, 78_200, 78_000, NOW,
    );
    expect(above.direction).toBe('YES → NO');
    expect(above.leader).toBe('up');
    expect(above.challenger).toBe('down');

    const below = makeFlipSignal(
      { ...EMPTY_FEATURES, gap: 1, horizonGap: 2 }, memory, 100, 77_800, 78_000, NOW,
    );
    expect(below.direction).toBe('NO → YES');
    expect(below.leader).toBe('down');
    expect(below.challenger).toBe('up');
  });

  it('lands on the exact baseline when nothing has anything to say', () => {
    const quiet = makeFlipSignal(
      { ...EMPTY_FEATURES, gap: 0.8, horizonGap: 1.5 }, [], 100, 78_200, 78_000, NOW,
    );
    expect(quiet.baseline).toBeCloseTo(touchProbability(1.5), 12);
    expect(quiet.probability).toBeCloseTo(quiet.baseline, 10);
    expect(quiet.reasons).toHaveLength(0);
  });

  it('stays a probability however hard the features push', () => {
    const loud = SCORED_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: 4 }),
      { ...EMPTY_FEATURES, gap: 6, horizonGap: 8 } as FlipFeatures,
    );
    const s = makeFlipSignal(loud, [], 200, 79_000, 78_000, NOW);
    expect(s.probability).toBeGreaterThan(0);
    expect(s.probability).toBeLessThan(1);
    expect(s.strength).toBeGreaterThanOrEqual(0);
    expect(s.strength).toBeLessThanOrEqual(10);
  });

  it('only gives reasons that argue for the flip', () => {
    // Everything pointing away from a flip should produce no case for one.
    const calm = SCORED_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: FLIP_WEIGHTS[k] > 0 ? -3 : 3 }),
      { ...EMPTY_FEATURES, gap: 2, horizonGap: 3 } as FlipFeatures,
    );
    const s = makeFlipSignal(calm, [], 200, 78_500, 78_000, NOW);
    expect(s.reasons).toHaveLength(0);
    // And it goes below the baseline rather than being propped up by a floor.
    expect(s.probability).toBeLessThan(s.baseline);
    expect(s.probability).toBeGreaterThan(0);
  });

  it('names the sides the right way round in its reasons', () => {
    const parts = contributions({ ...EMPTY_FEATURES, liquidityPull: 3, tradeImbalance: 3 });
    const said = reasonsFor(parts, 'up', 'down', null).map((r) => r.text);
    expect(said.join(' | ')).toContain('YES liquidity withdrawing');
    expect(said.join(' | ')).toContain('NO buying pressure increasing');

    const mirrored = reasonsFor(parts, 'down', 'up', null).map((r) => r.text);
    expect(mirrored.join(' | ')).toContain('NO liquidity withdrawing');
    expect(mirrored.join(' | ')).toContain('YES buying pressure increasing');
  });

  it('orders the reasons by how much each actually moved the answer', () => {
    const parts = contributions({
      ...EMPTY_FEATURES,
      failedBreak: 4,
      largeOrders: 4,
    });
    // failedBreak carries 23x the weight of largeOrders, so it leads.
    expect(parts[0].key).toBe('failedBreak');
    expect(Math.abs(parts[0].push)).toBeGreaterThan(Math.abs(parts[1].push));
  });
});

describe('confidence', () => {
  const parts = (values: Partial<FlipFeatures>) =>
    contributions({ ...EMPTY_FEATURES, ...values });

  it('is low before there is a window behind it', () => {
    expect(confidenceOf(parts({ failedBreak: 4, rejection: 4 }), 5)).toBe('LOW');
  });

  it('is low when nothing is saying anything', () => {
    expect(confidenceOf(parts({}), 500)).toBe('LOW');
  });

  it('is high when several inputs agree off a real window', () => {
    const agreeing = parts({
      failedBreak: 4,
      rejection: 4,
      liquidityPull: 4,
      spread: 4,
      trajectory: 4,
      depth: 4,
    });
    expect(confidenceOf(agreeing, 200)).toBe('HIGH');
  });

  it('will not call it high when the inputs contradict each other', () => {
    const split = parts({
      failedBreak: 4,
      rejection: 4,
      liquidityPull: -4,
      spread: -4,
      trajectory: -4,
    });
    expect(confidenceOf(split, 200)).not.toBe('HIGH');
  });

  it('discounts the strength of a reading it does not trust', () => {
    // The same evidence, one read off a cold start and one off a real window.
    const f: FlipFeatures = {
      ...EMPTY_FEATURES,
      gap: 0.2,
      horizonGap: 0.4,
      failedBreak: 4,
      rejection: 4,
      liquidityPull: 4,
      spread: 4,
      trajectory: 4,
      depth: 4,
    };
    const cold = makeFlipSignal(f, [], 5, 78_050, 78_000, NOW);
    const warm = makeFlipSignal(f, [], 500, 78_050, 78_000, NOW);
    expect(cold.confidence).toBe('LOW');
    expect(warm.confidence).toBe('HIGH');
    // Identical odds, less trust behind them, so a smaller number out of ten.
    expect(cold.probability).toBeCloseTo(warm.probability, 10);
    expect(cold.strength).toBeLessThan(warm.strength);
  });
});

describe('matching against past setups', () => {
  const setup = (velocity: number, flipped: boolean): FlipMemory => ({
    features: { ...EMPTY_FEATURES, velocity },
    flipped,
  });

  it('refuses to claim a pattern off too little history', () => {
    expect(matchHistory({ ...EMPTY_FEATURES }, [], 12)).toBeNull();
    expect(matchHistory({ ...EMPTY_FEATURES }, [setup(1, true)], 12)).toBeNull();
  });

  it('reports how often the nearest setups flipped, and how many it found', () => {
    const memory = [
      ...Array.from({ length: 20 }, () => setup(3, true)),
      ...Array.from({ length: 20 }, () => setup(-3, false)),
    ];
    const near = matchHistory({ ...EMPTY_FEATURES, velocity: 3 }, memory, 10)!;
    expect(near.matched).toBe(10);
    expect(near.rate).toBe(1);

    const far = matchHistory({ ...EMPTY_FEATURES, velocity: -3 }, memory, 10)!;
    expect(far.rate).toBe(0);
  });

  it('says so in words only when the resemblance is strong', () => {
    const strong = reasonsFor([], 'up', 'down', { rate: 0.8, matched: 12 });
    expect(strong[0].text).toContain('80% of 12 past setups');

    const weak = reasonsFor([], 'up', 'down', { rate: 0.4, matched: 12 });
    expect(weak).toHaveLength(0);
  });
});

describe('does the whole thing actually beat the geometry', () => {
  /** P(a positive scores above a negative), by rank sum. */
  function auc(scores: number[], labels: boolean[]): number {
    const rows = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
    let rank = 1;
    let sumPos = 0;
    let pos = 0;
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j < rows.length && rows[j].s === rows[i].s) j++;
      const avg = (rank + rank + (j - i) - 1) / 2;
      for (let k = i; k < j; k++) if (rows[k].y) { sumPos += avg; pos++; }
      rank += j - i;
      i = j;
    }
    const neg = rows.length - pos;
    if (pos === 0 || neg === 0) return 0.5;
    return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
  }

  /**
   * The one that matters. A detector that dresses the exact answer up in
   * sixteen inputs and then predicts *worse* than the exact answer is a
   * liability, so this measures both and refuses to let the features drag it
   * down. The shipped weights were chosen by this measurement.
   */
  it('never predicts worse than the reflection principle alone', () => {
    const ROUND_MS = 15 * 60_000;
    const VOL_ = 0.4;
    const base: number[] = [];
    const full: number[] = [];
    const labels: boolean[] = [];

    for (let round = 0; round < 60; round++) {
      const engine = new PriceEngine({
        seed: (round * 2654435761 + 4242) >>> 0,
        startPrice: 78_000,
        annualVol: VOL_,
      });
      const rolling = new FlipRolling();
      const series: Tick[] = [];
      const bars: Candle[] = [];
      const strike = engine.price;
      const pending: { i: number; leader: number; deadline: number }[] = [];
      const now0 = NOW;
      let lastPoll = 0;

      for (let t = 200; t < ROUND_MS; t += 200) {
        const now = now0 + t;
        const price = engine.step(200);
        series.push({ t: now, p: price });

        const bucket = Math.floor(now / 60_000) * 60_000;
        const last = bars[bars.length - 1];
        if (!last || last.t !== bucket) {
          if (last) last.live = false;
          bars.push({ t: bucket, open: price, high: price, low: price, close: price, live: true });
        } else {
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
          last.close = price;
        }

        for (let i = pending.length - 1; i >= 0; i--) {
          if (Math.sign(price - strike) !== pending[i].leader) {
            labels[pending[i].i] = true;
            pending.splice(i, 1);
          } else if (t > pending[i].deadline) {
            pending.splice(i, 1);
          }
        }

        const msLeft = ROUND_MS - t;
        if (t - lastPoll >= 3_000 && msLeft > FLIP_HORIZON_MS) {
          lastPoll = t;
          const raw = extractFlipFeatures(
            { series, bars, book: null, freshTape: [], spot: price, strike, annualVol: VOL_, msLeft, now },
            rolling,
          );
          const signal = makeFlipSignal(
            rolling.normalise(raw), [], rolling.samples, price, strike, now,
          );
          base.push(signal.baseline);
          full.push(signal.probability);
          labels.push(false);
          pending.push({
            i: labels.length - 1,
            leader: Math.sign(price - strike),
            deadline: t + FLIP_HORIZON_MS,
          });
        }
      }
    }

    const baseAuc = auc(base, labels);
    const fullAuc = auc(full, labels);
    // The geometry is a strong predictor on its own — this pins that it is
    // genuinely doing the work rather than the number being decorative.
    expect(base.length).toBeGreaterThan(3_000);
    expect(baseAuc).toBeGreaterThan(0.85);
    // And the sixteen inputs on top must not cost anything.
    expect(fullAuc).toBeGreaterThanOrEqual(baseAuc - 0.005);
  });
});

describe('telling a reason from a decoration', () => {
  it('marks only the inputs that measurably predict anything', () => {
    // These two beat a coin flip when they were scored; the book reads did not.
    const backed = contributions({ ...EMPTY_FEATURES, failedBreak: 4, rejection: 4 });
    for (const r of reasonsFor(backed, 'up', 'down', null)) expect(r.backed).toBe(true);

    const decorative = contributions({
      ...EMPTY_FEATURES,
      spread: 4,
      bookImbalance: 4,
      tradeImbalance: 4,
      volumeAccel: 4,
    });
    for (const r of reasonsFor(decorative, 'up', 'down', null)) expect(r.backed).toBe(false);
  });

  it('still says what the tape is doing either way', () => {
    const parts = contributions({ ...EMPTY_FEATURES, spread: 4 });
    const said = reasonsFor(parts, 'up', 'down', null);
    expect(said[0].text).toBe('Spread widening');
    expect(said[0].backed).toBe(false);
  });
});
