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

describe('limit orders', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('reserves the stake while the order rests', () => {
    const before = store.balanceCents;
    // Ask for a price far better than the market so it cannot fill yet.
    const far = Math.max(1, store.centsFor('up') - 25);
    expect(store.placeLimitOrder('up', far, 20).ok).toBe(true);

    expect(store.balanceCents).toBe(before - 2_000);
    expect(store.restingOrders).toHaveLength(1);
    expect(store.openPositions).toHaveLength(0);
  });

  it('hands the stake back when cancelled', () => {
    const before = store.balanceCents;
    const far = Math.max(1, store.centsFor('up') - 25);
    store.placeLimitOrder('up', far, 20);
    const id = store.restingOrders[0].id;

    expect(store.cancelLimitOrder(id)).toBe(true);
    expect(store.balanceCents).toBe(before);
    expect(store.restingOrders).toHaveLength(0);
  });

  it('rejects a price outside the 1c-99c contract range', () => {
    expect(store.placeLimitOrder('up', 0, 10).ok).toBe(false);
    expect(store.placeLimitOrder('up', 100, 10).ok).toBe(false);
    expect(store.balanceCents).toBe(100_000);
  });

  it('rejects more than the balance', () => {
    const result = store.placeLimitOrder('up', 50, store.balance + 1);
    expect(result).toEqual({ ok: false, error: 'Not enough balance' });
  });

  it('fills immediately when the market is already at the price', () => {
    const before = store.balanceCents;
    // A limit of 99c accepts any price, so it fills on the next tick.
    store.placeLimitOrder('up', 99, 20);
    expect(store.openPositions).toHaveLength(0);

    run(200);

    expect(store.restingOrders).toHaveLength(0);
    expect(store.openPositions).toHaveLength(1);
    const pos = store.openPositions[0];
    expect(pos.side).toBe('up');
    expect(pos.stake).toBe(20);
    // Filled at the market, which is at or better than the limit.
    expect(pos.entryProb * 100).toBeLessThanOrEqual(99);
    // The stake was taken once, at order time, not again at fill.
    expect(store.balanceCents).toBe(before - 2_000);
  });

  it('never fills a buy above its price', () => {
    store.placeLimitOrder('up', 1, 20);
    run(20_000);
    for (const o of store.limitOrders) {
      if (o.status === 'filled') expect(o.filledCents).toBeLessThanOrEqual(1);
    }
  });

  it('pays a bigger multiplier for a cheaper fill', () => {
    store.placeLimitOrder('up', 99, 10);
    run(200);
    const pos = store.openPositions[0];
    const cents = store.limitOrders.find((o) => o.status === 'filled')!.filledCents!;
    // Cheaper contracts pay more; check the position agrees with its fill.
    expect(pos.multiplier).toBeCloseTo(1 + ((100 - cents) / cents) * 0.9, 6);
  });

  it('expires unfilled orders at the bell and returns the stake', () => {
    const before = store.balanceCents;
    store.placeLimitOrder('up', 1, 25);
    store.placeLimitOrder('down', 1, 25);
    expect(store.balanceCents).toBe(before - 5_000);

    run(MINUTE);

    const stillResting = store.limitOrders.filter((o) => o.status === 'resting');
    expect(stillResting).toHaveLength(0);
    // Whatever did not fill came back; anything that filled settled normally.
    expect(store.balanceCents).toBeGreaterThanOrEqual(before - 5_000);
  });

  it('will not rest an order once the market is locked', () => {
    store.stop();
    store = newStore(T0 + MINUTE - 2_000);
    expect(store.placeLimitOrder('up', 50, 10)).toEqual({
      ok: false,
      error: 'Market locked for settlement',
    });
  });
});

describe('closing a position early', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('values an open ticket at payout times its live chance', () => {
    store.placeBet('up', 40);
    const pos = store.openPositions[0];
    const mark = store.markOf(pos);
    expect(mark.value).toBeCloseTo(
      pos.stake * pos.multiplier * store.quote.pUp,
      6,
    );
    expect(mark.pnl).toBeCloseTo(mark.value - pos.stake, 10);
  });

  it('is worth a little under the stake the instant it opens', () => {
    store.placeBet('up', 100);
    const mark = store.markOf(store.openPositions[0]);
    // The entry spread, nothing more.
    expect(mark.value).toBeLessThan(100);
    expect(mark.value).toBeGreaterThan(88);
  });

  it('credits the mark and locks the P&L in', () => {
    const before = store.balanceCents;
    store.placeBet('down', 30);
    const pos = store.openPositions[0];
    const expected = store.markOf(pos).value;

    expect(store.closePosition(pos.id).ok).toBe(true);

    const closed = store.positions.find((p) => p.id === pos.id)!;
    expect(closed.status).toBe('closed');
    expect(closed.closeValue).toBeCloseTo(expected, 2);
    expect(closed.pnl).toBeCloseTo(expected - 30, 2);
    expect(store.balanceCents).toBe(
      before - 3_000 + Math.round(expected * 100),
    );
    expect(store.openPositions).toHaveLength(0);
  });

  it('leaves a closed ticket out of settlement, so it pays only once', () => {
    const before = store.balanceCents;
    store.placeBet('up', 25);
    const pos = store.openPositions[0];
    store.closePosition(pos.id);
    const afterClose = store.balanceCents;

    run(MINUTE);

    expect(store.balanceCents).toBe(afterClose);
    const settled = store.positions.find((p) => p.id === pos.id)!;
    expect(settled.status).toBe('closed');
    // The round's record still remembers what the ticket did.
    expect(store.history[0].staked).toBe(25);
    expect(store.history[0].pnl).toBeCloseTo(afterClose / 100 - before / 100, 6);
  });

  it('cannot be closed twice', () => {
    store.placeBet('up', 10);
    const id = store.openPositions[0].id;
    expect(store.closePosition(id).ok).toBe(true);
    expect(store.closePosition(id)).toEqual({
      ok: false,
      error: 'Position is no longer open',
    });
  });

  it('suspends closing inside the settlement lock', () => {
    store.placeBet('up', 10);
    const id = store.openPositions[0].id;
    run(MINUTE - 3_000);
    expect(store.isLocked).toBe(true);
    expect(store.closePosition(id)).toEqual({
      ok: false,
      error: 'Closing is suspended near settlement',
    });
  });

  it('totals unrealised P&L across open tickets', () => {
    store.placeBet('up', 20);
    store.placeBet('down', 20);
    const sum = store.openPositions.reduce((a, p) => a + store.markOf(p).pnl, 0);
    expect(store.openPnl).toBeCloseTo(sum, 10);
    expect(store.openValue).toBeCloseTo(
      store.openPositions.reduce((a, p) => a + store.markOf(p).value, 0),
      10,
    );
  });
});
