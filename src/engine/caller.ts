import { clamp } from '../lib/math';
import type { Side } from './types';

/**
 * A locked call: one yes/no committed partway through a round and never
 * revisited, plus the small model that makes it and adjusts when it is wrong.
 *
 * The model is a logistic regression over four features, updated by one
 * gradient step per graded call. It starts weighted so its output matches the
 * theoretical probability of finishing above the target, and learns from
 * there — so on day one it is the textbook answer, and it only departs from
 * that where outcomes actually justify it.
 */

export interface CallFeatures {
  /** Distance to the target in standard deviations of what is left to run. */
  z: number;
  /** Which side of the UT Bot trailing stop price sits on: +1, -1 or 0. */
  bias: number;
  /** Recent drift, in the same standardised units as z. */
  momentum: number;
}

export interface CallModel {
  /** [intercept, z, bias, momentum] */
  weights: [number, number, number, number];
  /** How many graded calls have been folded in. */
  trained: number;
}

/**
 * A logistic curve at 1.6x approximates the normal CDF closely, so an
 * untrained model reproduces the option-pricing answer rather than a coin
 * flip: it starts at the best available prior and adjusts from there.
 */
export const INITIAL_MODEL: CallModel = {
  weights: [0, 1.6, 0, 0],
  trained: 0,
};

export const LEARNING_RATE = 0.06;
/** Weights are held in a sane band so one strange run cannot wreck the model. */
const WEIGHT_LIMIT = 6;

export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function vector(f: CallFeatures): [number, number, number, number] {
  return [1, clamp(f.z, -6, 6), clamp(f.bias, -1, 1), clamp(f.momentum, -6, 6)];
}

/** Probability this model gives to finishing above the target. */
export function predictUp(features: CallFeatures, model: CallModel): number {
  const x = vector(features);
  const w = model.weights;
  return sigmoid(w[0] * x[0] + w[1] * x[1] + w[2] * x[2] + w[3] * x[3]);
}

/**
 * Folds one graded call back into the model.
 *
 * Standard logistic descent: the update is proportional to how wrong the
 * prediction was, so a confident miss moves the weights hard and a call that
 * was already right barely moves them at all. That is the whole of "learning
 * from the mistake" — there is no memory of individual calls, only the
 * weights they left behind.
 */
export function learn(
  model: CallModel,
  features: CallFeatures,
  finishedUp: boolean,
  rate = LEARNING_RATE,
): CallModel {
  const x = vector(features);
  const p = predictUp(features, model);
  const error = (finishedUp ? 1 : 0) - p;
  const weights = model.weights.map((w, i) =>
    clamp(w + rate * error * x[i], -WEIGHT_LIMIT, WEIGHT_LIMIT),
  ) as [number, number, number, number];
  return { weights, trained: model.trained + 1 };
}

/**
 * Standardised distance from price to target: how many standard deviations of
 * remaining movement separate them. This is the one feature that genuinely
 * carries information, and why a call late in a round can be confident.
 */
export function standardisedGap(
  spot: number,
  strike: number,
  annualVol: number,
  msLeft: number,
): number {
  const secondsLeft = Math.max(msLeft, 1_000) / 1_000;
  const tau = secondsLeft / (365 * 24 * 60 * 60);
  const sd = annualVol * Math.sqrt(tau);
  if (!(sd > 1e-12) || spot <= 0 || strike <= 0) return 0;
  return clamp(Math.log(spot / strike) / sd, -6, 6);
}

/** The call itself: a side, and how sure the model was when it committed. */
export function makeCall(
  features: CallFeatures,
  model: CallModel,
): { side: 'up' | 'down'; confidence: number; pUp: number } {
  const pUp = predictUp(features, model);
  const side = pUp >= 0.5 ? 'up' : 'down';
  return { side, confidence: side === 'up' ? pUp : 1 - pUp, pUp };
}

// =========================================================================
// the locked call
// =========================================================================

/** Four minutes into the fifteen-minute round, as asked. */
export const CALL_LOCK_MS = 4 * 60_000;
/** Above this the call counts as conviction rather than a lean. */
export const CONFIDENT_AT = 0.65;

/**
 * How far into a round the call commits. Four minutes on the fifteen-minute
 * market; on a shorter round it scales down so there is still most of the
 * round left to be wrong about.
 */
export function lockDelayFor(roundMs: number): number {
  return Math.min(CALL_LOCK_MS, Math.max(5_000, roundMs * 0.27));
}

/**
 * The latest a call may still be made. Opening the app with a minute left
 * should not produce a near-certain "call" off a round that is already
 * decided — there has to be enough left to be wrong about.
 */
export function callDeadlineFor(roundMs: number): number {
  return roundMs - lockDelayFor(roundMs);
}

export type CallGrade = 'right' | 'wrong';

/**
 * One committed answer. Everything the model saw is stored on it, because
 * grading trains on what it knew at the moment it decided — not on anything
 * that turned up afterwards.
 */
export interface LockedCall {
  id: string;
  roundId: string;
  roundIndex: number;
  roundEndsAt: number;
  lockedAt: number;
  /** The answer. Written once and never revisited. */
  side: Side;
  /** How sure it was in that side, 0.5–1. */
  confidence: number;
  /** The model's probability of finishing up, before it picked a side. */
  pUp: number;
  spot: number;
  strike: number;
  features: CallFeatures;
  /**
   * The weights it decided with. Kept on the call so the reasoning can be
   * replayed later even after grading has moved the model on.
   */
  weights: [number, number, number, number];
  /** Which way the round actually went, filled in when it settles. */
  outcome?: Side;
  closePrice?: number;
  grade?: CallGrade;
  gradedAt?: number;
}

/** What a graded call teaches: which way the round finished. */
export function outcomeFromGrade(call: LockedCall, grade: CallGrade): boolean {
  return grade === 'right' ? call.side === 'up' : call.side !== 'up';
}

export interface CalibrationBucket {
  label: string;
  /** The confidence it claimed in this band, averaged. */
  claimed: number;
  graded: number;
  right: number;
  /** How often it was actually right. Null until something lands here. */
  actual: number | null;
}

export interface CallStats {
  graded: number;
  right: number;
  hitRate: number | null;
  /** The same, over calls it made with real conviction. */
  confidentGraded: number;
  confidentRight: number;
  confidentHitRate: number | null;
  /** Signed run of the latest results: +3 is three right in a row. */
  streak: number;
  calibration: CalibrationBucket[];
}

const BANDS: [number, number][] = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0001],
];

/**
 * How the calls have actually gone. Calibration is the part worth reading:
 * a model that says 80% should be right about eight times in ten, and one
 * that says 80% and lands 55% is confidently fooling itself.
 */
export function callStats(calls: LockedCall[]): CallStats {
  const graded = calls.filter((c) => c.grade);
  const right = graded.filter((c) => c.grade === 'right');
  const bold = graded.filter((c) => c.confidence >= CONFIDENT_AT);
  const boldRight = bold.filter((c) => c.grade === 'right');

  // Newest first, so the streak reads back from the most recent call.
  const ordered = [...graded].sort((a, b) => (b.gradedAt ?? 0) - (a.gradedAt ?? 0));
  let streak = 0;
  if (ordered.length > 0) {
    const first = ordered[0].grade;
    while (streak < ordered.length && ordered[streak].grade === first) streak++;
    if (first === 'wrong') streak = -streak;
  }

  const calibration = BANDS.map(([lo, hi]) => {
    const inBand = graded.filter((c) => c.confidence >= lo && c.confidence < hi);
    const hits = inBand.filter((c) => c.grade === 'right').length;
    const claimed =
      inBand.length > 0
        ? inBand.reduce((sum, c) => sum + c.confidence, 0) / inBand.length
        : (lo + Math.min(hi, 1)) / 2;
    return {
      label: `${Math.round(lo * 100)}–${Math.round(Math.min(hi, 1) * 100)}%`,
      claimed,
      graded: inBand.length,
      right: hits,
      actual: inBand.length > 0 ? hits / inBand.length : null,
    };
  });

  return {
    graded: graded.length,
    right: right.length,
    hitRate: graded.length > 0 ? right.length / graded.length : null,
    confidentGraded: bold.length,
    confidentRight: boldRight.length,
    confidentHitRate: bold.length > 0 ? boldRight.length / bold.length : null,
    streak,
    calibration,
  };
}

/**
 * How much each feature moved the answer, in probability points, measured by
 * taking that feature out and seeing where the call lands without it.
 */
export function contributions(
  features: CallFeatures,
  weights: [number, number, number, number],
): { key: 'z' | 'bias' | 'momentum'; value: number; weight: number; shift: number }[] {
  const model: CallModel = { weights, trained: 0 };
  const full = predictUp(features, model);
  const keys: ('z' | 'bias' | 'momentum')[] = ['z', 'bias', 'momentum'];
  return keys.map((key, i) => {
    const without = predictUp({ ...features, [key]: 0 }, model);
    return { key, value: features[key], weight: weights[i + 1], shift: full - without };
  });
}
