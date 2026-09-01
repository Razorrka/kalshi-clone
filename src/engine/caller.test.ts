import { describe, expect, it } from 'vitest';
import {
  INITIAL_MODEL,
  callDeadlineFor,
  callOpensAt,
  callStats,
  contributions,
  learn,
  lockDelayFor,
  makeCall,
  outcomeFromGrade,
  predictUp,
  rearmDelayFor,
  sigmoid,
  standardisedGap,
  type LockedCall,
} from './caller';
import { normCdf } from '../lib/math';

const flat = { z: 0, bias: 0, momentum: 0 };

/**
 * A real 32-bit generator. The textbook `seed * 1103515245 + 12345` LCG is
 * broken in JavaScript — the product runs past 2^53, so the low bits are float
 * rounding noise, and reading `seed % 2` hands back a constant.
 */
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

describe('sigmoid', () => {
  it('is a half at zero and saturates without overflowing', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(800)).toBe(1);
    expect(sigmoid(-800)).toBe(0);
    expect(Number.isFinite(sigmoid(-1e6))).toBe(true);
  });

  it('is symmetric', () => {
    for (const x of [0.4, 1.3, 3]) expect(sigmoid(x) + sigmoid(-x)).toBeCloseTo(1, 12);
  });
});

describe('an untrained model', () => {
  it('starts at the textbook answer rather than a coin flip', () => {
    // 1.6x logistic tracks the normal CDF within a few points, so a fresh
    // model reproduces option pricing instead of guessing.
    for (const z of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      const p = predictUp({ ...flat, z }, INITIAL_MODEL);
      expect(Math.abs(p - normCdf(z))).toBeLessThan(0.03);
    }
  });

  it('is undecided when price sits on the target', () => {
    expect(predictUp(flat, INITIAL_MODEL)).toBeCloseTo(0.5, 10);
  });

  it('gets more certain the further price is from the target', () => {
    const near = predictUp({ ...flat, z: 0.4 }, INITIAL_MODEL);
    const far = predictUp({ ...flat, z: 2.5 }, INITIAL_MODEL);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(0.9);
  });
});

describe('standardisedGap', () => {
  it('is zero when price is exactly on the target', () => {
    expect(standardisedGap(78_000, 78_000, 0.4, 600_000)).toBe(0);
  });

  it('grows as the time left shrinks, for the same gap', () => {
    const early = standardisedGap(78_200, 78_000, 0.4, 10 * 60_000);
    const late = standardisedGap(78_200, 78_000, 0.4, 60_000);
    // The same $200 lead is worth far more with a minute left than with ten.
    expect(late).toBeGreaterThan(early);
  });

  it('is signed by which side of the target price is on', () => {
    expect(standardisedGap(78_500, 78_000, 0.4, 300_000)).toBeGreaterThan(0);
    expect(standardisedGap(77_500, 78_000, 0.4, 300_000)).toBeLessThan(0);
  });

  it('survives degenerate inputs', () => {
    expect(standardisedGap(0, 78_000, 0.4, 300_000)).toBe(0);
    expect(standardisedGap(78_000, 0, 0.4, 300_000)).toBe(0);
    expect(standardisedGap(78_000, 77_000, 0, 300_000)).toBe(0);
    expect(Number.isFinite(standardisedGap(78_200, 78_000, 0.4, 0))).toBe(true);
  });
});

describe('makeCall', () => {
  it('commits to a side and reports confidence in that side', () => {
    const up = makeCall({ ...flat, z: 1.2 }, INITIAL_MODEL);
    expect(up.side).toBe('up');
    expect(up.confidence).toBeCloseTo(up.pUp, 10);
    expect(up.confidence).toBeGreaterThan(0.5);

    const down = makeCall({ ...flat, z: -1.2 }, INITIAL_MODEL);
    expect(down.side).toBe('down');
    expect(down.confidence).toBeCloseTo(1 - down.pUp, 10);
    expect(down.confidence).toBeGreaterThan(0.5);
  });

  it('never reports confidence below a half, whichever side it picks', () => {
    for (let z = -3; z <= 3; z += 0.25) {
      expect(makeCall({ ...flat, z }, INITIAL_MODEL).confidence).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('learning from a graded call', () => {
  it('moves toward the outcome it got wrong', () => {
    const features = { z: 0.8, bias: 1, momentum: 0.3 };
    const before = predictUp(features, INITIAL_MODEL);
    // It leaned up and the round finished down: it should lean less next time.
    const after = predictUp(features, learn(INITIAL_MODEL, features, false));
    expect(after).toBeLessThan(before);
  });

  it('moves further the more confident the miss was', () => {
    const mild = { z: 0.3, bias: 0, momentum: 0 };
    const bold = { z: 2.5, bias: 0, momentum: 0 };
    const mildStep = learn(INITIAL_MODEL, mild, false);
    const boldStep = learn(INITIAL_MODEL, bold, false);

    // Measured on the weights, not on the probability where the miss happened:
    // deep in the tail the curve is almost flat, so a large correction there
    // shows up as a tiny probability move at that same point.
    expect(Math.abs(boldStep.weights[0])).toBeGreaterThan(Math.abs(mildStep.weights[0]));
    expect(INITIAL_MODEL.weights[1] - boldStep.weights[1]).toBeGreaterThan(
      INITIAL_MODEL.weights[1] - mildStep.weights[1],
    );

    // And the correction is felt across the curve: read both models at a
    // common point and the confident miss has moved the model much further.
    const at = { z: 1, bias: 0, momentum: 0 };
    const base = predictUp(at, INITIAL_MODEL);
    expect(base - predictUp(at, boldStep)).toBeGreaterThan(base - predictUp(at, mildStep));
  });

  it('barely moves when it was already right', () => {
    const features = { z: 2.8, bias: 1, momentum: 0 };
    const before = predictUp(features, INITIAL_MODEL);
    const after = predictUp(features, learn(INITIAL_MODEL, features, true));
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  it('counts what it has been trained on', () => {
    let model = INITIAL_MODEL;
    for (let i = 0; i < 5; i++) model = learn(model, flat, i % 2 === 0);
    expect(model.trained).toBe(5);
  });

  it('actually learns a signal that is really there', () => {
    // Feed it a world where the trailing stop bias decides the outcome and
    // the gap says nothing. It should come to lean on the bias.
    let model = INITIAL_MODEL;
    for (let i = 0; i < 400; i++) {
      const bias = i % 2 === 0 ? 1 : -1;
      model = learn(model, { z: 0, bias, momentum: 0 }, bias > 0);
    }
    expect(model.weights[2]).toBeGreaterThan(1);
    expect(predictUp({ z: 0, bias: 1, momentum: 0 }, model)).toBeGreaterThan(0.7);
    expect(predictUp({ z: 0, bias: -1, momentum: 0 }, model)).toBeLessThan(0.3);
  });

  it('does not chase a signal that is not there', () => {
    // Coin-flip outcomes uncorrelated with the feature: weights should stay
    // near where they started rather than wandering off. Run several streams
    // so this pins down the model's behaviour and not one lucky sequence.
    for (const seed of [7, 99, 4242, 60_001]) {
      const next = xorshift32(seed);
      let model = INITIAL_MODEL;
      for (let i = 0; i < 600; i++) {
        const bias = next() < 0.5 ? 1 : -1;
        model = learn(model, { z: 0, bias, momentum: 0 }, next() < 0.5);
      }
      expect(Math.abs(model.weights[2])).toBeLessThan(0.6);
      expect(predictUp({ z: 0, bias: 1, momentum: 0 }, model)).toBeGreaterThan(0.3);
      expect(predictUp({ z: 0, bias: 1, momentum: 0 }, model)).toBeLessThan(0.7);
    }
  });

  it('holds the weights in a sane band under a pathological run', () => {
    let model = INITIAL_MODEL;
    for (let i = 0; i < 5_000; i++) {
      model = learn(model, { z: 6, bias: 1, momentum: 6 }, false);
    }
    for (const w of model.weights) {
      expect(Number.isFinite(w)).toBe(true);
      expect(Math.abs(w)).toBeLessThanOrEqual(6);
    }
  });
});

describe('when the call locks', () => {
  it('is four minutes into the fifteen-minute round', () => {
    expect(lockDelayFor(15 * 60_000)).toBe(4 * 60_000);
  });

  it('scales down on a shorter round so it still lands', () => {
    for (const roundMs of [60_000, 3 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]) {
      const delay = lockDelayFor(roundMs);
      // Always inside the round, and always with the bulk of it still to run.
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(roundMs);
      expect(roundMs - delay).toBeGreaterThan(roundMs * 0.5);
    }
  });
});

function fakeCall(over: Partial<LockedCall> = {}): LockedCall {
  return {
    id: 'c1',
    roundId: 'r1',
    roundIndex: 1,
    roundEndsAt: 1_000,
    lockedAt: 0,
    side: 'up',
    confidence: 0.8,
    pUp: 0.8,
    spot: 78_100,
    strike: 78_000,
    features: { z: 1, bias: 0, momentum: 0 },
    weights: [0, 1.6, 0, 0],
    ...over,
  };
}

describe('what a grade teaches', () => {
  it('reads "wrong" as the other side having finished', () => {
    const up = fakeCall({ side: 'up' });
    expect(outcomeFromGrade(up, 'right')).toBe(true);
    expect(outcomeFromGrade(up, 'wrong')).toBe(false);

    const down = fakeCall({ side: 'down' });
    expect(outcomeFromGrade(down, 'right')).toBe(false);
    expect(outcomeFromGrade(down, 'wrong')).toBe(true);
  });
});

describe('breaking a call down', () => {
  it('credits the gap when nothing else is in play', () => {
    const parts = contributions({ z: 1.2, bias: 0, momentum: 0 }, [0, 1.6, 0.5, 0.3]);
    const gap = parts.find((p) => p.key === 'z')!;
    expect(gap.shift).toBeGreaterThan(0.2);
    // A feature sitting at zero cannot have moved anything.
    expect(parts.find((p) => p.key === 'bias')!.shift).toBe(0);
    expect(parts.find((p) => p.key === 'momentum')!.shift).toBe(0);
  });

  it('signs each push by the direction it argued for', () => {
    const parts = contributions({ z: 0.5, bias: -1, momentum: 0 }, [0, 1.6, 1.2, 0]);
    expect(parts.find((p) => p.key === 'z')!.shift).toBeGreaterThan(0);
    expect(parts.find((p) => p.key === 'bias')!.shift).toBeLessThan(0);
  });

  it('reports no effect from a feature the model gives no weight', () => {
    const parts = contributions({ z: 1, bias: 1, momentum: 1 }, [0, 1.6, 0, 0]);
    expect(parts.find((p) => p.key === 'bias')!.shift).toBe(0);
    expect(parts.find((p) => p.key === 'momentum')!.shift).toBe(0);
  });
});

describe('the record', () => {
  it('is empty before anything is graded', () => {
    const stats = callStats([fakeCall({ id: 'a' }), fakeCall({ id: 'b', outcome: 'up' })]);
    expect(stats.graded).toBe(0);
    expect(stats.hitRate).toBeNull();
    expect(stats.streak).toBe(0);
    expect(stats.calibration.every((b) => b.actual === null)).toBe(true);
  });

  it('counts hits and separates the confident ones', () => {
    const stats = callStats([
      fakeCall({ id: 'a', confidence: 0.9, grade: 'right', gradedAt: 3 }),
      fakeCall({ id: 'b', confidence: 0.55, grade: 'wrong', gradedAt: 2 }),
      fakeCall({ id: 'c', confidence: 0.72, grade: 'right', gradedAt: 1 }),
    ]);
    expect(stats.graded).toBe(3);
    expect(stats.right).toBe(2);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 10);
    // 0.55 is below the conviction line, so it is out of the confident tally.
    expect(stats.confidentGraded).toBe(2);
    expect(stats.confidentRight).toBe(2);
    expect(stats.confidentHitRate).toBe(1);
  });

  it('reads the streak back from the most recent grade', () => {
    const run = (grades: ('right' | 'wrong')[]) =>
      callStats(
        grades.map((grade, i) => fakeCall({ id: `c${i}`, grade, gradedAt: i + 1 })),
      ).streak;

    expect(run(['wrong', 'right', 'right'])).toBe(2);
    expect(run(['right', 'wrong', 'wrong', 'wrong'])).toBe(-3);
    expect(run(['right'])).toBe(1);
  });

  it('bands calls by the confidence they claimed', () => {
    const stats = callStats([
      fakeCall({ id: 'a', confidence: 0.82, grade: 'right', gradedAt: 1 }),
      fakeCall({ id: 'b', confidence: 0.86, grade: 'wrong', gradedAt: 2 }),
      fakeCall({ id: 'c', confidence: 0.95, grade: 'right', gradedAt: 3 }),
    ]);
    const eighties = stats.calibration.find((b) => b.label === '80–90%')!;
    expect(eighties.graded).toBe(2);
    expect(eighties.right).toBe(1);
    expect(eighties.actual).toBe(0.5);
    expect(eighties.claimed).toBeCloseTo(0.84, 10);

    const nineties = stats.calibration.find((b) => b.label === '90–100%')!;
    expect(nineties.graded).toBe(1);
    expect(nineties.actual).toBe(1);
  });

  it('puts a call that was certain in the top band, not off the end', () => {
    const stats = callStats([fakeCall({ confidence: 1, grade: 'right', gradedAt: 1 })]);
    expect(stats.calibration.reduce((n, b) => n + b.graded, 0)).toBe(1);
    expect(stats.calibration.find((b) => b.label === '90–100%')!.graded).toBe(1);
  });
});

describe('the window a call can be made in', () => {
  it('closes with as much of the round left as it waited to speak', () => {
    expect(callDeadlineFor(15 * 60_000)).toBe(11 * 60_000);
  });

  it('always leaves a real window open', () => {
    for (const roundMs of [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]) {
      const open = lockDelayFor(roundMs);
      const close = callDeadlineFor(roundMs);
      expect(close).toBeGreaterThan(open);
      expect(close).toBeLessThan(roundMs);
    }
  });
});

describe('whether the confidence means anything', () => {
  /**
   * Draws rounds from the law the market actually follows — price finishes
   * above the target with probability normCdf(z) — and checks that when the
   * caller says 70% it is right about 70% of the time. A caller whose numbers
   * do not survive this is not confident, only loud.
   */
  it('is calibrated: 80% means eight times in ten', () => {
    const next = xorshift32(20_260_831);
    const bands = new Map<number, { n: number; right: number }>();

    for (let i = 0; i < 4_000; i++) {
      // A spread of gaps, from sitting on the target to well clear of it.
      const z = (next() * 2 - 1) * 3;
      const call = makeCall({ z, bias: 0, momentum: 0 }, INITIAL_MODEL);
      const finishedUp = next() < normCdf(z);
      const right = (call.side === 'up') === finishedUp;

      const band = Math.min(9, Math.floor(call.confidence * 10));
      const cell = bands.get(band) ?? { n: 0, right: 0 };
      cell.n += 1;
      if (right) cell.right += 1;
      bands.set(band, cell);
    }

    for (const [band, cell] of bands) {
      if (cell.n < 100) continue;
      const claimed = band / 10 + 0.05;
      const actual = cell.right / cell.n;
      expect(Math.abs(actual - claimed)).toBeLessThan(0.06);
    }
    // And it did claim across the whole range, not just hedge at 50%.
    expect(bands.has(9)).toBe(true);
    expect(bands.has(5)).toBe(true);
  });
});

describe('changing the target mid-round', () => {
  const ROUND = 15 * 60_000;
  const T = 1_000_000;

  it('leaves the usual mark alone when the target has not moved', () => {
    expect(callOpensAt(T, ROUND, 0)).toBe(T + 4 * 60_000);
    // A change stamped before this round opened belongs to an earlier one.
    expect(callOpensAt(T, ROUND, T - 5_000)).toBe(T + 4 * 60_000);
  });

  it('gives a new target a minute of watching before it commits', () => {
    // Changed eight minutes in: the call waits a minute from the change.
    expect(callOpensAt(T, ROUND, T + 8 * 60_000)).toBe(T + 9 * 60_000);
  });

  it('never brings the call forward, only pushes it back', () => {
    // Changed thirty seconds in, the usual four-minute mark still stands.
    expect(callOpensAt(T, ROUND, T + 30_000)).toBe(T + 4 * 60_000);
    for (const at of [1_000, 60_000, 120_000, 179_000]) {
      expect(callOpensAt(T, ROUND, T + at)).toBe(T + 4 * 60_000);
    }
  });

  it('can push past the deadline, which is what stops a rushed call', () => {
    const late = T + 13 * 60_000;
    expect(callOpensAt(T, ROUND, late)).toBeGreaterThan(T + callDeadlineFor(ROUND));
  });
});

describe('how long a moved target is watched', () => {
  it('is the minute asked for on the fifteen-minute market', () => {
    expect(rearmDelayFor(15 * 60_000)).toBe(60_000);
    expect(rearmDelayFor(5 * 60_000)).toBe(60_000);
  });

  it('never outlasts the round it is in', () => {
    for (const roundMs of [60_000, 3 * 60_000, 15 * 60_000, 60 * 60_000]) {
      const rearm = rearmDelayFor(roundMs);
      expect(rearm).toBeLessThanOrEqual(lockDelayFor(roundMs));
      // Change the target the instant the round opens and a call is still
      // reachable before the deadline.
      expect(rearm).toBeLessThan(callDeadlineFor(roundMs));
    }
  });
});
