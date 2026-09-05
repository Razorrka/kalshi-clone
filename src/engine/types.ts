export type Side = 'up' | 'down';

export type FeedMode = 'sim' | 'live';

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface Tick {
  /** epoch ms */
  t: number;
  /** price in USD */
  p: number;
}

export interface Round {
  id: string;
  index: number;
  startsAt: number;
  endsAt: number;
  /** Locked at the moment the round opens. */
  strike: number;
  settled: boolean;
  result?: Side;
  closePrice?: number;
}

export type PositionStatus = 'open' | 'won' | 'lost' | 'closed';

export interface Position {
  id: string;
  roundId: string;
  roundEndsAt: number;
  side: Side;
  /** dollars */
  stake: number;
  /** the multiplier locked in at entry */
  multiplier: number;
  entryPrice: number;
  entryProb: number;
  placedAt: number;
  status: PositionStatus;
  /** dollars, set on settle or on an early close */
  pnl?: number;
  /** set when cashed out before the round ended */
  closedAt?: number;
  /** what the cash-out actually paid, in dollars */
  closeValue?: number;
  /** the resting order this position was filled from, if any */
  fromOrderId?: string;
  /**
   * Set when this was taken while the edge hunter was lit on this side, with
   * the expected value it was claiming at the time. Settlement scores it, so
   * the hunter's record is what its picks really did rather than what it said.
   */
  goldEv?: number;
}

export type OrderStatus = 'resting' | 'filled' | 'cancelled' | 'expired';

/**
 * A resting buy order. Contracts are quoted in cents and settle at $1.00, so
 * buying Up at 45c means "fill me only if Up is going for 45c or less" — a
 * lower price is a better price for a buyer, and a bigger multiplier.
 */
export interface LimitOrder {
  id: string;
  roundId: string;
  roundEndsAt: number;
  side: Side;
  /** the worst price, in cents, the order will accept */
  limitCents: number;
  /** dollars, reserved from the balance while the order rests */
  stake: number;
  placedAt: number;
  status: OrderStatus;
  /** cents actually paid, set on fill */
  filledCents?: number;
  filledAt?: number;
}

/** One OHLC bar, aggregated from the same tape the line chart draws. */
export interface Candle {
  /** epoch ms of the bucket's start */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** true while this bar is still forming */
  live: boolean;
}

export interface ComboLeg {
  roundIndex: number;
  side: Side;
  multiplier: number;
}

export interface ComboTicket {
  id: string;
  legs: ComboLeg[];
  stake: number;
  multiplier: number;
  placedAt: number;
  status: PositionStatus;
  /** how many legs have resolved correctly so far */
  legsWon: number;
  pnl?: number;
}

export interface RoundResult {
  roundId: string;
  index: number;
  endsAt: number;
  strike: number;
  closePrice: number;
  result: Side;
  /** net dollars across every position on this round */
  pnl: number;
  staked: number;
}

/**
 * Where the round's target comes from. 'auto' takes the price at the moment
 * the round opened; 'manual' holds whatever the user typed, so the market can
 * be lined up against a real book's strike.
 */
export type StrikeMode = 'auto' | 'manual';

export type ChartView = 'line' | 'candles' | 'positions';

/** Candle widths offered in the candlestick view. */
export const CANDLE_INTERVALS = [
  { ms: 60_000, label: '1M' },
  { ms: 5 * 60_000, label: '5M' },
  { ms: 15 * 60_000, label: '15M' },
] as const;

export const DEFAULT_CANDLE_MS = 5 * 60_000;

export type Timeframe = 'live' | '5m' | '15m' | '1h';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  live: 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};
