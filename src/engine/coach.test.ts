import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  RUIN_TABLE,
  baselineStake,
  coach,
  findings,
  lossStreakOf,
  type BetRecord,
  type CoachInput,
} from './coach';

const NOW = 1_700_000_000_000;

function bet(over: Partial<BetRecord> = {}): BetRecord {
  return {
    stake: 20,
    at: NOW - 60_000,
    side: 'up',
    status: 'lost',
    entryProb: 0.45,
    multiplier: 2.1,
    msLeftAtEntry: 300_000,
    ...over,
  };
}

function input(over: Partial<CoachInput> = {}): CoachInput {
  return {
    bets: [],
    balance: 1_000,
    sessionStart: 1_000,
    now: NOW,
    proposedStake: 20,
    proposedProb: 0.45,
    msLeft: 300_000,
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

const keys = (i: CoachInput) => findings(i).map((f) => f.key);

describe('reading the run', () => {
  it('counts losses back from the most recent settled ticket', () => {
    expect(lossStreakOf([])).toBe(0);
    expect(lossStreakOf([bet({ status: 'won' })])).toBe(0);
    expect(lossStreakOf([bet(), bet(), bet({ status: 'won' }), bet()])).toBe(2);
  });

  it('looks past tickets that have not resolved yet', () => {
    // An open ticket is not evidence either way, so it does not break a run.
    expect(lossStreakOf([bet({ status: 'open' }), bet(), bet()])).toBe(2);
  });

  it('takes the middle of recent sizes, so one big ticket is not the baseline', () => {
    const sizes = [10, 10, 10, 200].map((stake) => bet({ stake }));
    expect(baselineStake(sizes)).toBe(10);
    expect(baselineStake([])).toBe(0);
  });
});

describe('the things that actually empty an account', () => {
  it('stops a bet that is a big slice of the bank', () => {
    const big = input({ proposedStake: 300 });
    expect(keys(big)).toContain('oversized');
    expect(findings(big)[0].severity).toBe(3);
    expect(coach(big).verdict).toBe('STOP');
  });

  it('only warns when it is over the limit but not wild', () => {
    const over = input({ proposedStake: 40 });
    const found = findings(over).find((f) => f.key === 'oversized')!;
    expect(found.severity).toBe(2);
    expect(coach(over).verdict).toBe('WAIT');
  });

  it('says nothing about a bet inside the limit', () => {
    expect(keys(input({ proposedStake: 20 }))).not.toContain('oversized');
  });

  it('stops a double-up after a loss', () => {
    const chasing = input({
      bets: [bet({ stake: 20, status: 'lost', at: NOW - 60_000 })],
      proposedStake: 45,
    });
    expect(keys(chasing)).toContain('martingale');
    expect(coach(chasing).verdict).toBe('STOP');
  });

  it('warns on a smaller raise after a loss', () => {
    const nudged = input({
      bets: [bet({ stake: 20, status: 'lost', at: NOW - 60_000 })],
      proposedStake: 27,
    });
    expect(keys(nudged)).toContain('chasing');
    expect(keys(nudged)).not.toContain('martingale');
  });

  it('does not call it chasing after a win', () => {
    const afterWin = input({
      bets: [bet({ stake: 20, status: 'won', at: NOW - 60_000 })],
      proposedStake: 45,
    });
    expect(keys(afterWin)).not.toContain('martingale');
    expect(keys(afterWin)).not.toContain('chasing');
  });

  it('forces a break after a losing run', () => {
    const tilted = input({
      bets: [
        bet({ at: NOW - 10_000 }),
        bet({ at: NOW - 70_000 }),
        bet({ at: NOW - 130_000 }),
      ],
      proposedStake: 20,
    });
    const call = coach(tilted);
    expect(call.verdict).toBe('STOP');
    expect(call.headline).toContain('3 LOSSES');
    expect(call.cooldownUntil).toBeGreaterThan(NOW);
    expect(call.action).toMatch(/Wait \d+s/);
  });

  it('lets you back in once the break is served', () => {
    const served = input({
      bets: [
        bet({ at: NOW - 200_000 }),
        bet({ at: NOW - 260_000 }),
        bet({ at: NOW - 320_000 }),
      ],
    });
    expect(keys(served)).not.toContain('cooldown');
    expect(coach(served).cooldownUntil).toBe(0);
  });

  it('calls the session when the drawdown line is hit', () => {
    const done = input({ balance: 700, sessionStart: 1_000 });
    const call = coach(done);
    expect(call.verdict).toBe('STOP');
    expect(call.headline).toContain('DOWN 30%');
    expect(call.action).toBe('Close the app');
    expect(call.drawdown).toBeCloseTo(0.3, 6);
  });

  it('spots piling straight back in after a loss', () => {
    const revenge = input({
      bets: [bet({ at: NOW - 5_000 })],
      proposedStake: 20,
    });
    expect(keys(revenge)).toContain('revenge');
  });

  it('spots too many tickets in five minutes', () => {
    const busy = input({
      bets: Array.from({ length: 6 }, (_, i) =>
        bet({ at: NOW - i * 30_000, status: 'won' }),
      ),
    });
    expect(keys(busy)).toContain('overtrading');
  });

  it('flags the worst-priced part of the board, gently', () => {
    // Around 42% implied, measured at -6.3% per dollar.
    const bad = input({ proposedProb: 0.42 });
    const found = findings(bad).find((f) => f.key === 'badprice')!;
    expect(found.severity).toBe(1);
    expect(coach(bad).verdict).toBe('CLEAR');
  });

  it('flags an entry with seconds left', () => {
    expect(keys(input({ msLeft: 8_000 }))).toContain('late');
  });

  it('says nothing at all when nothing is wrong', () => {
    const fine = input({ proposedStake: 15, proposedProb: 0.3, msLeft: 400_000 });
    expect(findings(fine)).toHaveLength(0);
    const call = coach(fine);
    expect(call.verdict).toBe('CLEAR');
    expect(call.headline).toBe('NOTHING FLAGGED');
  });

  it('never calls a clear board a good bet', () => {
    // The distinction the whole app rests on: nothing here is profitable, so
    // the coach is not allowed to imply otherwise.
    const call = coach(input({ proposedStake: 10, proposedProb: 0.3, msLeft: 400_000 }));
    expect(call.action).toBe('Not the same as a good bet');
    expect(call.headline).not.toMatch(/GOOD|GO|BUY|TAKE/);
  });
});

describe('what it tells you to do', () => {
  it('always offers a size you can actually take', () => {
    // sessionStart matched to the balance, so oversizing is the only problem
    // in play — otherwise the drawdown rule outranks it and rightly says so.
    const call = coach(input({ balance: 640, sessionStart: 640, proposedStake: 300 }));
    expect(call.stakeCap).toBe(12);
    expect(call.action).toContain('$12');
  });

  it('leads with closing the app when the day is already lost', () => {
    // Both wrong at once: too big a ticket and past the drawdown line. The
    // one that ends the session outranks the one that resizes it.
    const call = coach(input({ balance: 640, sessionStart: 1_000, proposedStake: 300 }));
    expect(call.verdict).toBe('STOP');
    expect(call.action).toBe('Close the app');
  });

  it('keeps the cap at a dollar even on an empty account', () => {
    expect(coach(input({ balance: 0, proposedStake: 5 })).stakeCap).toBe(1);
  });

  it('reports the session honestly, up or down', () => {
    expect(coach(input({ balance: 1_200, sessionStart: 1_000 })).sessionPnl).toBe(200);
    expect(coach(input({ balance: 900, sessionStart: 1_000 })).sessionPnl).toBe(-100);
    expect(coach(input({ balance: 1_200, sessionStart: 1_000 })).drawdown).toBeLessThan(0);
  });

  it('leads with the worst thing, not the first thing', () => {
    const everything = input({
      bets: [bet({ at: NOW - 3_000, stake: 20 })],
      proposedStake: 400,
      proposedProb: 0.42,
      msLeft: 8_000,
    });
    const call = coach(everything);
    expect(call.verdict).toBe('STOP');
    expect(call.findings[0].severity).toBe(3);
    expect(call.findings.length).toBeGreaterThan(2);
  });
});

describe('the numbers it quotes', () => {
  it('carries the measured ruin table', () => {
    expect(RUIN_TABLE[0].broke).toBe(0);
    const martingale = RUIN_TABLE.find((r) => r.label.startsWith('Double'))!;
    expect(martingale.broke).toBeGreaterThan(0.9);
    // Bigger flat stakes must never look safer than smaller ones.
    const flats = RUIN_TABLE.filter((r) => r.label.startsWith('Flat'));
    for (let i = 1; i < flats.length; i++) {
      expect(flats[i].broke).toBeGreaterThan(flats[i - 1].broke);
    }
  });
});
