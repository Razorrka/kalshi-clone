import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUND_MS, makeRound, roundBounds, settleRound } from './rounds';

const at = (iso: string) => Date.parse(iso);

describe('roundBounds', () => {
  it('pins 15-minute rounds to the quarter hour', () => {
    const { startsAt, endsAt } = roundBounds(at('2026-03-04T15:52:31Z'), DEFAULT_ROUND_MS);
    expect(new Date(startsAt).toISOString()).toBe('2026-03-04T15:45:00.000Z');
    expect(new Date(endsAt).toISOString()).toBe('2026-03-04T16:00:00.000Z');
  });

  it('puts an instant exactly on a boundary into the round it opens', () => {
    const ts = at('2026-03-04T16:00:00Z');
    const { startsAt, endsAt } = roundBounds(ts, DEFAULT_ROUND_MS);
    expect(startsAt).toBe(ts);
    expect(endsAt).toBe(ts + DEFAULT_ROUND_MS);
  });

  it('aligns every supported length to the clock', () => {
    const ts = at('2026-03-04T15:52:31Z');
    for (const ms of [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]) {
      const { startsAt, endsAt } = roundBounds(ts, ms);
      expect(startsAt % ms).toBe(0);
      expect(endsAt - startsAt).toBe(ms);
      expect(startsAt).toBeLessThanOrEqual(ts);
      expect(endsAt).toBeGreaterThan(ts);
    }
  });

  it('gives consecutive rounds contiguous, non-overlapping windows', () => {
    const a = roundBounds(at('2026-03-04T15:52:31Z'), DEFAULT_ROUND_MS);
    const b = roundBounds(a.endsAt, DEFAULT_ROUND_MS);
    expect(b.startsAt).toBe(a.endsAt);
    expect(b.index).toBe(a.index + 1);
  });
});

describe('settleRound', () => {
  const round = makeRound(at('2026-03-04T15:52:31Z'), DEFAULT_ROUND_MS, 78_000);

  it('settles Up only when the close is strictly above the target', () => {
    expect(settleRound(round, 78_000.01).result).toBe('up');
    expect(settleRound(round, 79_000).result).toBe('up');
  });

  it('settles a tie as Down', () => {
    expect(settleRound(round, 78_000).result).toBe('down');
  });

  it('settles Down below the target', () => {
    expect(settleRound(round, 77_999.99).result).toBe('down');
  });

  it('records the close and marks the round settled without mutating it', () => {
    const settled = settleRound(round, 78_123.45);
    expect(settled.settled).toBe(true);
    expect(settled.closePrice).toBe(78_123.45);
    expect(round.settled).toBe(false);
    expect(round.closePrice).toBeUndefined();
  });
});

describe('makeRound', () => {
  it('gives rounds of different lengths distinct ids at the same instant', () => {
    const ts = at('2026-03-04T15:52:31Z');
    const a = makeRound(ts, 60_000, 78_000);
    const b = makeRound(ts, 15 * 60_000, 78_000);
    expect(a.id).not.toBe(b.id);
  });
});
