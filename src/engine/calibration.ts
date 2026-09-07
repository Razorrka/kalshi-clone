import { clamp, invNormCdf, normCdf } from '../lib/math';

/**
 * What the board's price is actually worth.
 *
 * Every ticket here is priced as N(d2): the chance of finishing past the
 * target under a walk whose volatility is exactly what it is right now and
 * stays there for the rest of the round. Both halves of that are wrong for
 * this tape, and wrong in a direction that can be measured.
 *
 * ---------------------------------------------------------------------------
 * The claim
 * ---------------------------------------------------------------------------
 * The entire error collapses to one number. If the true spread of outcomes is
 * k times what the quote assumes, then a side quoted at p really lands at
 *
 *     fair(p) = N( invNorm(p) / k )
 *
 * and that single k reproduces the measured rate at every price from 0.5% to
 * 50% to within a tenth of a percentage point. It also cannot misbehave the
 * way a table of per-price offsets can: it is monotone, it fixes p = 0.5, and
 * fair(p) + fair(1-p) is exactly 1. The version this replaced had none of
 * those properties — it put Up at 30% and Down at 70% together at 101.16%,
 * which is not a probability.
 *
 * ---------------------------------------------------------------------------
 * Why k is bigger than 1
 * ---------------------------------------------------------------------------
 * Two mechanisms, and they dominate at opposite ends of the clock.
 *
 * With seconds left, the microstructure bounce does it. That term is a fixed
 * 0.4 basis points whatever the volatility, so when the diffusion over the
 * window is small the bounce is a large share of where price actually ends
 * up. Predicting k from that constant alone — sqrt(1 + 2*micro^2/(sigma^2*t))
 * — gives 1.30 where 1.23 was measured in the calmest bucket at 15 seconds,
 * and 1.002 where 1.003 was measured in the wildest. It is most of the effect
 * at that end, and it is why a calm tape is mispriced far more than a wild one.
 *
 * With minutes left, volatility mean-reversion and jumps do it. Volatility
 * that sits below its long-run mean has to drift back up, and the quote does
 * not know that; jumps put weight in the tail that no lognormal has. Both
 * survive at horizons where the bounce has long since washed out.
 *
 * ---------------------------------------------------------------------------
 * How it was measured
 * ---------------------------------------------------------------------------
 * 9,828,000,000 samples, from 2,000,000 fifteen-minute blocks of a chain that
 * was burned in for twelve hours of simulated time first so that its
 * volatility is drawn from where it actually lives rather than pinned at its
 * mean. The grid is 21 quoted prices from 0.5% to 50%, seven horizons from 15
 * seconds to 15 minutes, eight volatility buckets, and both sides of the
 * market. The thinnest cell holds 215,756 independent samples; the model it
 * replaced was built on 120,000 bets in total, with 6,530 in its thinnest
 * band and a +/-12.9 point interval on that band's expected value.
 *
 * One k per cell fits all 21 prices in it. Where the edge actually lives —
 * inside a minute of the bell — the largest disagreement between that single
 * number and the 21 measured rates is 0.055 of a percentage point.
 *
 * Every sample is an independent price increment over a window disjoint from
 * every other sample in its cell, taken from a chain stepped at the app's own
 * 60ms tick — a coarser step would have inflated the very quantity being
 * measured, since the engine's jump variance is proportional to its step.
 */

// Generated from the measurement; see the module comment for how.
export const VOL_BUCKETS = [0.4, 0.6, 0.8, 1, 1.25, 1.6, 2.2] as const;
export const CAL_SECONDS = [15, 30, 60, 120, 240, 480, 900] as const;
export const CAL_K: number[][] = [
  [1.2175, 1.0935, 1.0557, 1.0392, 1.0311, 1.0256, 1.0190, 1.0181], // 15s
  [1.1232, 1.0536, 1.0347, 1.0270, 1.0237, 1.0215, 1.0160, 1.0160], // 30s
  [1.0739, 1.0350, 1.0239, 1.0220, 1.0215, 1.0201, 1.0141, 1.0138], // 60s
  [1.0497, 1.0242, 1.0185, 1.0201, 1.0199, 1.0181, 1.0122, 1.0117], // 120s
  [1.0400, 1.0235, 1.0182, 1.0182, 1.0202, 1.0175, 1.0114, 1.0131], // 240s
  [1.0378, 1.0294, 1.0210, 1.0183, 1.0227, 1.0161, 1.0112, 1.0126], // 480s
  [1.0448, 1.0420, 1.0267, 1.0211, 1.0243, 1.0176, 1.0086, 1.0093], // 900s
];
export const CAL_CI: number[][] = [
  [0.0002, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0002], // 15s
  [0.0003, 0.0002, 0.0002, 0.0002, 0.0002, 0.0002, 0.0002, 0.0002], // 30s
  [0.0004, 0.0003, 0.0002, 0.0002, 0.0002, 0.0002, 0.0003, 0.0003], // 60s
  [0.0006, 0.0004, 0.0003, 0.0003, 0.0003, 0.0004, 0.0004, 0.0005], // 120s
  [0.0009, 0.0006, 0.0005, 0.0005, 0.0005, 0.0005, 0.0006, 0.0008], // 240s
  [0.0016, 0.0010, 0.0009, 0.0009, 0.0009, 0.0009, 0.0010, 0.0013], // 480s
  [0.0016, 0.0010, 0.0009, 0.0009, 0.0009, 0.0009, 0.0010, 0.0013], // 900s
];
export const CAL_N: number[][] = [
  [12945692, 31570382, 39557626, 37125372, 37153098, 34976076, 29230964, 17440790], // 15s
  [6472938, 15785238, 19778606, 18562124, 18577040, 17488386, 14615446, 8720222], // 30s
  [3236492, 7892860, 9889140, 9280718, 9288438, 8744418, 7308028, 4359906], // 60s
  [1510334, 3683864, 4614368, 4331066, 4334420, 4080916, 3409998, 2035034], // 120s
  [647020, 1579132, 1977202, 1857746, 1856716, 1748638, 1461424, 872122], // 240s
  [215756, 525932, 659436, 619376, 618458, 583326, 486694, 291022], // 480s
  [215756, 525932, 659436, 619376, 618458, 583326, 486694, 291022], // 900s
];
// total samples 9,828,000,000  blocks 2,000,000  runtime 1954s

/** Long-run volatility the ratio is measured against, per preset. */
export function volRatioOf(annualVol: number, reference: number): number {
  if (!(reference > 0) || !(annualVol > 0)) return 1;
  return annualVol / reference;
}

/** Geometric middle of each bucket, which is the point its k belongs to. */
const VOL_POINTS = (() => {
  const edges = [0.15, ...VOL_BUCKETS, 4];
  return edges.slice(0, -1).map((lo, i) => Math.sqrt(lo * edges[i + 1]));
})();

function interpolate(axis: readonly number[], at: number): { i: number; j: number; t: number } {
  if (at <= axis[0]) return { i: 0, j: 0, t: 0 };
  const last = axis.length - 1;
  if (at >= axis[last]) return { i: last, j: last, t: 0 };
  let i = 0;
  while (i < last && axis[i + 1] < at) i++;
  const lo = Math.log(axis[i]);
  const hi = Math.log(axis[i + 1]);
  return { i, j: i + 1, t: (Math.log(at) - lo) / (hi - lo) };
}

/**
 * The effective volatility multiplier for a state, interpolated between the
 * measured cells — in log-time and log-volatility, which is the scale both
 * axes were laid out on.
 */
export function volInflation(secondsLeft: number, volRatio: number): number {
  const s = interpolate(CAL_SECONDS, clamp(secondsLeft, 1, 3_600));
  const v = interpolate(VOL_POINTS, clamp(volRatio, 0.15, 4));
  const at = (si: number, vi: number) => CAL_K[si][vi];
  const a = at(s.i, v.i) + (at(s.i, v.j) - at(s.i, v.i)) * v.t;
  const b = at(s.j, v.i) + (at(s.j, v.j) - at(s.j, v.i)) * v.t;
  return clamp(a + (b - a) * s.t, 0.9, 1.6);
}

/** The 95% half-width on that multiplier, from the cell it came from. */
export function inflationCi(secondsLeft: number, volRatio: number): number {
  const s = interpolate(CAL_SECONDS, clamp(secondsLeft, 1, 3_600));
  const v = interpolate(VOL_POINTS, clamp(volRatio, 0.15, 4));
  return Math.max(CAL_CI[s.i][v.i], CAL_CI[s.j][v.j]);
}

/** Independent samples behind the cell a state falls in. */
export function calibrationSamples(secondsLeft: number, volRatio: number): number {
  const s = interpolate(CAL_SECONDS, clamp(secondsLeft, 1, 3_600));
  const v = interpolate(VOL_POINTS, clamp(volRatio, 0.15, 4));
  return Math.min(CAL_N[s.i][v.i], CAL_N[s.j][v.j]);
}

/**
 * What a side quoted at `quoted` really lands at, given how much of the round
 * is left and how the tape's volatility compares to its long-run level.
 */
export function fairProbability(
  quoted: number,
  secondsLeft: number,
  volRatio: number,
): number {
  // A quote that is not a number means the state is broken. Hand back zero,
  // not a half: zero prices every ticket at a total loss and so can never
  // light a signal, where a half would price a 40x long shot as a gift.
  if (!Number.isFinite(quoted)) return 0;
  if (quoted <= 0) return 0;
  if (quoted >= 1) return 1;
  // An even-money price is zero distance from the target, and scaling zero by
  // anything leaves it alone. Said outright because the CDF approximation
  // would otherwise return 0.4999999991 and break the pair.
  if (quoted === 0.5) return 0.5;
  const k = volInflation(secondsLeft, volRatio);
  if (!(k > 0)) return quoted;
  // Computed on the near side and mirrored, so that fair(p) and fair(1-p) sum
  // to exactly one rather than to one plus whatever the CDF approximation
  // happens to leave behind.
  const near = quoted <= 0.5 ? quoted : 1 - quoted;
  const f = clamp(normCdf(invNormCdf(near) / k), 1e-9, 0.5);
  return quoted <= 0.5 ? f : 1 - f;
}

// =========================================================================
// the touch probability
// =========================================================================

/**
 * The flip detector rests on a different exact formula: for a driftless walk
 * currently |z| standard deviations clear of a level, the chance of touching
 * that level before the horizon is 2*N(-|z|) by the reflection principle.
 *
 * Measured against this tape it is wrong in two directions at once.
 *
 * Near the target it is too HIGH — by 7.6 points at z = 0.25 with fifteen
 * seconds to run. The reflection principle assumes the level is watched
 * continuously; the app resolves a flip once a second, so a path that crosses
 * and comes back inside a second never counts. That is the classical
 * discretely-monitored barrier problem, and its known answer is that the
 * effective level sits further away by 0.5826 * sigma * sqrt(dt).
 *
 * Far from the target it is too LOW, because jumps reach levels a lognormal
 * would not.
 *
 * So the correction has two parameters: push the level away by `shift`, then
 * widen the walk by `width`. Fitted per cell that lands within a tenth of a
 * point of the measured rate through most of the grid, against 1 to 8 points
 * for a single parameter. And the fitted shift is not a free number — in the
 * cells where the diffusion assumption holds best it comes out at +0.150,
 * +0.104, +0.072, +0.051, +0.039 against a theory of +0.150, +0.106, +0.075,
 * +0.053, +0.038. The measurement recovers the textbook constant.
 *
 * 1,984,000,000 samples over 2,000,000 blocks.
 */

export const TOUCH_HORIZONS = [15, 30, 60, 120, 240] as const;
export const TOUCH_SHIFT: number[][] = [
  [0.0163, 0.0603, 0.0937, 0.1145, 0.1274, 0.1370, 0.1437, 0.1499], // 15s
  [-0.0544, 0.0116, 0.0490, 0.0702, 0.0834, 0.0928, 0.0982, 0.1035], // 30s
  [-0.0767, -0.0078, 0.0266, 0.0456, 0.0574, 0.0656, 0.0686, 0.0720], // 60s
  [-0.0769, -0.0136, 0.0151, 0.0309, 0.0407, 0.0463, 0.0492, 0.0514], // 120s
  [-0.0649, -0.0114, 0.0112, 0.0212, 0.0291, 0.0347, 0.0365, 0.0394], // 240s
];
export const TOUCH_WIDTH: number[][] = [
  [1.3176, 1.1174, 1.0673, 1.0490, 1.0400, 1.0342, 1.0283, 1.0280], // 15s
  [1.1817, 1.0624, 1.0373, 1.0292, 1.0262, 1.0243, 1.0193, 1.0204], // 30s
  [1.1035, 1.0350, 1.0235, 1.0218, 1.0220, 1.0219, 1.0158, 1.0156], // 60s
  [1.0616, 1.0226, 1.0176, 1.0192, 1.0206, 1.0204, 1.0147, 1.0133], // 120s
  [1.0439, 1.0217, 1.0185, 1.0185, 1.0205, 1.0214, 1.0151, 1.0133], // 240s
];
export const TOUCH_RESIDUAL: number[][] = [
  [0.03087, 0.01794, 0.01019, 0.00602, 0.00408, 0.00264, 0.00169, 0.00098], // 15s
  [0.02911, 0.01299, 0.00621, 0.00334, 0.00178, 0.00060, 0.00041, 0.00051], // 30s
  [0.02145, 0.00717, 0.00281, 0.00142, 0.00057, 0.00035, 0.00043, 0.00052], // 60s
  [0.01260, 0.00287, 0.00086, 0.00031, 0.00049, 0.00065, 0.00087, 0.00044], // 120s
  [0.00500, 0.00096, 0.00110, 0.00089, 0.00114, 0.00101, 0.00182, 0.00178], // 240s
];
export const TOUCH_N: number[][] = [
  [3432062, 8392322, 10557666, 9911014, 9920324, 9336238, 7798518, 4651856], // 15s
  [1716142, 4195980, 5279116, 4955144, 4960222, 4667990, 3899316, 2326090], // 30s
  [857924, 2097870, 2639350, 2477816, 2479858, 2334138, 1949830, 1163214], // 60s
  [428924, 1048898, 1319746, 1239064, 1240086, 1167106, 974518, 581658], // 120s
  [214324, 524396, 659758, 620366, 619746, 583684, 486914, 290812], // 240s
];
// worst |measured - model| per cell, in probability points:
//  15s: 3.09 1.79 1.02 0.60 0.41 0.26 0.17 0.10
//  30s: 2.91 1.30 0.62 0.33 0.18 0.06 0.04 0.05
//  60s: 2.15 0.72 0.28 0.14 0.06 0.03 0.04 0.05
//  120s: 1.26 0.29 0.09 0.03 0.05 0.07 0.09 0.04
//  240s: 0.50 0.10 0.11 0.09 0.11 0.10 0.18 0.18
// blocks 2,000,000  total samples 1,984,000,000  runtime 569s

/**
 * The chance of touching a level |z| standard deviations away before the
 * horizon runs out, as this tape actually does it.
 */
export function touchProbabilityAt(
  z: number,
  horizonSeconds: number,
  volRatio: number,
): number {
  const az = Math.abs(z);
  if (!Number.isFinite(az)) return 0;
  const h = interpolate(TOUCH_HORIZONS, clamp(horizonSeconds, 1, 3_600));
  const v = interpolate(VOL_POINTS, clamp(volRatio, 0.15, 4));
  const at = (t: number[][], hi: number, vi: number) => t[hi][vi];
  const blend = (t: number[][]) => {
    const a = at(t, h.i, v.i) + (at(t, h.i, v.j) - at(t, h.i, v.i)) * v.t;
    const b = at(t, h.j, v.i) + (at(t, h.j, v.j) - at(t, h.j, v.i)) * v.t;
    return a + (b - a) * h.t;
  };
  const shift = blend(TOUCH_SHIFT);
  const width = clamp(blend(TOUCH_WIDTH), 0.5, 2);
  return clamp(2 * normCdf(-Math.max(az + shift, 0) / width), 0, 1);
}

/** Independent samples behind the touch cell a state falls in. */
export function touchSamples(horizonSeconds: number, volRatio: number): number {
  const h = interpolate(TOUCH_HORIZONS, clamp(horizonSeconds, 1, 3_600));
  const v = interpolate(VOL_POINTS, clamp(volRatio, 0.15, 4));
  return Math.min(TOUCH_N[h.i][v.i], TOUCH_N[h.j][v.j]);
}

/**
 * How far the two-parameter fit sits from the measured rates in this state,
 * in probability points — the honest width of the answer.
 *
 * It is worst where the tape is calmest and the clock shortest, which is
 * exactly where the walk is least like a walk: a fixed microstructure bounce
 * with almost no diffusion under it is not a lognormal at any width.
 */
export function touchResidual(horizonSeconds: number, volRatio: number): number {
  const h = interpolate(TOUCH_HORIZONS, clamp(horizonSeconds, 1, 3_600));
  const v = interpolate(VOL_POINTS, clamp(volRatio, 0.15, 4));
  return Math.max(TOUCH_RESIDUAL[h.i][v.i], TOUCH_RESIDUAL[h.j][v.j]);
}
