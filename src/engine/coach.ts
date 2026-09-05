import { clamp } from '../lib/math';
import { bandFor } from './edge';
import type { Side } from './types';

/**
 * The discipline coach.
 *
 * It cannot make a losing market profitable — nothing can, the house takes
 * 10% and the measurement says every price on the board is negative. What it
 * can do is stop the three things that actually empty an account, which are
 * not bad picks at all:
 *
 *   staking too much, staking more after a loss, and not stopping.
 *
 * Measured over 20,000 runs of 200 bets at the 3x band, starting from $1,000:
 * flat 1% stakes went broke 0.0% of the time, flat 10% went broke 69.5%, a
 * quarter of the bank each time 96.9%, and doubling after every loss 92.7%.
 * Same odds, same picks, every time — only the sizing changed. That is what
 * this is for.
 */

/** What survival looks like, measured. Used in the app to justify the caps. */
export const RUIN_TABLE = [
  { label: 'Flat 1% of the bank', broke: 0.0 },
  { label: 'Flat 2.5%', broke: 0.078 },
  { label: 'Flat 10%', broke: 0.695 },
  { label: 'Flat 25%', broke: 0.88 },
  { label: 'A quarter of the bank each time', broke: 0.969 },
  { label: 'Up 50% after every loss', broke: 0.824 },
  { label: 'Double after every loss', broke: 0.927 },
] as const;

export interface BetRecord {
  stake: number;
  at: number;
  side: Side;
  status: 'open' | 'won' | 'lost' | 'closed';
  pnl?: number;
  /** The implied probability paid for. */
  entryProb: number;
  multiplier: number;
  /** How much round was left when it went on. */
  msLeftAtEntry: number;
}

export interface CoachLimits {
  /** Most of the bank one ticket may risk. */
  maxStakePct: number;
  /** How far the session may fall before it calls time. */
  maxSessionLossPct: number;
  /** Losses in a row that trigger a forced break. */
  lossStreakStop: number;
  /** How long that break lasts. */
  cooldownMs: number;
  /** Most tickets allowed in a five-minute stretch. */
  maxBetsPer5Min: number;
}

export const DEFAULT_LIMITS: CoachLimits = {
  maxStakePct: 0.02,
  maxSessionLossPct: 0.25,
  lossStreakStop: 3,
  cooldownMs: 120_000,
  maxBetsPer5Min: 6,
};

/** CLEAR is not "good bet" — it only means nothing is flagged. */
export type Verdict = 'CLEAR' | 'WAIT' | 'STOP';

export interface CoachFinding {
  key: string;
  /** 1 nudges, 2 says wait, 3 says stop. */
  severity: 1 | 2 | 3;
  /** The words that go on the screen. Short, blunt, no hedging. */
  headline: string;
  detail: string;
}

export interface CoachCall {
  verdict: Verdict;
  /** The single line the banner shows. */
  headline: string;
  /** The one thing to do about it. */
  action: string;
  findings: CoachFinding[];
  /** Wall-clock time the forced break ends, or 0. */
  cooldownUntil: number;
  /** The biggest ticket the coach will sign off on right now. */
  stakeCap: number;
  /** Session profit and loss so far, in dollars. */
  sessionPnl: number;
  /** How far down the session is, as a fraction of where it started. */
  drawdown: number;
  lossStreak: number;
}

export interface CoachInput {
  /** Newest first. */
  bets: BetRecord[];
  balance: number;
  /** Balance when this session started. */
  sessionStart: number;
  now: number;
  /** The ticket being considered, if any. */
  proposedStake: number;
  proposedProb: number;
  msLeft: number;
  limits: CoachLimits;
}

const FIVE_MIN = 5 * 60_000;

/** Losses in a row, counting back from the most recent settled ticket. */
export function lossStreakOf(bets: BetRecord[]): number {
  let streak = 0;
  for (const bet of bets) {
    if (bet.status === 'open') continue;
    if (bet.status === 'lost') streak += 1;
    else break;
  }
  return streak;
}

/** The most recent settled loss, if the last thing to resolve was one. */
function lastLoss(bets: BetRecord[]): BetRecord | null {
  for (const bet of bets) {
    if (bet.status === 'open') continue;
    return bet.status === 'lost' ? bet : null;
  }
  return null;
}

/** Typical stake over the recent run, for spotting escalation. */
export function baselineStake(bets: BetRecord[], take = 8): number {
  const recent = bets.slice(0, take).map((b) => b.stake).sort((a, b) => a - b);
  if (recent.length === 0) return 0;
  const mid = Math.floor(recent.length / 2);
  return recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
}

// =========================================================================
// the detectors
// =========================================================================

/**
 * Everything the coach looks for, in the order it matters.
 *
 * Each one is a habit that measurably empties accounts, not a feeling about
 * the market. The coach has no view on whether a pick is good — it cannot,
 * nothing here is profitable — only on whether the way it is being taken is
 * survivable.
 */
export function findings(input: CoachInput): CoachFinding[] {
  const { bets, balance, sessionStart, now, proposedStake, proposedProb, msLeft, limits } = input;
  const out: CoachFinding[] = [];
  const settled = bets.filter((b) => b.status !== 'open');
  const streak = lossStreakOf(bets);
  const cap = balance * limits.maxStakePct;
  const drawdown = sessionStart > 0 ? (sessionStart - balance) / sessionStart : 0;

  // --- the forced break ---------------------------------------------------
  if (streak >= limits.lossStreakStop) {
    const last = settled[0];
    const since = last ? now - last.at : Infinity;
    if (since < limits.cooldownMs) {
      out.push({
        key: 'cooldown',
        severity: 3,
        headline: `${streak} LOSSES IN A ROW — SIT OUT`,
        detail:
          `A break after ${limits.lossStreakStop} is the whole point of having a rule: ` +
          'the run is not evidence about the next round, but the urge to make it back is ' +
          'what turns a bad hour into a bad day.',
      });
    }
  }

  // --- the session is over ------------------------------------------------
  if (drawdown >= limits.maxSessionLossPct) {
    out.push({
      key: 'drawdown',
      severity: 3,
      headline: `DOWN ${Math.round(drawdown * 100)}% — DONE FOR TODAY`,
      detail:
        `You set the line at ${Math.round(limits.maxSessionLossPct * 100)}%. ` +
        'A stop you move is not a stop. Come back to a fresh session.',
    });
  }

  if (proposedStake > 0) {
    // --- size ------------------------------------------------------------
    const pctOfBank = balance > 0 ? proposedStake / balance : 1;
    if (pctOfBank > limits.maxStakePct * 5) {
      out.push({
        key: 'oversized',
        severity: 3,
        headline: `${Math.round(pctOfBank * 100)}% OF YOUR BANK — NO`,
        detail:
          `Measured over 20,000 runs: flat 10% stakes went broke 69.5% of the time in ` +
          '200 bets, flat 1% went broke 0.0%. Same picks, same odds. Size is what kills.',
      });
    } else if (pctOfBank > limits.maxStakePct) {
      out.push({
        key: 'oversized',
        severity: 2,
        headline: `OVER YOUR ${Math.round(limits.maxStakePct * 100)}% LIMIT`,
        detail: `Your own cap is ${cap.toFixed(2)}. This is ${proposedStake.toFixed(2)}.`,
      });
    }

    // --- chasing ----------------------------------------------------------
    const previous = settled[0];
    if (previous && previous.status === 'lost' && previous.stake > 0) {
      const ratio = proposedStake / previous.stake;
      if (ratio >= 1.8) {
        out.push({
          key: 'martingale',
          severity: 3,
          headline: 'DOUBLING AFTER A LOSS — DO NOT',
          detail:
            'Doubling up went broke 92.7% of 20,000 runs. It wins small most nights and ' +
            'takes everything on the one night it does not, which is the trade nobody ' +
            'means to make.',
        });
      } else if (ratio >= 1.25) {
        out.push({
          key: 'chasing',
          severity: 2,
          headline: 'BIGGER AFTER A LOSS — THAT IS CHASING',
          detail:
            `Last ticket lost ${previous.stake.toFixed(2)} and this one is ` +
            `${proposedStake.toFixed(2)}. Raising 50% after each loss went broke 82.4% ` +
            'of the time. Go back to your usual size.',
        });
      }
    }

    const base = baselineStake(bets);
    if (base > 0 && proposedStake > base * 2.5 && streak > 0) {
      out.push({
        key: 'escalating',
        severity: 2,
        headline: 'THIS IS FAR BIGGER THAN YOUR USUAL',
        detail: `Your recent size is about ${base.toFixed(2)} a ticket.`,
      });
    }

    // --- revenge ----------------------------------------------------------
    const loss = lastLoss(bets);
    if (loss && now - loss.at < 20_000 && streak > 0) {
      out.push({
        key: 'revenge',
        severity: 2,
        headline: 'STRAIGHT BACK IN AFTER A LOSS',
        detail:
          `That was ${Math.round((now - loss.at) / 1000)}s ago. Give it a round. The market ` +
          'does not know you just lost and will still be here.',
      });
    }

    // --- frequency --------------------------------------------------------
    const recent = bets.filter((b) => now - b.at < FIVE_MIN).length;
    if (recent >= limits.maxBetsPer5Min) {
      out.push({
        key: 'overtrading',
        severity: 2,
        headline: `${recent} TICKETS IN FIVE MINUTES`,
        detail:
          'Every ticket pays the house its cut. Volume is the one cost you control ' +
          'completely, and it compounds faster than any of the picks.',
      });
    }

    // --- the price ---------------------------------------------------------
    const band = bandFor(Math.min(proposedProb, 1 - proposedProb));
    if (band && band.ev < -0.05) {
      out.push({
        key: 'badprice',
        severity: 1,
        headline: 'WORST-PRICED PART OF THE BOARD',
        detail:
          `Tickets around ${band.pays.toFixed(1)}x measured ${(band.ev * 100).toFixed(1)}% ` +
          `per dollar over ${band.n.toLocaleString()} bets — the weakest band there is.`,
      });
    }

    // --- the clock ---------------------------------------------------------
    if (msLeft > 0 && msLeft < 20_000) {
      out.push({
        key: 'late',
        severity: 1,
        headline: 'SECONDS LEFT — NOTHING CAN HAPPEN',
        detail:
          'This late the price is already what the result will be. You are paying the ' +
          'house cut for almost no uncertainty.',
      });
    }
  }

  return out.sort((a, b) => b.severity - a.severity);
}

/** The verdict, the words, and what to do about it. */
export function coach(input: CoachInput): CoachCall {
  const found = findings(input);
  const streak = lossStreakOf(input.bets);
  const settled = input.bets.filter((b) => b.status !== 'open');
  const drawdown =
    input.sessionStart > 0 ? (input.sessionStart - input.balance) / input.sessionStart : 0;

  const worst = found[0]?.severity ?? 0;
  const verdict: Verdict = worst >= 3 ? 'STOP' : worst === 2 ? 'WAIT' : 'CLEAR';

  const cooling = found.find((f) => f.key === 'cooldown');
  const last = settled[0];
  const cooldownUntil = cooling && last ? last.at + input.limits.cooldownMs : 0;

  const stakeCap = Math.max(1, Math.floor(input.balance * input.limits.maxStakePct));

  let headline: string;
  let action: string;
  if (verdict === 'STOP') {
    headline = found[0].headline;
    action = cooling
      ? `Wait ${Math.max(0, Math.ceil((cooldownUntil - input.now) / 1000))}s`
      : found[0].key === 'drawdown'
        ? 'Close the app'
        : `Drop to $${stakeCap} or skip it`;
  } else if (verdict === 'WAIT') {
    headline = found[0].headline;
    action = `Your size is $${stakeCap}`;
  } else if (found.length > 0) {
    headline = found[0].headline;
    action = 'Your call — nothing serious flagged';
  } else {
    headline = 'NOTHING FLAGGED';
    action = 'Not the same as a good bet';
  }

  return {
    verdict,
    headline,
    action,
    findings: found,
    cooldownUntil,
    stakeCap,
    sessionPnl: input.balance - input.sessionStart,
    drawdown: clamp(drawdown, -10, 1),
    lossStreak: streak,
  };
}
