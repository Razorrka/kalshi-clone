import { Rng } from '../lib/rng';
import type { Side } from './types';

export interface TapeEntry {
  id: number;
  amount: number;
  side: Side;
  at: number;
}

/**
 * The stream of other players' winnings that floats up the left of the chart.
 * Amounts are log-normal — lots of small tickets, the occasional big one.
 */
export class TapeSim {
  private rng = new Rng(0x2545f491);
  private nextId = 1;
  private nextAt = 0;

  /** Returns a new entry when one is due, otherwise null. */
  poll(now: number, pUp: number): TapeEntry | null {
    if (this.nextAt === 0) {
      this.nextAt = now + this.rng.range(400, 1400);
      return null;
    }
    if (now < this.nextAt) return null;
    this.nextAt = now + this.rng.range(350, 2200);

    const magnitude = Math.exp(this.rng.normal() * 0.85 + 1.75);
    const amount = Math.max(1, Math.round(magnitude));
    // Winners skew toward whichever side is currently favoured.
    const side: Side = this.rng.chance(pUp) ? 'up' : 'down';
    return { id: this.nextId++, amount, side, at: now };
  }
}
