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

describe('setting the target by hand', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('pins the target and reprices the market against it', () => {
    const spot = store.price;
    expect(store.strikeMode).toBe('auto');

    expect(store.setManualStrike(spot + 500).ok).toBe(true);

    expect(store.strikeMode).toBe('manual');
    expect(store.round.strike).toBe(Math.round((spot + 500) * 100) / 100);
    // A target far above the price makes Up the unlikely side.
    expect(store.quote.pUp).toBeLessThan(0.5);
    expect(store.quote.downMultiplier).toBeLessThan(store.quote.upMultiplier);
  });

  it('holds the pinned target across a round rollover', () => {
    const pinned = 12_345.67;
    store.setManualStrike(pinned);
    const firstRound = store.round.id;

    run(MINUTE);

    expect(store.round.id).not.toBe(firstRound);
    expect(store.round.strike).toBe(pinned);
    expect(store.strikeMode).toBe('manual');
  });

  it('rejects a target of zero or below', () => {
    expect(store.setManualStrike(0)).toEqual({
      ok: false,
      error: 'Enter a price above zero',
    });
    expect(store.setManualStrike(-5).ok).toBe(false);
    expect(store.setManualStrike(Number.NaN).ok).toBe(false);
    expect(store.strikeMode).toBe('auto');
  });

  it('refunds open tickets, which were bought against the old target', () => {
    const before = store.balanceCents;
    store.placeBet('up', 40);
    expect(store.balanceCents).toBe(before - 4_000);

    store.setManualStrike(store.price + 100);

    expect(store.balanceCents).toBe(before);
    expect(store.openPositions).toHaveLength(0);
  });

  it('hands the target back to the round open when cleared', () => {
    store.setManualStrike(999);
    expect(store.round.strike).toBe(999);

    store.clearManualStrike();

    expect(store.strikeMode).toBe('auto');
    expect(store.round.strike).not.toBe(999);
    expect(store.round.strike).toBeGreaterThan(0);
  });

  it('goes back to tracking the round open after being cleared', () => {
    store.setManualStrike(999);
    store.clearManualStrike();
    const before = store.round.strike;

    run(MINUTE);

    // A fresh automatic target, not the pinned one.
    expect(store.round.strike).not.toBe(999);
    expect(store.round.strike).not.toBe(before);
  });

  it('survives a round length change', () => {
    store.setManualStrike(4_242);
    store.setRoundMs(5 * MINUTE);
    expect(store.round.strike).toBe(4_242);
  });

  it('is dropped by an account reset', () => {
    store.setManualStrike(4_242);
    store.resetAccount();
    expect(store.strikeMode).toBe('auto');
    expect(store.manualStrike).toBe(0);
  });
});

describe('choosing your own practice balance', () => {
  beforeEach(() => {
    store = newStore();
  });

  it('sets the balance outright', () => {
    expect(store.setBalance(250).ok).toBe(true);
    expect(store.balanceCents).toBe(25_000);
    expect(store.balance).toBe(250);
  });

  it('makes a reset return to the stake you chose, not the default', () => {
    store.setBalance(200);
    store.placeBet('up', 50);
    expect(store.balanceCents).toBe(15_000);

    store.resetAccount();

    expect(store.balanceCents).toBe(20_000);
    expect(store.startingBalanceCents).toBe(20_000);
  });

  it('tops up without moving what a reset returns to', () => {
    store.setBalance(100);
    expect(store.addFunds(25).ok).toBe(true);
    expect(store.balanceCents).toBe(12_500);
    // The reset target stays where it was set.
    expect(store.startingBalanceCents).toBe(10_000);
    store.resetAccount();
    expect(store.balanceCents).toBe(10_000);
  });

  it('allows zero, so you can practise being broke', () => {
    expect(store.setBalance(0).ok).toBe(true);
    expect(store.balanceCents).toBe(0);
    expect(store.placeBet('up', 1).ok).toBe(false);
  });

  it('rejects a negative balance and a non-positive top-up', () => {
    expect(store.setBalance(-5).ok).toBe(false);
    expect(store.setBalance(Number.NaN).ok).toBe(false);
    expect(store.addFunds(0).ok).toBe(false);
    expect(store.addFunds(-10).ok).toBe(false);
    expect(store.balanceCents).toBe(100_000);
  });

  it('keeps the balance in whole cents', () => {
    store.setBalance(33.335);
    expect(Number.isInteger(store.balanceCents)).toBe(true);
    store.addFunds(0.005);
    expect(Number.isInteger(store.balanceCents)).toBe(true);
  });

  it('leaves open picks alone, since the balance does not price them', () => {
    store.placeBet('up', 40);
    const pos = store.openPositions[0];

    store.setBalance(5_000);

    expect(store.openPositions).toHaveLength(1);
    expect(store.openPositions[0].multiplier).toBe(pos.multiplier);
    expect(store.openPositions[0].stake).toBe(40);
  });

  it('still settles a winning pick after the balance was changed', () => {
    store.placeBet('up', 25);
    store.placeBet('down', 25);
    store.setBalance(500);

    run(MINUTE);

    const won = store.positions.find((p) => p.status === 'won')!;
    const credit = Math.round(won.stake * won.multiplier * 100);
    expect(store.balanceCents).toBe(50_000 + credit);
  });

  it('caps absurd amounts rather than overflowing the display', () => {
    store.setBalance(1e12);
    expect(store.balanceCents).toBe(100_000_000_00);
    store.addFunds(1e12);
    expect(store.balanceCents).toBe(100_000_000_00);
  });
});

describe('the locked call', () => {
  /** 16.2s into a one-minute round — the same 27% mark as 4m into 15m. */
  const LOCK_AT = 16_200;

  beforeEach(() => {
    store = newStore();
  });

  it('says nothing until it reaches the mark, then commits', () => {
    run(LOCK_AT - 2_000);
    expect(store.currentCall).toBeNull();
    expect(store.msToCall).toBeGreaterThan(0);

    run(3_000);
    const call = store.currentCall;
    expect(call).not.toBeNull();
    expect(call!.side === 'up' || call!.side === 'down').toBe(true);
    expect(call!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(call!.confidence).toBeLessThanOrEqual(1);
    expect(call!.roundId).toBe(store.round.id);
    expect(store.msToCall).toBe(0);
  });

  it('never changes its answer for the rest of the round', () => {
    run(LOCK_AT + 500);
    const call = store.currentCall!;
    const startPrice = store.price;

    // Every remaining tick of the round, with the price moving underneath it.
    for (let i = 0; i < 40; i++) {
      run(1_000);
      if (store.round.id !== call.roundId) break;
      // Same object, not merely equal: nothing rewrites the call in place.
      expect(store.currentCall).toBe(call);
    }
    expect(store.price).not.toBe(startPrice);
    expect(store.currentCall === null || store.currentCall.side === call.side).toBe(true);
  });

  it('makes exactly one call per round', () => {
    run(3 * MINUTE);
    const rounds = new Set(store.calls.map((c) => c.roundId));
    expect(store.calls.length).toBeGreaterThanOrEqual(2);
    expect(rounds.size).toBe(store.calls.length);
  });

  it('records how the round actually went once it settles', () => {
    run(LOCK_AT + 500);
    const call = store.currentCall!;
    expect(call.outcome).toBeUndefined();

    run(MINUTE);
    const settled = store.calls.find((c) => c.id === call.id)!;
    expect(settled.outcome === 'up' || settled.outcome === 'down').toBe(true);
    expect(settled.closePrice).toBeGreaterThan(0);
    expect(settled.grade).toBeUndefined();
    expect(store.pendingGrade?.id).toBe(call.id);
  });
});

describe('grading a call', () => {
  const LOCK_AT = 16_200;

  beforeEach(() => {
    store = newStore();
  });

  /** Runs to the first call and on past the bell, so it can be graded. */
  function firstFinishedCall() {
    run(LOCK_AT + 500);
    const id = store.currentCall!.id;
    run(MINUTE);
    return store.calls.find((c) => c.id === id)!;
  }

  it('will not grade a call that is still running', () => {
    run(LOCK_AT + 500);
    const result = store.gradeCall(store.currentCall!.id, 'right');
    expect(result.ok).toBe(false);
    expect(store.callModel.trained).toBe(0);
  });

  it('learns from a call you mark wrong', () => {
    const call = firstFinishedCall();
    const before = [...store.callModel.weights];

    expect(store.gradeCall(call.id, 'wrong').ok).toBe(true);
    expect(store.callModel.trained).toBe(1);
    expect(store.callModel.weights).not.toEqual(before);

    // It learned toward the side it did not pick.
    const wouldBe = store.callModel.weights[1] * call.features.z + store.callModel.weights[0];
    const wasBefore = before[1] * call.features.z + before[0];
    if (call.side === 'up') expect(wouldBe).toBeLessThan(wasBefore);
    else expect(wouldBe).toBeGreaterThan(wasBefore);
  });

  it('barely moves when you mark it right', () => {
    const call = firstFinishedCall();
    const before = [...store.callModel.weights];
    expect(store.gradeCall(call.id, 'right').ok).toBe(true);

    // A confirmed call still nudges the weights, just far less than a miss.
    const moved = store.callModel.weights.map((w, i) => Math.abs(w - before[i]));
    expect(Math.max(...moved)).toBeGreaterThan(0);
    expect(Math.max(...moved)).toBeLessThan(0.06);
  });

  it('refuses to grade the same call twice', () => {
    const call = firstFinishedCall();
    expect(store.gradeCall(call.id, 'right').ok).toBe(true);
    expect(store.gradeCall(call.id, 'wrong').ok).toBe(false);
    expect(store.callModel.trained).toBe(1);
  });

  it('keeps a record you can read a hit rate off', () => {
    const call = firstFinishedCall();
    store.gradeCall(call.id, 'right');
    const record = store.callRecord;
    expect(record.graded).toBe(1);
    expect(record.right).toBe(1);
    expect(record.hitRate).toBe(1);
    expect(record.streak).toBe(1);
  });

  it('forgets everything on a reset', () => {
    const call = firstFinishedCall();
    store.gradeCall(call.id, 'wrong');
    store.resetCaller();
    expect(store.calls).toHaveLength(0);
    expect(store.callModel.trained).toBe(0);
    expect(store.callRecord.hitRate).toBeNull();
  });

  it('drops a call whose round went by while the tab was asleep', () => {
    run(LOCK_AT + 500);
    expect(store.currentCall).not.toBeNull();

    sleepTab(30 * MINUTE);
    // Nothing ungraded is left over claiming a result nobody watched.
    for (const c of store.calls) {
      expect(c.outcome === undefined && c.roundId !== store.round.id).toBe(false);
    }
    expect(store.callRecord.graded).toBe(0);
  });
});

describe('opening the app too late in a round', () => {
  it('says nothing rather than calling a round that is nearly over', () => {
    // 52s into a one-minute round: past the 16.2s mark, but past the 43.8s
    // deadline too, so there is nothing left worth committing to.
    store = newStore(T0 + 52_000);
    run(2_000);
    expect(store.currentCall).toBeNull();
    expect(store.callWindowClosed).toBe(true);

    // The next round gets its call as normal.
    run(MINUTE);
    expect(store.currentCall).not.toBeNull();
    expect(store.callWindowClosed).toBe(false);
  });
});

describe('a call you did not get around to grading', () => {
  const LOCK_AT = 16_200;

  beforeEach(() => {
    store = newStore();
  });

  it('stops asking once the next call has locked, so it cannot hide the live one', () => {
    run(LOCK_AT + 500);
    const first = store.currentCall!.id;

    // Past the bell: the finished call is what the strip should be asking about.
    run(MINUTE - LOCK_AT + 1_000);
    expect(store.pendingGrade?.id).toBe(first);

    // Two rounds on, it has had its moment and steps aside.
    run(2 * MINUTE);
    expect(store.pendingGrade?.id).not.toBe(first);
  });

  it('stays on file so it can still be graded from the sheet', () => {
    run(LOCK_AT + 500);
    const first = store.currentCall!.id;
    run(3 * MINUTE);

    expect(store.gradableCalls.map((c) => c.id)).toContain(first);
    expect(store.gradeCall(first, 'right').ok).toBe(true);
    expect(store.callRecord.graded).toBe(1);
  });

  it('is left out of the record entirely until it is graded', () => {
    run(4 * MINUTE);
    expect(store.gradableCalls.length).toBeGreaterThan(1);
    expect(store.callRecord.graded).toBe(0);
    expect(store.callRecord.hitRate).toBeNull();
    expect(store.callModel.trained).toBe(0);
  });
});
