import { Rng } from '../lib/rng';
import { clamp } from '../lib/math';

export interface BookLevel {
  /** price in cents per contract, 1–99 */
  cents: number;
  /** number of contracts resting */
  size: number;
}

export interface OrderBookSnapshot {
  /** Resting buy orders for Up, best first. */
  upBids: BookLevel[];
  /** Resting buy orders for Down, best first. Down at c is Up at (100 - c). */
  downBids: BookLevel[];
  lastTradeCents: number | null;
  spreadCents: number;
}

/**
 * A binary market's book is one-sided by construction: buying Down at 40c is
 * the same order as selling Up at 60c. We keep sizes in a persistent map so
 * depth drifts between refreshes instead of flickering into a new random
 * shape every second.
 */
export class OrderBookSim {
  private rng = new Rng(0x9e3779b9);
  private depth = new Map<number, number>();
  private lastTradeCents: number | null = null;

  private sizeAt(cents: number, distance: number): number {
    const key = cents;
    const prev = this.depth.get(key);
    // Depth thickens away from the mid, the way real books do.
    const target = 40 + distance * distance * 120 + this.rng.next() * 260;
    const next = prev === undefined ? target : prev * 0.82 + target * 0.18;
    const jittered = Math.max(1, Math.round(next * this.rng.range(0.85, 1.15)));
    this.depth.set(key, next);
    return jittered;
  }

  snapshot(pUp: number, levels = 6): OrderBookSnapshot {
    const mid = clamp(pUp * 100, 1.5, 98.5);
    const halfSpread = clamp(0.5 + (1 - Math.abs(mid - 50) / 50) * 0.9, 0.5, 1.6);

    const bestUpBid = clamp(Math.floor(mid - halfSpread), 1, 98);
    const bestUpAsk = clamp(Math.ceil(mid + halfSpread), bestUpBid + 1, 99);

    const upBids: BookLevel[] = [];
    for (let i = 0; i < levels; i++) {
      const cents = bestUpBid - i;
      if (cents < 1) break;
      upBids.push({ cents, size: this.sizeAt(cents, i) });
    }

    // A resting Up ask at X is a resting Down bid at 100 - X.
    const downBids: BookLevel[] = [];
    for (let i = 0; i < levels; i++) {
      const upCents = bestUpAsk + i;
      if (upCents > 99) break;
      downBids.push({ cents: 100 - upCents, size: this.sizeAt(upCents + 1000, i) });
    }

    if (this.rng.chance(0.55)) {
      this.lastTradeCents = this.rng.chance(0.5) ? bestUpBid : bestUpAsk;
    }

    return {
      upBids,
      downBids,
      lastTradeCents: this.lastTradeCents,
      spreadCents: bestUpAsk - bestUpBid,
    };
  }
}
