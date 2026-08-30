import type { Round } from './types';

export const ROUND_LENGTHS = [
  { ms: 60_000, label: '1 min' },
  { ms: 5 * 60_000, label: '5 min' },
  { ms: 15 * 60_000, label: '15 min' },
  { ms: 60 * 60_000, label: '1 hour' },
] as const;

export const DEFAULT_ROUND_MS = 15 * 60_000;

/**
 * Rounds are pinned to the wall clock, so a 15-minute market always settles
 * on :00 / :15 / :30 / :45 the way the real one does. Every supported length
 * divides an hour evenly, and the epoch is hour-aligned, so plain modulo
 * arithmetic is enough.
 */
export function roundIndexAt(ts: number, roundMs: number): number {
  return Math.floor(ts / roundMs);
}

export function roundBounds(ts: number, roundMs: number) {
  const index = roundIndexAt(ts, roundMs);
  return { index, startsAt: index * roundMs, endsAt: (index + 1) * roundMs };
}

export function makeRound(ts: number, roundMs: number, strike: number): Round {
  const { index, startsAt, endsAt } = roundBounds(ts, roundMs);
  return {
    id: `r${index}-${roundMs}`,
    index,
    startsAt,
    endsAt,
    strike,
    settled: false,
  };
}

/** Ties resolve down, matching "settles above the target" wording. */
export function settleRound(round: Round, closePrice: number): Round {
  return {
    ...round,
    settled: true,
    closePrice,
    result: closePrice > round.strike ? 'up' : 'down',
  };
}
