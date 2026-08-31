import { SECONDS_PER_YEAR, clamp, normCdf } from '../lib/math';

/** The house's cut, baked into every quoted multiplier. */
export const HOUSE_EDGE = 0.1;

/** New positions stop being accepted this many ms before settlement. */
export const LOCK_MS = 5_000;

/**
 * Probability the price finishes strictly above the strike.
 *
 * This is the digital-option price under GBM: P(S_T > K) = N(d2). Using the
 * real formula rather than a fudge factor is what makes the market feel
 * right — the odds barely move early in a round and then snap hard toward
 * 0/100 in the closing seconds, exactly like the real thing.
 */
export function probUp(
  spot: number,
  strike: number,
  annualVol: number,
  msLeft: number,
): number {
  if (msLeft <= 0) return spot > strike ? 1 : 0;
  const tau = msLeft / 1000 / SECONDS_PER_YEAR;
  const sd = annualVol * Math.sqrt(tau);
  if (!(sd > 1e-12)) return spot > strike ? 1 : 0;
  const d2 = (Math.log(spot / strike) - 0.5 * sd * sd) / sd;
  return clamp(normCdf(d2), 0, 1);
}

/**
 * Payout multiplier for a side quoted at probability `p`.
 * Fair odds are 1/p; the edge is taken out of the winnings, not the stake,
 * which is how these apps quote it (49% -> 1.93x).
 *
 * The only clamp is the same 1%–99% band the displayed percentage uses, so a
 * side shown at 1% really does pay what 1% is worth. A tighter cap would quote
 * a number the percentage beside it contradicts.
 */
export function multiplierFor(p: number, edge = HOUSE_EDGE): number {
  const q = clamp(p, 0.01, 0.99);
  return Math.max(1.01, 1 + ((1 - q) / q) * (1 - edge));
}

/** Percent shown on the button: rounded, complementary, never 0 or 100. */
export function displayPercents(pUp: number): { up: number; down: number } {
  const up = clamp(Math.round(pUp * 100), 1, 99);
  return { up, down: 100 - up };
}

/**
 * What an open ticket is worth right now.
 *
 * A binary ticket pays `stake * multiplier` if its side wins and nothing if it
 * does not, so its fair value at any moment is simply that payout times the
 * live probability of the side winning. This is what makes an open position's
 * P&L move continuously with the price instead of only resolving at the bell.
 *
 * No extra spread is taken on the way out. The house edge is already inside
 * the multiplier, which is why a ticket closed the instant it is opened comes
 * back worth slightly less than its stake.
 */
export function markToMarket(
  stake: number,
  multiplier: number,
  probOfSide: number,
): number {
  return Math.max(0, stake * multiplier * clamp(probOfSide, 0, 1));
}

/** Probability of `side` landing, given the probability Up lands. */
export function probOf(side: 'up' | 'down', pUp: number): number {
  return side === 'up' ? pUp : 1 - pUp;
}

/**
 * A limit buy fills when the market reaches the price or better. Contracts are
 * quoted in cents out of 100, and for a buyer "better" means cheaper.
 */
export function limitFills(marketCents: number, limitCents: number): boolean {
  return marketCents <= limitCents;
}

/** The live price of one side, in cents, as the book would quote it. */
export function sideCents(side: 'up' | 'down', pUp: number): number {
  return clamp(Math.round(probOf(side, pUp) * 100), 1, 99);
}

/** The multiplier a fill at `cents` earns, carrying the same house edge. */
export function multiplierAtCents(cents: number, edge = HOUSE_EDGE): number {
  return multiplierFor(clamp(cents, 1, 99) / 100, edge);
}
