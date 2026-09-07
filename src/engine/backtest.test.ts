import { describe, expect, it } from 'vitest';
import { RULES, backtest, backtestAll, rsi, summarise, wilson } from './backtest';

const won = (multiplier: number) => ({ won: true, multiplier });
const lost = (multiplier: number) => ({ won: false, multiplier });

describe('summarising a run', () => {
  it('says nothing about an empty run', () => {
    const r = summarise('none', [], 0);
    expect(r.bets).toBe(0);
    expect(r.ev).toBe(0);
  });

  it('computes the return per dollar, not the win rate', () => {
    // Four bets at 3x, one winner: $3 back on $4 staked.
    const r = summarise('x', [won(3), lost(3), lost(3), lost(3)], 2);
    expect(r.winRate).toBe(0.25);
    expect(r.ev).toBeCloseTo(-0.25, 10);
    expect(r.averagePayout).toBe(3);
  });

  it('shows a high win rate can still lose money', () => {
    // Nine wins in ten at 1.05x is a 90% win rate and a losing strategy.
    const bets = [...Array(9).fill(won(1.05)), lost(1.05)];
    const r = summarise('chalk', bets, 5);
    expect(r.winRate).toBe(0.9);
    expect(r.ev).toBeLessThan(0);
    expect(r.profitFactor).toBeLessThan(1);
  });

  it('reports a profit factor above one only on a real profit', () => {
    expect(summarise('a', [won(3), lost(3)], 1).profitFactor).toBe(2);
    expect(summarise('b', [won(1.5), lost(1.5)], 1).profitFactor).toBe(0.5);
  });

  it('widens the interval when the payout is big', () => {
    const tight = summarise('t', Array.from({ length: 400 }, (_, i) =>
      i % 2 === 0 ? won(2) : lost(2)), 200);
    const wide = summarise('w', Array.from({ length: 400 }, (_, i) =>
      i % 20 === 0 ? won(20) : lost(20)), 200);
    // Same number of bets, far less certainty about the long-shot rule.
    expect(wide.ci).toBeGreaterThan(tight.ci * 2);
  });

  it('keeps a holdout that never touched the first half', () => {
    const bets = [...Array(10).fill(won(2)), ...Array(10).fill(lost(2))];
    const r = summarise('h', bets, 10);
    expect(r.holdoutBets).toBe(10);
    // Every holdout bet lost, so its return is -100% whatever the first half did.
    expect(r.holdoutEv).toBe(-1);
    expect(r.ev).toBe(0);
  });

  it('never reports a drawdown outside 0 to 1', () => {
    const r = summarise('d', Array.from({ length: 200 }, (_, i) =>
      i < 100 ? won(2.2) : lost(2.2)), 100);
    expect(r.maxDrawdown).toBeGreaterThan(0);
    expect(r.maxDrawdown).toBeLessThanOrEqual(1);
  });
});

describe('rsi', () => {
  it('reads 100 on an unbroken rise and 0 on an unbroken fall', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up)).toBe(100);
    expect(rsi([...up].reverse())).toBe(0);
  });

  it('reads 50 on a flat run and before it has enough data', () => {
    expect(rsi(new Array(30).fill(5))).toBe(50);
    expect(rsi([1, 2, 3])).toBe(50);
  });
});

describe('the rules on offer', () => {
  it('offers a control to measure the others against', () => {
    expect(RULES.some((r) => r.key === 'random')).toBe(true);
  });

  it('gives every rule a name and a description', () => {
    for (const r of RULES) {
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.blurb.length).toBeGreaterThan(10);
    }
  });

  it('runs every one of them without falling over', { timeout: 60_000 }, () => {
    // One pass over the tape scoring every rule, which is both how the sheet
    // runs it and eleven times less work than a pass each.
    const all = backtestAll(RULES.map((r) => ({ name: r.name, rule: r.rule })), 200);
    expect(all).toHaveLength(RULES.length);
    for (const res of all) {
      expect(Number.isFinite(res.ev)).toBe(true);
      expect(Number.isFinite(res.winRate)).toBe(true);
      expect(res.bets).toBeLessThanOrEqual(200);
    }
  });

  it('gives a rule the same answer whether run alone or alongside the others', () => {
    // Sharing one tape between rules must not change what any of them scores,
    // or the pairing would be buying speed with correctness.
    const together = backtestAll(RULES.map((r) => ({ name: r.name, rule: r.rule })), 150, 77);
    const alone = backtest(RULES[1].rule, RULES[1].name, 150, 77);
    expect(together[1].ev).toBe(alone.ev);
    expect(together[1].bets).toBe(alone.bets);
  });

  it('is reproducible from the same seed and different from another', { timeout: 60_000 }, () => {
    const rule = RULES.find((r) => r.key === 'favourite')!.rule;
    expect(backtest(rule, 'a', 300, 1).ev).toBe(backtest(rule, 'a', 300, 1).ev);
    expect(backtest(rule, 'a', 300, 1).ev).not.toBe(backtest(rule, 'a', 300, 2).ev);
  });
});

describe('what a big sample does to a small edge', () => {
  /**
   * The whole point of the tool, pinned as a test. Backing the favourite is
   * the clearest case: a three-quarters win rate that loses money, and an
   * interval that only says so once the sample is big enough.
   */
  // Slow on purpose: the engine runs at the app's 60ms tick, so 6,000 rounds
  // is 90 million steps. Coarsening it to go faster is exactly the mistake
  // this file exists to catch.
  it('shows a 75% win rate losing money once the interval tightens', { timeout: 120_000 }, () => {
    const rule = RULES.find((r) => r.key === 'favourite')!.rule;
    const big = backtest(rule, 'favourite', 6_000, 4_242);
    expect(big.winRate).toBeGreaterThan(0.65);
    expect(big.ev).toBeLessThan(0);
    // With this many bets the interval excludes break-even, so it is a fact
    // rather than a run of luck.
    expect(big.evHigh).toBeLessThan(0);
  });

  it('gives a long-shot rule an interval too wide to conclude anything from', () => {
    const rule = RULES.find((r) => r.key === 'tail')!.rule;
    const small = backtest(rule, 'tail', 400);
    // A handful of 40x bets cannot tell you anything, and the number says so.
    expect(small.ci).toBeGreaterThan(0.3);
  });
});

describe('the interval, where it used to break', () => {
  it('does not collapse to nothing when every bet lost', () => {
    // The bug this replaced: with no winners the spread of the returns is
    // exactly zero, so a rule that had 44 shots at 53x and missed them all was
    // reported as "genuinely behind" with an interval of +/-0.0 — the one
    // situation where the sample says least.
    const all = Array.from({ length: 44 }, () => ({ won: false, multiplier: 53 }));
    const r = summarise('unlucky', all, 22);
    expect(r.ev).toBeCloseTo(-1, 9);
    expect(r.ci).toBeGreaterThan(0.5);
    expect(r.evHigh).toBeGreaterThan(0);
  });

  it('does not collapse when every bet won either', () => {
    const all = Array.from({ length: 30 }, () => ({ won: true, multiplier: 2 }));
    const r = summarise('lucky', all, 15);
    expect(r.ci).toBeGreaterThan(0);
    expect(r.evLow).toBeLessThan(r.ev);
  });

  it('still resolves a rule that has had enough chances', () => {
    // 9 wins in 8,781 bets at 90x is decisively behind, and has to still read
    // that way after the fix.
    const many = Array.from({ length: 8_781 }, (_, i) => ({
      won: i < 9,
      multiplier: 90.1,
    }));
    const r = summarise('sub-penny', many, 4_390);
    expect(r.evHigh).toBeLessThan(0);
  });

  it('brackets the point estimate', () => {
    const mixed = Array.from({ length: 500 }, (_, i) => ({
      won: i % 7 === 0,
      multiplier: 6,
    }));
    const r = summarise('mixed', mixed, 250);
    expect(r.evLow).toBeLessThan(r.ev);
    expect(r.evHigh).toBeGreaterThan(r.ev);
  });

  it('wilson stays inside a probability at both ends', () => {
    for (const [k, n] of [[0, 10], [10, 10], [0, 1], [1, 1], [3, 7]] as const) {
      const [lo, hi] = wilson(k, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(hi).toBeGreaterThan(lo);
    }
  });
});

describe('the interval on a rule whose payouts vary', () => {
  it('does not call a losing coin flip a winner', () => {
    // The trap in reasoning from an average payout: a rule that spans the
    // board wins its cheap bets and loses its dear ones, so win rate times
    // mean payout says it is printing money. Here half the bets pay 1.01x and
    // win, half pay 90x and lose. The mean payout is 45.5x and the mean return
    // is -49.5%, and no interval may put those on the same side of zero.
    const mixed = Array.from({ length: 800 }, (_, i) =>
      i % 2 === 0 ? { won: true, multiplier: 1.01 } : { won: false, multiplier: 90 },
    );
    const r = summarise('spread', mixed, 400);
    expect(r.ev).toBeLessThan(0);
    expect(r.evLow).toBeLessThan(r.ev + 1e-9);
    expect(r.evLow).toBeLessThan(0);
  });

  it('is tight where the payouts are all alike and the wins are many', () => {
    const even = Array.from({ length: 4_000 }, (_, i) => ({
      won: i % 2 === 0,
      multiplier: 1.9,
    }));
    const r = summarise('even', even, 2_000);
    expect(r.ci).toBeLessThan(0.06);
    expect(r.evHigh).toBeLessThan(0);
  });
});
