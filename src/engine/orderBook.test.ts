import { describe, expect, it } from 'vitest';
import { OrderBookSim } from './orderBook';

describe('OrderBookSim', () => {
  it('quotes a two-sided market around the fair value', () => {
    const book = new OrderBookSim();
    for (const pUp of [0.12, 0.35, 0.5, 0.71, 0.94]) {
      const snap = book.snapshot(pUp);
      const bestUpBid = snap.upBids[0].cents;
      const bestDownBid = snap.downBids[0].cents;
      // Down at c is Up at (100 - c), so the best Up ask is the mirror of the
      // best Down bid; a real book has the ask above the bid.
      const bestUpAsk = 100 - bestDownBid;
      expect(bestUpAsk).toBeGreaterThan(bestUpBid);
      expect(snap.spreadCents).toBe(bestUpAsk - bestUpBid);
      // The mid should sit near the model's probability.
      const mid = (bestUpBid + bestUpAsk) / 2;
      expect(Math.abs(mid - pUp * 100)).toBeLessThan(3);
    }
  });

  it('keeps both ladders inside the 1-99c contract range', () => {
    const book = new OrderBookSim();
    for (const pUp of [0, 0.01, 0.5, 0.99, 1]) {
      const snap = book.snapshot(pUp);
      for (const level of [...snap.upBids, ...snap.downBids]) {
        expect(level.cents).toBeGreaterThanOrEqual(1);
        expect(level.cents).toBeLessThanOrEqual(99);
        expect(level.size).toBeGreaterThan(0);
        expect(Number.isInteger(level.size)).toBe(true);
      }
    }
  });

  it('walks each side away from the touch', () => {
    const snap = new OrderBookSim().snapshot(0.5, 6);
    for (let i = 1; i < snap.upBids.length; i++) {
      expect(snap.upBids[i].cents).toBeLessThan(snap.upBids[i - 1].cents);
    }
    for (let i = 1; i < snap.downBids.length; i++) {
      expect(snap.downBids[i].cents).toBeLessThan(snap.downBids[i - 1].cents);
    }
  });

  it('thickens with depth, so the touch is the thin part', () => {
    const book = new OrderBookSim();
    // Let the persistent depth map settle before comparing.
    for (let i = 0; i < 40; i++) book.snapshot(0.5, 6);
    const snap = book.snapshot(0.5, 6);
    expect(snap.upBids[5].size).toBeGreaterThan(snap.upBids[0].size);
    expect(snap.downBids[5].size).toBeGreaterThan(snap.downBids[0].size);
  });

  it('moves depth gradually rather than reshuffling every refresh', () => {
    const book = new OrderBookSim();
    for (let i = 0; i < 20; i++) book.snapshot(0.5, 6);
    const a = book.snapshot(0.5, 6);
    const b = book.snapshot(0.5, 6);
    const level = (snap: typeof a, cents: number) =>
      snap.upBids.find((l) => l.cents === cents)?.size ?? 0;
    for (const l of a.upBids) {
      const before = l.size;
      const after = level(b, l.cents);
      // Jitter is +/-15% around a slowly-moving target, not a fresh draw.
      expect(Math.abs(after - before) / before).toBeLessThan(0.8);
    }
  });
});
