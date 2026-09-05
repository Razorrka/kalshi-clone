import { describe, expect, it } from 'vitest';
import { RULES, backtest, rsi, summarise } from './backtest';

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

  it('runs every one of them without falling over', () => {
    for (const r of RULES) {
      const res = backtest(r.rule, r.name, 200);
      expect(Number.isFinite(res.ev)).toBe(true);
      expect(Number.isFinite(res.winRate)).toBe(true);
      expect(res.bets).toBeLessThanOrEqual(200);
    }
  });

  it('is reproducible from the same seed and different from another', () => {
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
  it('shows a 75% win rate losing money once the interval tightens', () => {
    const rule = RULES.find((r) => r.key === 'favourite')!.rule;
    const big = backtest(rule, 'favourite', 6_000, 4_242);
    expect(big.winRate).toBeGreaterThan(0.65);
    expect(big.ev).toBeLessThan(0);
    // With this many bets the interval excludes break-even, so it is a fact
    // rather than a run of luck.
    expect(big.ev + big.ci).toBeLessThan(0);
  });

  it('gives a long-shot rule an interval too wide to conclude anything from', () => {
    const rule = RULES.find((r) => r.key === 'tail')!.rule;
    const small = backtest(rule, 'tail', 400);
    // A handful of 40x bets cannot tell you anything, and the number says so.
    expect(small.ci).toBeGreaterThan(0.3);
  });
});
