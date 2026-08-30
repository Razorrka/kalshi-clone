import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketStore } from './marketStore';

const MINUTE = 60_000;
/** A whole minute boundary, so a 1-minute round opens exactly here. */
const T0 = Date.parse('2026-03-04T15:00:00Z');

let store: MarketStore;

/** Runs the store's loop up to `ms` at its real 60ms cadence. */
function run(ms: number) {
  vi.advanceTimersByTime(ms);
}

/** Jumps the wall clock, so the next tick sees one huge gap — a slept tab. */
function sleepTab(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  vi.advanceTimersByTime(100);
}

function newStore(atMs = T0 + 1_000) {
  vi.setSystemTime(atMs);
  const s = new MarketStore();
  s.setRoundMs(MINUTE);
  s.start();
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  store?.stop();
  vi.useRealTimers();
});

describe('placing picks', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('debits the stake and records the quote at the moment of the pick', () => {
    const before = store.balanceCents;
    expect(store.placeBet('up', 25).ok).toBe(true);

    expect(store.balanceCents).toBe(before - 2_500);
    expect(store.openPositions).toHaveLength(1);
    const pos = store.openPositions[0];
    expect(pos.side).toBe('up');
    expect(pos.stake).toBe(25);
    expect(pos.multiplier).toBe(store.quote.upMultiplier);
    expect(pos.entryPrice).toBe(store.price);
    expect(pos.roundId).toBe(store.round.id);
  });

  it('refuses a stake larger than the balance', () => {
    const result = store.placeBet('up', store.balance + 0.01);
    expect(result).toEqual({ ok: false, error: 'Not enough balance' });
    expect(store.balanceCents).toBe(100_000);
  });

  it('refuses a zero or negative stake', () => {
    expect(store.placeBet('up', 0).ok).toBe(false);
    expect(store.placeBet('up', -5).ok).toBe(false);
    expect(store.balanceCents).toBe(100_000);
  });

  it('reports exposure and the return if a side lands', () => {
    store.placeBet('up', 10);
    store.placeBet('up', 15);
    store.placeBet('down', 5);
    expect(store.stakeOn('up')).toBe(25);
    expect(store.stakeOn('down')).toBe(5);

    const expected = store.openPositions
      .filter((p) => p.side === 'up')
      .reduce((sum, p) => sum + p.stake * p.multiplier, 0);
    expect(store.returnIf('up')).toBeCloseTo(expected, 10);
  });
});

describe('the lock before settlement', () => {
  it('stops accepting picks in the closing seconds', () => {
    // Two seconds before the minute rolls over.
    store = newStore(T0 + MINUTE - 2_000);
    expect(store.isLocked).toBe(true);
    expect(store.canTrade).toBe(false);
    expect(store.placeBet('up', 5)).toEqual({
      ok: false,
      error: 'Market locked for settlement',
    });
    expect(store.balanceCents).toBe(100_000);
  });

  it('is open earlier in the round', () => {
    store = newStore(T0 + 10_000);
    expect(store.isLocked).toBe(false);
    expect(store.placeBet('up', 5).ok).toBe(true);
  });
});

describe('settlement', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('pays the winning side exactly its locked multiplier and nothing else', () => {
    const before = store.balanceCents;
    store.placeBet('up', 25);
    store.placeBet('down', 25);
    expect(store.balanceCents).toBe(before - 5_000);

    run(MINUTE);

    expect(store.history).toHaveLength(1);
    const record = store.history[0];

    const won = store.positions.filter((p) => p.status === 'won');
    const lost = store.positions.filter((p) => p.status === 'lost');
    // Opposite picks on one round: exactly one of them has to land.
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(won[0].side).toBe(record.result);
    expect(lost[0].side).not.toBe(record.result);

    const credit = Math.round(won[0].stake * won[0].multiplier * 100);
    expect(store.balanceCents).toBe(before - 5_000 + credit);
    expect(record.staked).toBe(50);
    expect(record.pnl).toBeCloseTo(credit / 100 - 50, 10);
  });

  it('resolves the round against the target, with ties going Down', () => {
    store.placeBet('up', 10);
    run(MINUTE);
    const r = store.history[0];
    expect(r.result).toBe(r.closePrice > r.strike ? 'up' : 'down');
  });

  it('leaves the balance untouched on a round with no picks', () => {
    const before = store.balanceCents;
    run(MINUTE);
    expect(store.history).toHaveLength(1);
    expect(store.history[0].staked).toBe(0);
    expect(store.balanceCents).toBe(before);
  });

  it('opens the next round with a fresh target and no open picks', () => {
    const first = store.round.id;
    store.placeBet('up', 10);
    run(MINUTE);
    expect(store.round.id).not.toBe(first);
    expect(store.round.settled).toBe(false);
    expect(store.openPositions).toHaveLength(0);
    expect(store.round.endsAt - store.round.startsAt).toBe(MINUTE);
  });

  it('accumulates results across several rounds', () => {
    run(3 * MINUTE);
    expect(store.history).toHaveLength(3);
    const indexes = store.history.map((h) => h.index);
    // Newest first, consecutive.
    expect(indexes[0]).toBe(indexes[1] + 1);
    expect(indexes[1]).toBe(indexes[2] + 1);
  });
});

describe('combos', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('compounds the leg multipliers and debits once', () => {
    const before = store.balanceCents;
    const first = store.round.index;
    store.toggleComboLeg(first, 'up');
    store.toggleComboLeg(first + 1, 'down');

    expect(store.placeCombo(10).ok).toBe(true);
    expect(store.balanceCents).toBe(before - 1_000);
    expect(store.openCombos).toHaveLength(1);

    const combo = store.openCombos[0];
    expect(combo.legs).toHaveLength(2);
    expect(combo.multiplier).toBeCloseTo(
      combo.legs[0].multiplier * combo.legs[1].multiplier,
      10,
    );
  });

  it('needs at least two legs', () => {
    store.toggleComboLeg(store.round.index, 'up');
    expect(store.placeCombo(10)).toEqual({
      ok: false,
      error: 'Pick at least two rounds',
    });
  });

  it('lets a leg be deselected by tapping the same side again', () => {
    const i = store.round.index;
    store.toggleComboLeg(i, 'up');
    expect(store.comboDraft.get(i)).toBe('up');
    store.toggleComboLeg(i, 'down');
    expect(store.comboDraft.get(i)).toBe('down');
    store.toggleComboLeg(i, 'down');
    expect(store.comboDraft.has(i)).toBe(false);
  });

  it('pays only when every leg lands, and dies on the first miss', () => {
    const before = store.balanceCents;
    const first = store.round.index;
    store.toggleComboLeg(first, 'up');
    store.toggleComboLeg(first + 1, 'down');
    const stake = 10;
    store.placeCombo(stake);
    const multiplier = store.combos[0].multiplier;

    run(2 * MINUTE + 1_000);

    const combo = store.combos[0];
    const results = [...store.history].reverse().map((h) => h.result);
    const legsLanded =
      results[0] === 'up' && results[1] === 'down';

    expect(combo.status).toBe(legsLanded ? 'won' : 'lost');
    const credit = legsLanded ? Math.round(stake * multiplier * 100) : 0;
    expect(store.balanceCents).toBe(before - stake * 100 + credit);
  });
});

describe('tickets that can no longer be resolved honestly', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('refunds open picks when the price source changes', () => {
    const before = store.balanceCents;
    store.placeBet('up', 40);
    expect(store.balanceCents).toBe(before - 4_000);

    store.setMode('live');

    expect(store.balanceCents).toBe(before);
    expect(store.openPositions).toHaveLength(0);
    expect(store.toast?.title).toBe('Open picks refunded');
  });

  it('refunds open picks when the round length changes', () => {
    const before = store.balanceCents;
    store.placeBet('down', 30);
    store.toggleComboLeg(store.round.index, 'up');
    store.toggleComboLeg(store.round.index + 1, 'up');
    store.placeCombo(20);
    expect(store.balanceCents).toBe(before - 5_000);

    store.setRoundMs(5 * MINUTE);

    expect(store.balanceCents).toBe(before);
    expect(store.openPositions).toHaveLength(0);
    expect(store.openCombos).toHaveLength(0);
  });

  it('refunds a combo only for legs that never got a chance to resolve', () => {
    const before = store.balanceCents;
    const first = store.round.index;
    store.toggleComboLeg(first, 'up');
    store.toggleComboLeg(first + 1, 'down');
    store.placeCombo(15);

    // Five minutes pass in a single tick. The round the combo opened on still
    // settles; the one after it never happens.
    sleepTab(5 * MINUTE);

    expect(store.openCombos).toHaveLength(0);
    const firstResult = store.history.find((h) => h.index === first)?.result;
    expect(firstResult).toBeDefined();

    if (firstResult === 'up') {
      // Leg one landed, so the combo died only because leg two's round was
      // skipped. That is not a loss the player earned — refund it.
      expect(store.combos).toHaveLength(0);
      expect(store.balanceCents).toBe(before);
    } else {
      // Leg one lost on a round that genuinely settled. No refund is owed.
      expect(store.combos[0].status).toBe('lost');
      expect(store.balanceCents).toBe(before - 1_500);
    }
  });

  it('catches the simulation up across a slept tab instead of freezing', () => {
    const priceBefore = store.price;
    const seriesEnd = store.series[store.series.length - 1].t;

    sleepTab(4 * MINUTE);

    expect(store.price).not.toBe(priceBefore);
    const newEnd = store.series[store.series.length - 1].t;
    expect(newEnd).toBeGreaterThan(seriesEnd + 3 * MINUTE);
    // The tape is filled in, not left with a hole.
    const gaps = store.series
      .slice(1)
      .map((p, i) => p.t - store.series[i].t)
      .filter((g) => g > 5_000);
    expect(gaps).toHaveLength(0);
  });
});

describe('the account', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('resets to the starting balance and clears everything', () => {
    store.placeBet('up', 100);
    run(MINUTE);
    expect(store.history.length).toBeGreaterThan(0);

    store.resetAccount();

    expect(store.balanceCents).toBe(100_000);
    expect(store.positions).toHaveLength(0);
    expect(store.combos).toHaveLength(0);
    expect(store.history).toHaveLength(0);
  });

  it('keeps the balance in whole cents through a settlement', () => {
    store.placeBet('up', 33.33);
    store.placeBet('down', 16.67);
    run(MINUTE);
    expect(Number.isInteger(store.balanceCents)).toBe(true);
  });
});

describe('quoting', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('keeps the displayed percentages complementary and the payouts in step', () => {
    for (let i = 0; i < 20; i++) {
      run(2_000);
      const q = store.quote;
      expect(q.upPct + q.downPct).toBe(100);
      expect(q.upMultiplier).toBeGreaterThanOrEqual(1.01);
      expect(q.downMultiplier).toBeGreaterThanOrEqual(1.01);
      // Whichever side is less likely has to pay more.
      if (q.pUp > 0.5) expect(q.downMultiplier).toBeGreaterThan(q.upMultiplier);
      if (q.pUp < 0.5) expect(q.upMultiplier).toBeGreaterThan(q.downMultiplier);
    }
  });
});
