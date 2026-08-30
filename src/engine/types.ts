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

export type PositionStatus = 'open' | 'won' | 'lost';

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
  /** dollars, set on settle */
  pnl?: number;
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

export type Timeframe = 'live' | '5m' | '15m' | '1h';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  live: 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};
