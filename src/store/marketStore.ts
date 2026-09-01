import { PriceEngine, VOL_PRESETS, type VolPreset } from '../engine/priceEngine';
import { LiveFeed } from '../engine/liveFeed';
import { OrderBookSim, type OrderBookSnapshot } from '../engine/orderBook';
import { TapeSim, type TapeEntry } from '../engine/tape';
import {
  LOCK_MS,
  displayPercents,
  limitFills,
  markToMarket,
  multiplierAtCents,
  multiplierFor,
  probOf,
  probUp,
  sideCents,
} from '../engine/odds';
import { SECONDS_PER_YEAR, clamp } from '../lib/math';
import { DEFAULT_ROUND_MS, makeRound, roundBounds, settleRound } from '../engine/rounds';
import type {
  Candle,
  ChartView,
  StrikeMode,
  ComboLeg,
  ComboTicket,
  FeedMode,
  FeedStatus,
  LimitOrder,
  Position,
  Round,
  RoundResult,
  Side,
  Tick,
  Timeframe,
} from '../engine/types';
import { DEFAULT_CANDLE_MS } from '../engine/types';
import { SIGNAL_RULES, computeSignals } from '../engine/signals';
import { aggregateBars } from '../engine/candles';
import {
  INITIAL_MODEL,
  CALL_ON_DEMAND_MS,
  callDeadlineFor,
  callOpensAt,
  callStats,
  canRequestCallAt,
  learn,
  lockDelayFor,
  makeCall,
  outcomeFromGrade,
  rearmDelayFor,
  standardisedGap,
  type CallFeatures,
  type CallGrade,
  type CallModel,
  type CallStats,
  type LockedCall,
} from '../engine/caller';
import { clearState, loadState, saveState } from './persist';

/** ~5 Hz sampling keeps an hour of tape in a few thousand points. */
const SAMPLE_MS = 200;
const SERIES_WINDOW_MS = 185 * 60_000;
const MAX_TAPE = 4;
const MAX_HISTORY = 40;
/** One-minute bars kept for the candle chart: a full day, at 1,440 rows. */
const MINUTE_MS = 60_000;
const MAX_MINUTE_BARS = 1_500;
const STARTING_BALANCE_CENTS = 1_000_00;
/** Locked calls kept on file. Enough to read a hit rate off, not a ledger. */
const MAX_CALLS = 60;
/** How far back "momentum" looks when the call is made. */
const MOMENTUM_WINDOW_MS = 120_000;

export type SheetName =
  | 'book'
  | 'ticket'
  | 'settings'
  | 'combo'
  | 'activity'
  | 'strike'
  | 'signals'
  | 'balance'
  | 'calls';

export interface Toast {
  id: number;
  kind: 'win' | 'loss' | 'info';
  title: string;
  detail: string;
}

export interface Quote {
  pUp: number;
  upPct: number;
  downPct: number;
  upMultiplier: number;
  downMultiplier: number;
}

type Listener = () => void;

export class MarketStore {
  // ---- market state ------------------------------------------------------
  series: Tick[] = [];
  /**
   * Completed one-minute bars, going back far further than the tick tape.
   * Candle widths are all whole minutes, so every one of them is built from
   * these rather than from ticks the app cannot afford to keep.
   */
  minuteBars: Candle[] = [];
  price = 0;
  prevPrice = 0;
  /** Direction of the most recent price change. */
  tickDir: -1 | 0 | 1 = 0;
  /**
   * Direction over the last second and a half. The headline price is tinted
   * from this rather than from `tickDir`: a per-tick flash at 14 fps reads as
   * a flicker, while this shows actual momentum.
   */
  recentDir: -1 | 0 | 1 = 0;
  round: Round;
  quote: Quote = {
    pUp: 0.5,
    upPct: 50,
    downPct: 50,
    upMultiplier: 1.9,
    downMultiplier: 1.9,
  };
  annualVol: number = VOL_PRESETS.normal;
  tape: TapeEntry[] = [];
  book: OrderBookSnapshot | null = null;

  // ---- settings ----------------------------------------------------------
  mode: FeedMode = 'sim';
  roundMs = DEFAULT_ROUND_MS;
  volPreset: VolPreset = 'normal';
  hapticsOn = true;
  signalsOn = true;
  /** UT Bot "key value": how tightly the stop trails. Lower = more signals. */
  signalKey = SIGNAL_RULES.keyValue;
  feedStatus: FeedStatus = 'idle';
  feedDetail = '';

  // ---- account -----------------------------------------------------------
  balanceCents = STARTING_BALANCE_CENTS;
  /** What a reset goes back to. Follows whatever balance you last set. */
  startingBalanceCents = STARTING_BALANCE_CENTS;
  positions: Position[] = [];
  limitOrders: LimitOrder[] = [];
  combos: ComboTicket[] = [];
  history: RoundResult[] = [];

  // ---- the caller --------------------------------------------------------
  /** Every call it has committed to, newest first. */
  calls: LockedCall[] = [];
  /** What it has learned from the ones that were graded. */
  callModel: CallModel = INITIAL_MODEL;
  /**
   * When the target last moved under the caller. Only meaningful inside the
   * round it happened in, so it needs no resetting on rollover.
   */
  targetChangedAt = 0;
  /** When a call was last asked for outright. Same round-scoped lifetime. */
  callRequestedAt = 0;

  // ---- ui ----------------------------------------------------------------
  timeframe: Timeframe = 'live';
  strikeMode: StrikeMode = 'auto';
  /** The pinned target, held across rounds while strikeMode is 'manual'. */
  manualStrike = 0;
  chartView: ChartView = 'line';
  candleMs: number = DEFAULT_CANDLE_MS;
  sheet: SheetName | null = null;
  ticketSide: Side = 'up';
  ticketStake = 25;
  comboDraft: Map<number, Side> = new Map();
  toast: Toast | null = null;

  private engine = new PriceEngine();
  private feed: LiveFeed | null = null;
  private bookSim = new OrderBookSim();
  private tapeSim = new TapeSim();
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastStepAt = 0;
  private lastSampleAt = 0;
  private livePrice = 0;
  private fastListeners = new Set<Listener>();
  private slowListeners = new Set<Listener>();
  private volEstimateAt = 0;
  private lastFastEmit = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 1;
  private idSeq = 1;
  private saveQueued = false;

  constructor() {
    const saved = loadState();
    if (saved) {
      if (saved.mode === 'sim' || saved.mode === 'live') this.mode = saved.mode;
      if (typeof saved.roundMs === 'number' && saved.roundMs >= 60_000) {
        this.roundMs = saved.roundMs;
      }
      if (saved.volPreset && saved.volPreset in VOL_PRESETS) {
        this.volPreset = saved.volPreset;
      }
      if (saved.strikeMode === 'manual' && (saved.manualStrike ?? 0) > 0) {
        this.strikeMode = 'manual';
        this.manualStrike = saved.manualStrike!;
      }
      if (typeof saved.balanceCents === 'number') {
        this.balanceCents = Math.max(0, Math.round(saved.balanceCents));
      }
      if (typeof saved.startingBalanceCents === 'number') {
        this.startingBalanceCents = Math.max(
          0,
          Math.round(saved.startingBalanceCents),
        );
      }
      if (Array.isArray(saved.history)) this.history = saved.history.slice(0, MAX_HISTORY);
      if (typeof saved.hapticsOn === 'boolean') this.hapticsOn = saved.hapticsOn;
      if (typeof saved.signalsOn === 'boolean') this.signalsOn = saved.signalsOn;
      if (typeof saved.signalKey === 'number' && saved.signalKey > 0) {
        this.signalKey = saved.signalKey;
      }
      if (Array.isArray(saved.calls)) this.calls = saved.calls.slice(0, MAX_CALLS);
      // A model restored from storage decides real calls, so anything that is
      // not four finite numbers goes back to the untrained prior.
      const w = saved.callModel?.weights;
      if (Array.isArray(w) && w.length === 4 && w.every((n) => Number.isFinite(n))) {
        this.callModel = {
          weights: [w[0], w[1], w[2], w[3]],
          trained: Math.max(0, Math.round(saved.callModel?.trained ?? 0)),
        };
      }
    }

    this.annualVol = VOL_PRESETS[this.volPreset];
    const startPrice = saved?.simPrice && saved.simPrice > 0 ? saved.simPrice : 78_254.88;
    this.engine = new PriceEngine({
      seed: saved?.simSeed || Math.floor(Math.random() * 0xffffffff),
      startPrice,
      annualVol: this.annualVol,
    });
    this.price = this.prevPrice = this.livePrice = this.engine.price;

    const now = Date.now();
    this.round = makeRound(now, this.roundMs, this.strikeFor(this.price));
    this.refundStale(saved?.positions, saved?.combos, saved?.limitOrders);
    this.recompute(now);
  }

  // =========================================================================
  // subscriptions
  // =========================================================================

  /** `fast` subscribers are throttled to ~14 Hz; the rest fire on real changes. */
  subscribe(listener: Listener, fast = false): () => void {
    const set = fast ? this.fastListeners : this.slowListeners;
    set.add(listener);
    return () => set.delete(listener);
  }

  private emitFast() {
    const now = Date.now();
    if (now - this.lastFastEmit < 70) return;
    this.lastFastEmit = now;
    for (const l of this.fastListeners) l();
  }

  private emitSlow() {
    for (const l of this.slowListeners) l();
    for (const l of this.fastListeners) l();
    this.lastFastEmit = Date.now();
  }

  // =========================================================================
  // lifecycle
  // =========================================================================

  start() {
    if (this.loop) return;
    this.lastStepAt = Date.now();
    this.lastSampleAt = 0;
    if (this.mode === 'live') {
      // Live history comes from the exchange; seeding simulated points here
      // would splice a fake segment onto the front of the real tape.
      this.connectLive();
    } else if (this.series.length === 0) {
      this.seedSyntheticHistory();
    }
    this.voidUnsettled(Date.now());
    this.loop = setInterval(() => this.tick(), 60);
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.disconnectLive();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  /**
   * Pre-fills the chart with a warm-up run so the first frame is a real chart
   * rather than a single dot.
   */
  private seedSyntheticHistory() {
    const now = Date.now();
    const warm = new PriceEngine({
      seed: Math.floor(Math.random() * 0xffffffff),
      startPrice: this.price,
      annualVol: this.annualVol,
    });
    const points: Tick[] = [];
    const steps = Math.floor(SERIES_WINDOW_MS / SAMPLE_MS);
    for (let i = 0; i < steps; i++) {
      points.push({ t: now - SERIES_WINDOW_MS + i * SAMPLE_MS, p: warm.step(SAMPLE_MS) });
    }
    // Shift the whole run so it ends exactly where the live engine begins.
    // A constant offset preserves the shape; tapering it per point would pin
    // both ends of the window to the same price and read as a repeating arc.
    const offset = this.price - warm.price;
    for (const pt of points) pt.p = Math.round((pt.p + offset) * 100) / 100;
    this.series = points;
    this.minuteBars = this.warmMinuteBars(now);
    const bounds = roundBounds(now, this.roundMs);
    this.round = {
      ...this.round,
      strike: this.strikeFor(this.priceAt(bounds.startsAt)),
    };
  }

  /**
   * A day of one-minute bars, run at five-second granularity so the wicks are
   * real rather than straight lines between closes. Around 17,000 steps, which
   * costs a few milliseconds once at startup.
   */
  private warmMinuteBars(now: number): Candle[] {
    const step = 5_000;
    const span = MAX_MINUTE_BARS * MINUTE_MS;
    const warm = new PriceEngine({
      seed: Math.floor(Math.random() * 0xffffffff),
      startPrice: this.price,
      annualVol: this.annualVol,
    });
    const bars: Candle[] = [];
    for (let t = now - span; t <= now; t += step) {
      const price = warm.step(step);
      const bucket = Math.floor(t / MINUTE_MS) * MINUTE_MS;
      const last = bars[bars.length - 1];
      if (!last || last.t !== bucket) {
        bars.push({ t: bucket, open: price, high: price, low: price, close: price, live: false });
      } else {
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
        last.close = price;
      }
    }
    // Land the warm-up on the live price so the history joins the tape.
    const drift = this.price - warm.price;
    for (const b of bars) {
      b.open += drift;
      b.high += drift;
      b.low += drift;
      b.close += drift;
    }
    if (bars.length) bars[bars.length - 1].live = true;
    return bars;
  }

  // =========================================================================
  // main loop
  // =========================================================================

  private tick() {
    const now = Date.now();
    const gap = now - this.lastStepAt;
    this.lastStepAt = now;

    // Browsers throttle timers in background tabs, so a returning user can be
    // minutes behind. Run the process forward across the gap instead of
    // teleporting the price.
    if (gap > 3_000 && this.mode === 'sim') {
      this.catchUp(now, gap);
      this.maybeRollRound(now);
      this.recompute(now);
      this.maybeLockCall(now);
      this.emitSlow();
      return;
    }
    const dt = Math.min(gap, 2_000);

    if (this.mode === 'sim') {
      const next = this.engine.step(dt);
      this.setPrice(next);
      this.annualVol = this.engine.vol;
    } else {
      if (this.livePrice > 0) this.setPrice(this.livePrice);
      if (now - this.volEstimateAt > 5_000) {
        this.volEstimateAt = now;
        const est = this.estimateAnnualVol(now);
        // Blend, so a refreshed estimate nudges the odds instead of jumping them.
        if (est !== null) this.annualVol = this.annualVol * 0.7 + est * 0.3;
      }
    }

    // Before the first live tick lands, `price` still holds the simulator's
    // last value. Sampling it would splice a fake segment into the real tape.
    const priceIsReal = this.mode === 'sim' || this.livePrice > 0;

    if (priceIsReal && now - this.lastSampleAt >= SAMPLE_MS) {
      this.lastSampleAt = now;
      this.series.push({ t: now, p: this.price });
      this.trimSeries(now);
      this.recordMinuteBar(now, this.price);
    }

    const past = this.priceAt(now - 1_500);
    const epsilon = Math.max(0.01, this.price * 2e-6);
    this.recentDir =
      this.price > past + epsilon ? 1 : this.price < past - epsilon ? -1 : 0;

    const rolled = this.maybeRollRound(now);
    this.recompute(now);
    const filled = this.fillRestingOrders(now);
    const called = this.maybeLockCall(now);
    this.pollTape(now);

    if (this.sheet === 'book') this.book = this.bookSim.snapshot(this.quote.pUp);

    if (rolled || filled || called) this.emitSlow();
    else this.emitFast();
  }

  /** Advance the simulation across a long gap, filling the tape as it goes. */
  private catchUp(now: number, gapMs: number) {
    const capped = Math.min(gapMs, SERIES_WINDOW_MS);
    const steps = Math.min(2_000, Math.max(1, Math.ceil(capped / 1_000)));
    const stepMs = capped / steps;
    const from = now - capped;
    for (let i = 1; i <= steps; i++) {
      this.series.push({ t: from + i * stepMs, p: this.engine.step(stepMs) });
    }
    this.annualVol = this.engine.vol;
    this.setPrice(this.engine.price);
    this.lastSampleAt = now;
    this.trimSeries(now);
  }

  private setPrice(next: number) {
    if (next === this.price) {
      this.tickDir = 0;
      return;
    }
    this.prevPrice = this.price;
    this.tickDir = next > this.price ? 1 : -1;
    this.price = next;
  }

  /** Folds a sample into the minute bar it belongs to, opening one if needed. */
  private recordMinuteBar(t: number, price: number) {
    const bucket = Math.floor(t / MINUTE_MS) * MINUTE_MS;
    const last = this.minuteBars[this.minuteBars.length - 1];
    if (!last || last.t !== bucket) {
      if (last) last.live = false;
      this.minuteBars.push({
        t: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        live: true,
      });
      if (this.minuteBars.length > MAX_MINUTE_BARS) {
        this.minuteBars.splice(0, this.minuteBars.length - MAX_MINUTE_BARS);
      }
      return;
    }
    if (price > last.high) last.high = price;
    if (price < last.low) last.low = price;
    last.close = price;
  }

  private trimSeries(now: number) {
    const cutoff = now - SERIES_WINDOW_MS;
    if (this.series.length > 64 && this.series[0].t < cutoff) {
      let i = 0;
      while (i < this.series.length && this.series[i].t < cutoff) i++;
      // Keep one point before the cutoff so the line still reaches the edge.
      if (i > 1) this.series.splice(0, i - 1);
    }
  }

  /**
   * Realized annualised volatility from the tape itself, used to price the
   * live market — the simulator knows its own vol, but real BTC does not
   * announce it.
   *
   * Sampling on a fixed 5s grid keeps this unbiased even when the underlying
   * data is coarser (seeded 1-minute candles): variance adds linearly in
   * time, so spreading one minute's move across twelve grid steps recovers
   * the same per-step variance.
   */
  private estimateAnnualVol(now: number): number | null {
    const s = this.series;
    if (s.length < 8) return null;
    const stepMs = 5_000;
    const from = Math.max(s[0].t, now - 10 * 60_000);
    const steps = Math.floor((now - from) / stepMs);
    if (steps < 12) return null;

    let sum = 0;
    let sumSq = 0;
    let count = 0;
    let prev = this.priceAt(from);
    for (let i = 1; i <= steps; i++) {
      const p = this.priceAt(from + i * stepMs);
      if (p > 0 && prev > 0) {
        const r = Math.log(p / prev);
        sum += r;
        sumSq += r * r;
        count += 1;
      }
      prev = p;
    }
    if (count < 12) return null;

    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    const annual = Math.sqrt(variance) * Math.sqrt(SECONDS_PER_YEAR / (stepMs / 1000));
    return clamp(annual, 0.05, 3);
  }

  private recompute(now: number) {
    const msLeft = Math.max(0, this.round.endsAt - now);
    const pUp = probUp(this.price, this.round.strike, this.annualVol, msLeft);
    const { up, down } = displayPercents(pUp);
    this.quote = {
      pUp,
      upPct: up,
      downPct: down,
      upMultiplier: multiplierFor(pUp),
      downMultiplier: multiplierFor(1 - pUp),
    };
  }

  private pollTape(now: number) {
    const entry = this.tapeSim.poll(now, this.quote.pUp);
    if (!entry) return;
    this.tape = [entry, ...this.tape].slice(0, MAX_TAPE);
  }

  // =========================================================================
  // rounds & settlement
  // =========================================================================

  private maybeRollRound(now: number): boolean {
    const bounds = roundBounds(now, this.roundMs);
    if (bounds.index === this.round.index) return false;

    const closePrice = this.priceAt(this.round.endsAt);
    const settled = settleRound(this.round, closePrice);
    this.recordCallOutcome(settled);
    this.settlePositions(settled);
    this.round = makeRound(now, this.roundMs, this.strikeFor(this.price));
    this.pruneComboDraft();
    this.voidUnsettled(now);
    this.queueSave();
    return true;
  }

  /**
   * Anything still open on a round that has already gone by can never be
   * settled honestly — there is no price path for it. Refund those stakes.
   * This happens when rounds elapse with the app closed or backgrounded.
   */
  private voidUnsettled(now: number) {
    let refunded = 0;
    this.positions = this.positions.filter((p) => {
      if (p.status === 'open' && p.roundEndsAt <= now && p.roundId !== this.round.id) {
        refunded += p.stake;
        return false;
      }
      return true;
    });
    this.combos = this.combos.filter((c) => {
      if (c.status !== 'open') return true;
      // Legs resolve in order, so more past legs than wins means one was skipped.
      const elapsed = c.legs.filter((l) => l.roundIndex < this.round.index).length;
      if (elapsed > c.legsWon) {
        refunded += c.stake;
        return false;
      }
      return true;
    });
    this.limitOrders = this.limitOrders.filter((o) => {
      if (o.status === 'resting' && o.roundEndsAt <= now && o.roundId !== this.round.id) {
        refunded += o.stake;
        return false;
      }
      return true;
    });
    // A call on a round that went by unwatched has no honest result to grade,
    // so it is dropped rather than counted either way.
    this.calls = this.calls.filter(
      (c) => c.outcome !== undefined || c.roundId === this.round.id,
    );
    if (refunded <= 0) return;
    this.balanceCents += Math.round(refunded * 100);
    this.showToast({
      kind: 'info',
      title: 'Picks refunded',
      detail: `$${refunded.toFixed(2)} returned — those rounds closed while you were away`,
    });
  }

  /** Nearest sampled price at or before `ts`, falling back to the last price. */
  private priceAt(ts: number): number {
    const s = this.series;
    if (s.length === 0) return this.price;
    let lo = 0;
    let hi = s.length - 1;
    if (s[0].t > ts) return s[0].p;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].t <= ts) lo = mid;
      else hi = mid - 1;
    }
    return s[lo].p;
  }

  private settlePositions(round: Round) {
    const result = round.result!;
    let pnl = 0;
    let staked = 0;
    let won = 0;
    let lost = 0;

    // A resting order that never got its price simply expires; the reserved
    // stake was never spent, so it goes back.
    let expired = 0;
    this.limitOrders = this.limitOrders.map((o) => {
      if (o.status !== 'resting' || o.roundId !== round.id) return o;
      this.balanceCents += Math.round(o.stake * 100);
      expired += o.stake;
      return { ...o, status: 'expired' as const };
    });
    if (expired > 0) {
      this.showToast({
        kind: 'info',
        title: 'Limit order expired',
        detail: `$${expired.toFixed(2)} returned — the round closed before your price`,
      });
    }

    this.positions = this.positions.map((pos) => {
      if (pos.roundId !== round.id || pos.status !== 'open') return pos;
      staked += pos.stake;
      if (pos.side === result) {
        const credit = Math.round(pos.stake * pos.multiplier * 100);
        this.balanceCents += credit;
        const gain = credit / 100 - pos.stake;
        pnl += gain;
        won += 1;
        return { ...pos, status: 'won' as const, pnl: gain };
      }
      pnl -= pos.stake;
      lost += 1;
      return { ...pos, status: 'lost' as const, pnl: -pos.stake };
    });

    // Tickets cashed out before the bell were already paid; their result is
    // still part of what this round did to the balance.
    for (const p of this.positions) {
      if (p.status === 'closed' && p.roundId === round.id) {
        staked += p.stake;
        pnl += p.pnl ?? 0;
      }
    }

    const comboOutcome = this.settleCombos(round, result);
    pnl += comboOutcome.pnl;
    staked += comboOutcome.staked;

    const record: RoundResult = {
      roundId: round.id,
      index: round.index,
      endsAt: round.endsAt,
      strike: round.strike,
      closePrice: round.closePrice!,
      result,
      pnl,
      staked,
    };
    this.history = [record, ...this.history].slice(0, MAX_HISTORY);
    // Only settled positions from the last few rounds are worth keeping around.
    this.positions = this.positions.filter(
      (p) => p.status === 'open' || p.roundEndsAt > Date.now() - 60 * 60_000,
    );

    if (staked > 0) {
      const net = pnl;
      this.showToast({
        kind: net > 0 ? 'win' : net < 0 ? 'loss' : 'info',
        title:
          net > 0
            ? `${result === 'up' ? 'Up' : 'Down'} wins`
            : `${result === 'up' ? 'Up' : 'Down'} wins`,
        detail:
          net > 0
            ? `+$${net.toFixed(2)} settled to your balance`
            : net < 0
              ? `-$${Math.abs(net).toFixed(2)} on ${lost} pick${lost === 1 ? '' : 's'}`
              : 'Settled flat',
      });
      if (won > 0) this.buzz([12, 40, 18]);
      else this.buzz(18);
    }
  }

  private settleCombos(round: Round, result: Side) {
    let pnl = 0;
    let staked = 0;
    this.combos = this.combos.map((combo) => {
      if (combo.status !== 'open') return combo;
      const leg = combo.legs.find((l) => l.roundIndex === round.index);
      if (!leg) return combo;
      if (leg.side !== result) {
        staked += combo.stake;
        pnl -= combo.stake;
        return { ...combo, status: 'lost' as const, pnl: -combo.stake };
      }
      const legsWon = combo.legsWon + 1;
      if (legsWon < combo.legs.length) return { ...combo, legsWon };
      const credit = Math.round(combo.stake * combo.multiplier * 100);
      this.balanceCents += credit;
      const gain = credit / 100 - combo.stake;
      staked += combo.stake;
      pnl += gain;
      return { ...combo, legsWon, status: 'won' as const, pnl: gain };
    });
    return { pnl, staked };
  }

  /**
   * Open tickets cannot be settled honestly across a reload — the price path
   * that would have decided them never happened here. Refund instead.
   */
  private refundStale(
    positions?: Position[],
    combos?: ComboTicket[],
    orders?: LimitOrder[],
  ) {
    let refunded = 0;
    for (const p of positions ?? []) {
      if (p.status === 'open') {
        this.balanceCents += Math.round(p.stake * 100);
        refunded += p.stake;
      }
    }
    for (const c of combos ?? []) {
      if (c.status === 'open') {
        this.balanceCents += Math.round(c.stake * 100);
        refunded += c.stake;
      }
    }
    for (const o of orders ?? []) {
      if (o.status === 'resting') {
        this.balanceCents += Math.round(o.stake * 100);
        refunded += o.stake;
      }
    }
    if (refunded > 0) {
      this.toast = {
        id: this.toastSeq++,
        kind: 'info',
        title: 'Open picks refunded',
        detail: `$${refunded.toFixed(2)} returned — open picks do not survive a reload`,
      };
    }
  }

  // =========================================================================
  // trading
  // =========================================================================

  get balance(): number {
    return this.balanceCents / 100;
  }

  get msLeft(): number {
    return Math.max(0, this.round.endsAt - Date.now());
  }

  get isLocked(): boolean {
    return this.msLeft <= LOCK_MS;
  }

  /** A live market with no feed has no price to settle against. */
  get feedDown(): boolean {
    return this.mode === 'live' && this.feedStatus === 'error';
  }

  /** Live mode, connected or not, but no real price has arrived yet. */
  get awaitingFeed(): boolean {
    return this.mode === 'live' && this.livePrice <= 0;
  }

  get canTrade(): boolean {
    return !this.isLocked && !this.feedDown && !this.awaitingFeed;
  }

  get openPositions(): Position[] {
    return this.positions.filter(
      (p) => p.status === 'open' && p.roundId === this.round.id,
    );
  }

  get openCombos(): ComboTicket[] {
    return this.combos.filter((c) => c.status === 'open');
  }

  /** Net exposure on the current round, per side. */
  stakeOn(side: Side): number {
    return this.openPositions
      .filter((p) => p.side === side)
      .reduce((sum, p) => sum + p.stake, 0);
  }

  /** What the open tickets on the current round return if `side` settles. */
  returnIf(side: Side): number {
    return this.openPositions
      .filter((p) => p.side === side)
      .reduce((sum, p) => sum + p.stake * p.multiplier, 0);
  }

  placeBet(side: Side, stake: number): { ok: boolean; error?: string } {
    const amount = Math.round(stake * 100) / 100;
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount' };
    if (this.feedDown) return { ok: false, error: 'No live price — feed is offline' };
    if (this.isLocked) return { ok: false, error: 'Market locked for settlement' };
    if (Math.round(amount * 100) > this.balanceCents) {
      return { ok: false, error: 'Not enough balance' };
    }

    const multiplier =
      side === 'up' ? this.quote.upMultiplier : this.quote.downMultiplier;
    const position: Position = {
      id: `p${this.idSeq++}`,
      roundId: this.round.id,
      roundEndsAt: this.round.endsAt,
      side,
      stake: amount,
      multiplier,
      entryPrice: this.price,
      entryProb: side === 'up' ? this.quote.pUp : 1 - this.quote.pUp,
      placedAt: Date.now(),
      status: 'open',
    };
    this.balanceCents -= Math.round(amount * 100);
    this.positions = [position, ...this.positions];
    this.buzz(10);
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  // ---- resting limit orders ---------------------------------------------

  get restingOrders(): LimitOrder[] {
    return this.limitOrders.filter(
      (o) => o.status === 'resting' && o.roundId === this.round.id,
    );
  }

  /** The live price of a side, in cents, as the book quotes it. */
  centsFor(side: Side): number {
    return sideCents(side, this.quote.pUp);
  }

  /**
   * Rests a buy at a price. Contracts settle at $1.00, so a lower price is a
   * better price: an Up order at 40c fills only if Up gets that cheap, and
   * pays more when it does.
   */
  placeLimitOrder(
    side: Side,
    limitCents: number,
    stake: number,
  ): { ok: boolean; error?: string } {
    const amount = Math.round(stake * 100) / 100;
    const cents = Math.round(limitCents);
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount' };
    if (!(cents >= 1 && cents <= 99)) {
      return { ok: false, error: 'Price must be between 1c and 99c' };
    }
    if (this.feedDown) return { ok: false, error: 'No live price — feed is offline' };
    if (this.isLocked) return { ok: false, error: 'Market locked for settlement' };
    if (Math.round(amount * 100) > this.balanceCents) {
      return { ok: false, error: 'Not enough balance' };
    }

    this.balanceCents -= Math.round(amount * 100);
    this.limitOrders = [
      {
        id: `o${this.idSeq++}`,
        roundId: this.round.id,
        roundEndsAt: this.round.endsAt,
        side,
        limitCents: cents,
        stake: amount,
        placedAt: Date.now(),
        status: 'resting',
      },
      ...this.limitOrders,
    ];
    this.buzz(8);
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  cancelLimitOrder(id: string): boolean {
    const order = this.limitOrders.find((o) => o.id === id && o.status === 'resting');
    if (!order) return false;
    this.balanceCents += Math.round(order.stake * 100);
    this.limitOrders = this.limitOrders.map((o) =>
      o.id === id ? { ...o, status: 'cancelled' as const } : o,
    );
    this.queueSave();
    this.emitSlow();
    return true;
  }

  /**
   * Fills any resting order the market has reached. A buyer gets the market
   * price when it is better than the limit, never worse than the price asked.
   */
  private fillRestingOrders(now: number): boolean {
    if (this.isLocked || this.feedDown || this.awaitingFeed) return false;
    const resting = this.limitOrders.filter(
      (o) => o.status === 'resting' && o.roundId === this.round.id,
    );
    if (resting.length === 0) return false;

    let anyFilled = false;
    for (const order of resting) {
      const market = this.centsFor(order.side);
      if (!limitFills(market, order.limitCents)) continue;

      const multiplier = multiplierAtCents(market);
      this.positions = [
        {
          id: `p${this.idSeq++}`,
          roundId: this.round.id,
          roundEndsAt: this.round.endsAt,
          side: order.side,
          stake: order.stake,
          multiplier,
          entryPrice: this.price,
          entryProb: market / 100,
          placedAt: now,
          status: 'open',
          fromOrderId: order.id,
        },
        ...this.positions,
      ];
      this.limitOrders = this.limitOrders.map((o) =>
        o.id === order.id
          ? { ...o, status: 'filled' as const, filledCents: market, filledAt: now }
          : o,
      );
      anyFilled = true;
    }

    if (anyFilled) {
      this.buzz([8, 30, 8]);
      this.showToast({
        kind: 'info',
        title: 'Limit order filled',
        detail: 'Your resting order is now an open position',
      });
      this.queueSave();
    }
    return anyFilled;
  }

  // ---- marking open positions to market ----------------------------------

  /** What an open ticket is worth right now, and the P&L that implies. */
  markOf(position: Position): { value: number; pnl: number } {
    const value = markToMarket(
      position.stake,
      position.multiplier,
      probOf(position.side, this.quote.pUp),
    );
    return { value, pnl: value - position.stake };
  }

  /** Unrealised P&L across every open ticket on this round. */
  get openPnl(): number {
    return this.openPositions.reduce((sum, p) => sum + this.markOf(p).pnl, 0);
  }

  /** Total cash-out value of every open ticket. */
  get openValue(): number {
    return this.openPositions.reduce((sum, p) => sum + this.markOf(p).value, 0);
  }

  /**
   * Cashes a ticket out before the round ends, at what it is currently worth.
   * Suspended inside the settlement lock, the same as opening a new one.
   */
  closePosition(id: string): { ok: boolean; error?: string } {
    const position = this.positions.find((p) => p.id === id && p.status === 'open');
    if (!position) return { ok: false, error: 'Position is no longer open' };
    if (this.feedDown || this.awaitingFeed) {
      return { ok: false, error: 'No live price to close against' };
    }
    if (this.isLocked) return { ok: false, error: 'Closing is suspended near settlement' };

    const { value, pnl } = this.markOf(position);
    const credit = Math.round(value * 100);
    this.balanceCents += credit;
    this.positions = this.positions.map((p) =>
      p.id === id
        ? {
            ...p,
            status: 'closed' as const,
            closedAt: Date.now(),
            closeValue: credit / 100,
            pnl: credit / 100 - p.stake,
          }
        : p,
    );
    this.buzz(12);
    this.showToast({
      kind: pnl >= 0 ? 'win' : 'loss',
      title: 'Position closed',
      detail: `${pnl >= 0 ? '+' : '-'}$${Math.abs(credit / 100 - position.stake).toFixed(2)} locked in`,
    });
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  placeCombo(stake: number): { ok: boolean; error?: string } {
    const amount = Math.round(stake * 100) / 100;
    const entries = [...this.comboDraft.entries()].sort((a, b) => a[0] - b[0]);
    if (entries.length < 2) return { ok: false, error: 'Pick at least two rounds' };
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount' };
    if (Math.round(amount * 100) > this.balanceCents) {
      return { ok: false, error: 'Not enough balance' };
    }
    if (this.feedDown) return { ok: false, error: 'No live price — feed is offline' };
    if (this.isLocked && entries.some(([i]) => i === this.round.index)) {
      return { ok: false, error: 'This round is locked' };
    }

    const legs: ComboLeg[] = entries.map(([roundIndex, side]) => ({
      roundIndex,
      side,
      multiplier: this.comboLegMultiplier(roundIndex, side),
    }));
    const multiplier = legs.reduce((m, l) => m * l.multiplier, 1);

    this.balanceCents -= Math.round(amount * 100);
    this.combos = [
      {
        id: `c${this.idSeq++}`,
        legs,
        stake: amount,
        multiplier,
        placedAt: Date.now(),
        status: 'open',
        legsWon: 0,
      },
      ...this.combos,
    ];
    this.comboDraft = new Map();
    this.buzz([10, 30, 10]);
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  /**
   * The current round is priced off the live book; future rounds have no
   * strike yet, so they are a coin flip at the standard multiplier.
   */
  comboLegMultiplier(roundIndex: number, side: Side): number {
    if (roundIndex === this.round.index) {
      return side === 'up' ? this.quote.upMultiplier : this.quote.downMultiplier;
    }
    return multiplierFor(0.5);
  }

  toggleComboLeg(roundIndex: number, side: Side) {
    const current = this.comboDraft.get(roundIndex);
    const next = new Map(this.comboDraft);
    if (current === side) next.delete(roundIndex);
    else next.set(roundIndex, side);
    this.comboDraft = next;
    this.emitSlow();
  }

  clearComboDraft() {
    this.comboDraft = new Map();
    this.emitSlow();
  }

  private pruneComboDraft() {
    if (this.comboDraft.size === 0) return;
    const next = new Map<number, Side>();
    for (const [index, side] of this.comboDraft) {
      if (index >= this.round.index) next.set(index, side);
    }
    this.comboDraft = next;
  }

  // =========================================================================
  // settings
  // =========================================================================

  /**
   * Open tickets belong to one price source and one round grid. Changing
   * either would leave them settling against something they were never
   * priced on, so they are handed back instead.
   */
  private refundOpenTickets(reason: string) {
    let refunded = 0;
    for (const p of this.positions) if (p.status === 'open') refunded += p.stake;
    for (const c of this.combos) if (c.status === 'open') refunded += c.stake;
    for (const o of this.limitOrders) if (o.status === 'resting') refunded += o.stake;
    if (refunded <= 0) return;
    this.balanceCents += Math.round(refunded * 100);
    this.positions = this.positions.filter((p) => p.status !== 'open');
    this.combos = this.combos.filter((c) => c.status !== 'open');
    this.limitOrders = this.limitOrders.filter((o) => o.status !== 'resting');
    this.showToast({
      kind: 'info',
      title: 'Open picks refunded',
      detail: `$${refunded.toFixed(2)} returned — ${reason}`,
    });
  }

  setMode(mode: FeedMode) {
    if (mode === this.mode) return;
    this.rearmCall(Date.now());
    this.refundOpenTickets('the price source changed');
    this.mode = mode;
    this.livePrice = 0;
    this.series = [];
    this.minuteBars = [];
    this.lastSampleAt = 0;
    this.volEstimateAt = 0;
    this.annualVol = VOL_PRESETS[this.volPreset];
    if (mode === 'live') {
      this.connectLive();
      this.feedStatus = 'connecting';
    } else {
      this.disconnectLive();
      this.feedStatus = 'idle';
      this.engine.reseed(Math.floor(Math.random() * 0xffffffff), this.price);
      this.seedSyntheticHistory();
    }
    this.lastStepAt = Date.now();
    // The strike belongs to the old series; re-anchor to the new feed.
    this.round = { ...this.round, strike: this.strikeFor(this.price) };
    this.queueSave();
    this.emitSlow();
  }

  /** The override wins over any automatically derived target. */
  private strikeFor(auto: number): number {
    return this.strikeMode === 'manual' && this.manualStrike > 0
      ? this.manualStrike
      : auto;
  }

  /**
   * Pins the target to a price you supply, so this market can be lined up
   * against the strike a real book is quoting. It holds across rounds until
   * cleared — a real strike does not move just because our clock rolled over.
   *
   * Open tickets were priced against the old target, so they are refunded
   * rather than silently repriced against a target they never agreed to.
   */
  setManualStrike(value: number): { ok: boolean; error?: string } {
    const strike = Math.round(value * 100) / 100;
    if (!Number.isFinite(strike) || strike <= 0) {
      return { ok: false, error: 'Enter a price above zero' };
    }
    if (strike === this.round.strike && this.strikeMode === 'manual') {
      return { ok: true };
    }
    this.rearmCall(Date.now());
    this.refundOpenTickets('the target changed');
    this.strikeMode = 'manual';
    this.manualStrike = strike;
    this.round = { ...this.round, strike };
    this.recompute(Date.now());
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  /** Hands the target back to the price at the round's open. */
  clearManualStrike() {
    if (this.strikeMode === 'auto') return;
    this.rearmCall(Date.now());
    this.refundOpenTickets('the target changed');
    this.strikeMode = 'auto';
    this.manualStrike = 0;
    const bounds = roundBounds(Date.now(), this.roundMs);
    const at = this.priceAt(bounds.startsAt);
    this.round = { ...this.round, strike: at > 0 ? at : this.price };
    this.recompute(Date.now());
    this.queueSave();
    this.emitSlow();
  }

  setRoundMs(roundMs: number) {
    if (roundMs === this.roundMs) return;
    this.refundOpenTickets('the round length changed');
    this.dropLiveCall();
    this.roundMs = roundMs;
    const now = Date.now();
    const bounds = roundBounds(now, roundMs);
    this.round = makeRound(now, roundMs, this.strikeFor(this.priceAt(bounds.startsAt)));
    this.comboDraft = new Map();
    this.queueSave();
    this.emitSlow();
  }

  setVolPreset(preset: VolPreset) {
    this.volPreset = preset;
    this.annualVol = VOL_PRESETS[preset];
    this.engine.setVol(this.annualVol);
    this.queueSave();
    this.emitSlow();
  }

  /** Clamped to the band where the indicator still behaves sensibly. */
  setSignalKey(value: number) {
    this.signalKey = Math.min(6, Math.max(0.3, Math.round(value * 10) / 10));
    this.queueSave();
    this.emitSlow();
  }

  setSignals(on: boolean) {
    this.signalsOn = on;
    this.queueSave();
    this.emitSlow();
  }

  setHaptics(on: boolean) {
    this.hapticsOn = on;
    this.queueSave();
    this.emitSlow();
  }

  setTimeframe(tf: Timeframe) {
    this.timeframe = tf;
    this.emitSlow();
  }

  setChartView(view: ChartView) {
    this.chartView = view;
    this.emitSlow();
  }

  setCandleMs(ms: number) {
    this.candleMs = ms;
    this.emitSlow();
  }

  /** One tap on the market name flips between the simulator and real BTC. */
  toggleMode() {
    this.setMode(this.mode === 'sim' ? 'live' : 'sim');
  }

  openSheet(sheet: SheetName, side?: Side) {
    if (side) this.ticketSide = side;
    if (sheet === 'book') this.book = this.bookSim.snapshot(this.quote.pUp);
    this.sheet = sheet;
    this.emitSlow();
  }

  closeSheet() {
    this.sheet = null;
    this.emitSlow();
  }

  setTicketStake(stake: number) {
    this.ticketStake = Math.max(0, Math.round(stake * 100) / 100);
    this.emitSlow();
  }

  /** The largest practice balance worth allowing; past this the numbers stop
   * meaning anything and the formatting starts to break. */
  private static readonly MAX_BALANCE_CENTS = 100_000_000_00;

  /**
   * Sets the balance outright. Open tickets are left alone: they were priced
   * against a target and a quote, neither of which the balance touches.
   */
  setBalance(dollars: number): { ok: boolean; error?: string } {
    if (!Number.isFinite(dollars) || dollars < 0) {
      return { ok: false, error: 'Enter an amount of zero or more' };
    }
    const cents = Math.min(
      MarketStore.MAX_BALANCE_CENTS,
      Math.round(dollars * 100),
    );
    this.balanceCents = cents;
    // A reset should return you to the stake you chose, not to mine.
    this.startingBalanceCents = cents;
    this.queueSave();
    this.showToast({
      kind: 'info',
      title: 'Balance set',
      detail: `Practice balance is now $${(cents / 100).toFixed(2)}`,
    });
    this.emitSlow();
    return { ok: true };
  }

  /** Tops the balance up without changing what a reset returns to. */
  addFunds(dollars: number): { ok: boolean; error?: string } {
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return { ok: false, error: 'Enter an amount above zero' };
    }
    this.balanceCents = Math.min(
      MarketStore.MAX_BALANCE_CENTS,
      this.balanceCents + Math.round(dollars * 100),
    );
    this.queueSave();
    this.showToast({
      kind: 'info',
      title: 'Funds added',
      detail: `+$${dollars.toFixed(2)} · balance $${(this.balanceCents / 100).toFixed(2)}`,
    });
    this.emitSlow();
    return { ok: true };
  }

  resetAccount() {
    this.balanceCents = this.startingBalanceCents;
    this.positions = [];
    this.limitOrders = [];
    this.combos = [];
    this.history = [];
    this.comboDraft = new Map();
    this.strikeMode = 'auto';
    this.manualStrike = 0;
    clearState();
    this.queueSave();
    this.showToast({
      kind: 'info',
      title: 'Practice account reset',
      detail: `Balance back to $${(this.startingBalanceCents / 100).toFixed(2)}`,
    });
    this.emitSlow();
  }

  dismissToast() {
    this.toast = null;
    this.emitSlow();
  }

  private showToast(t: Omit<Toast, 'id'>) {
    this.toast = { ...t, id: this.toastSeq++ };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.emitSlow();
    }, 5_000);
  }

  private buzz(pattern: number | number[]) {
    if (!this.hapticsOn) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  // =========================================================================
  // live feed
  // =========================================================================

  private connectLive() {
    if (this.feed) return;
    this.feed = new LiveFeed({
      onTick: (tick) => {
        const first = this.livePrice <= 0;
        this.livePrice = tick.p;
        if (first && this.mode === 'live') this.adoptLivePrice(tick.p);
      },
      onStatus: (status, detail) => {
        this.feedStatus = status;
        this.feedDetail = detail ?? '';
        this.emitSlow();
      },
      onHistory: (ticks) => {
        if (this.mode !== 'live') return;
        this.series = [...ticks, ...this.series].sort((a, b) => a.t - b.t);
        // Seed the bar history from the same candles, so the candle chart has
        // depth immediately rather than building it a minute at a time.
        const seeded: Candle[] = ticks.map((t) => ({
          t: Math.floor(t.t / MINUTE_MS) * MINUTE_MS,
          open: t.p,
          high: t.p,
          low: t.p,
          close: t.p,
          live: false,
        }));
        const known = new Set(this.minuteBars.map((b) => b.t));
        this.minuteBars = [...seeded.filter((b) => !known.has(b.t)), ...this.minuteBars]
          .sort((a, b) => a.t - b.t)
          .slice(-MAX_MINUTE_BARS);
        if (this.livePrice <= 0) {
          // Candles are real prices, so they are a legitimate first quote.
          this.livePrice = ticks[ticks.length - 1].p;
          this.adoptLivePrice(this.livePrice);
        } else {
          this.reanchorStrike();
        }
        this.emitSlow();
      },
    });
    this.feed.start();
  }

  /** Take the first real price as the current one, with no flash or jump. */
  private adoptLivePrice(p: number) {
    this.price = this.prevPrice = p;
    this.tickDir = 0;
    this.recentDir = 0;
    this.reanchorStrike();
    this.emitSlow();
  }

  /** Re-read the strike from whatever the series says the round opened at. */
  private reanchorStrike() {
    const bounds = roundBounds(Date.now(), this.roundMs);
    const at = this.priceAt(bounds.startsAt);
    this.round = { ...this.round, strike: this.strikeFor(at > 0 ? at : this.price) };
  }

  private disconnectLive() {
    this.feed?.stop();
    this.feed = null;
    this.livePrice = 0;
  }

  // =========================================================================
  // the locked call
  // =========================================================================

  /** The call for the round now running, once it has been made. */
  get currentCall(): LockedCall | null {
    return this.calls.find((c) => c.roundId === this.round.id) ?? null;
  }

  /**
   * The call the strip should be asking you about: the one that just finished.
   *
   * Only the round immediately gone by, so an ungraded call cannot sit in the
   * strip forever and hide the live one. Anything older stays on file and can
   * still be graded from the sheet.
   */
  get pendingGrade(): LockedCall | null {
    return (
      this.calls.find(
        (c) =>
          c.outcome !== undefined && !c.grade && c.roundIndex >= this.round.index - 1,
      ) ?? null
    );
  }

  /** Every finished call still missing your verdict, newest first. */
  get gradableCalls(): LockedCall[] {
    return this.calls.filter((c) => c.outcome !== undefined && !c.grade);
  }

  /** When this round's call may be made, allowing for a moved target. */
  private get callOpensAt(): number {
    return callOpensAt(
      this.round.startsAt,
      this.roundMs,
      this.targetChangedAt,
      this.callRequestedAt,
    );
  }

  /** True while a call you asked for outright is counting down. */
  get callOnDemand(): boolean {
    if (this.currentCall) return false;
    return (
      this.callRequestedAt > this.round.startsAt &&
      this.callRequestedAt >= this.targetChangedAt
    );
  }

  /** Whether asking for a call right now would leave time to make one. */
  get canRequestCall(): boolean {
    return canRequestCallAt(this.round.startsAt, this.roundMs, Date.now());
  }

  /**
   * Asks for a call ninety seconds from now, throwing away whatever it had
   * already committed to this round.
   *
   * This is the one door out of "locked and left alone", and it is deliberate:
   * you opened it. Re-rolled calls still go in the record, so pressing until
   * you like the answer will show up in the calibration rather than hiding.
   */
  requestCall(): { ok: boolean; error?: string } {
    const now = Date.now();
    if (!canRequestCallAt(this.round.startsAt, this.roundMs, now)) {
      return { ok: false, error: 'Not enough of this round left to call' };
    }
    this.callRequestedAt = now;
    this.targetChangedAt = 0;
    this.dropLiveCall();
    this.buzz(12);
    this.showToast({
      kind: 'info',
      title: 'Call coming',
      detail: 'Watching for 90 seconds, then it commits',
    });
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  /** Milliseconds until this round's call commits. Zero once it has. */
  get msToCall(): number {
    if (this.currentCall) return 0;
    return Math.max(0, this.callOpensAt - Date.now());
  }

  /** True while the caller is watching a target you changed mid-round. */
  get callRearmed(): boolean {
    return (
      !this.currentCall &&
      !this.callOnDemand &&
      this.targetChangedAt > this.round.startsAt
    );
  }

  /** The window the countdown is running against, for a progress bar. */
  get callWaitMs(): number {
    if (this.callOnDemand) return CALL_ON_DEMAND_MS;
    return this.callRearmed ? rearmDelayFor(this.roundMs) : lockDelayFor(this.roundMs);
  }

  /**
   * Sends the call clock back to zero because the target moved.
   *
   * A call is an answer to "does it finish above this number", so a new number
   * is a new question — the old answer is not flipped, it is discarded along
   * with the tickets bought against the same target.
   */
  private rearmCall(now: number) {
    this.targetChangedAt = now;
    this.callRequestedAt = 0;
    const had = this.currentCall !== null;
    this.dropLiveCall();
    // Otherwise the "Call locked" toast sits there contradicting the strip,
    // still announcing an answer that has just been thrown away.
    if (had) {
      this.showToast({
        kind: 'info',
        title: 'Call cleared',
        detail: 'The target moved, so it will look at the new one first',
      });
    }
  }

  /**
   * Forgets the call on the round now running. Used where the round itself is
   * being replaced, which restarts the clock on its own and so needs no
   * re-arm — only the orphaned call cleared out.
   */
  private dropLiveCall() {
    this.calls = this.calls.filter((c) => c.roundId !== this.round.id);
  }

  /** True when this round went past the point where a call was still useful. */
  get callWindowClosed(): boolean {
    if (this.currentCall) return false;
    return Date.now() > this.round.startsAt + callDeadlineFor(this.roundMs);
  }

  get callRecord(): CallStats {
    return callStats(this.calls);
  }

  /**
   * What the model reads at the moment it commits.
   *
   * The bias and momentum windows are deliberately fixed rather than tied to
   * the chart controls: a learned weight only means something if the feature
   * behind it is measured the same way every time.
   */
  private callFeatures(now: number): CallFeatures {
    const msLeft = Math.max(0, this.round.endsAt - now);
    const z = standardisedGap(this.price, this.round.strike, this.annualVol, msLeft);
    const past = this.priceAt(now - MOMENTUM_WINDOW_MS);
    const momentum = past > 0 ? standardisedGap(this.price, past, this.annualVol, msLeft) : 0;
    const bars = aggregateBars(this.minuteBars, DEFAULT_CANDLE_MS, 160);
    const { state } = computeSignals(bars, SIGNAL_RULES);
    const bias = state.bias === 'long' ? 1 : state.bias === 'short' ? -1 : 0;
    return { z, bias, momentum };
  }

  /**
   * Commits this round's call, once, at the four-minute mark.
   *
   * Everything about this method is built around not changing its mind: it
   * returns early if a call already exists for the round, and nothing else in
   * the store ever writes to `side` or `confidence` afterwards. A call that
   * moved with the price would just be the price.
   */
  private maybeLockCall(now: number): boolean {
    if (this.currentCall) return false;
    if (now < this.callOpensAt) return false;
    // Opened too late in the round to say anything worth grading.
    if (now > this.round.startsAt + callDeadlineFor(this.roundMs)) return false;
    // In live mode the price is still the simulator's until the first real
    // tick lands; calling off that would be calling off nothing.
    if (this.mode === 'live' && this.livePrice <= 0) return false;

    const features = this.callFeatures(now);
    const { side, confidence, pUp } = makeCall(features, this.callModel);
    const call: LockedCall = {
      id: `call-${this.idSeq++}`,
      roundId: this.round.id,
      roundIndex: this.round.index,
      roundEndsAt: this.round.endsAt,
      lockedAt: now,
      side,
      confidence,
      pUp,
      spot: this.price,
      strike: this.round.strike,
      features,
      weights: [...this.callModel.weights] as [number, number, number, number],
    };
    this.calls = [call, ...this.calls].slice(0, MAX_CALLS);
    this.buzz(14);
    this.showToast({
      kind: 'info',
      title: `Call locked — ${side === 'up' ? 'YES, up' : 'NO, down'}`,
      detail: `${Math.round(confidence * 100)}% confident. It will not change.`,
    });
    this.queueSave();
    return true;
  }

  /** Records how the round actually went against whatever it called. */
  private recordCallOutcome(round: Round) {
    let touched = false;
    this.calls = this.calls.map((c) => {
      if (c.roundId !== round.id || c.outcome !== undefined) return c;
      touched = true;
      return { ...c, outcome: round.result!, closePrice: round.closePrice! };
    });
    if (touched) this.queueSave();
  }

  /**
   * Your verdict on a finished call, and the only thing that trains the model.
   *
   * "Wrong" means the other side finished, which is exactly the label the
   * gradient step needs — so pressing it is what makes the next call better.
   */
  gradeCall(id: string, grade: CallGrade): { ok: boolean; error?: string } {
    const call = this.calls.find((c) => c.id === id);
    if (!call) return { ok: false, error: 'That call is no longer on file' };
    if (call.grade) return { ok: false, error: 'That call has already been graded' };
    if (call.outcome === undefined) {
      return { ok: false, error: 'Wait for the round to close first' };
    }

    this.callModel = learn(this.callModel, call.features, outcomeFromGrade(call, grade));
    this.calls = this.calls.map((c) =>
      c.id === id ? { ...c, grade, gradedAt: Date.now() } : c,
    );
    this.buzz(grade === 'right' ? [10, 30, 10] : 22);
    this.queueSave();
    this.emitSlow();
    return { ok: true };
  }

  /** Forgets everything it has learned and goes back to the textbook prior. */
  resetCaller() {
    this.callModel = INITIAL_MODEL;
    this.calls = [];
    this.queueSave();
    this.showToast({
      kind: 'info',
      title: 'Caller reset',
      detail: 'Back to the pricing prior, with nothing learned',
    });
    this.emitSlow();
  }

  // =========================================================================
  // persistence
  // =========================================================================

  private queueSave() {
    if (this.saveQueued) return;
    this.saveQueued = true;
    setTimeout(() => {
      this.saveQueued = false;
      saveState({
        mode: this.mode,
        roundMs: this.roundMs,
        volPreset: this.volPreset,
        strikeMode: this.strikeMode,
        manualStrike: this.manualStrike,
        balanceCents: this.balanceCents,
        startingBalanceCents: this.startingBalanceCents,
        history: this.history,
        positions: this.positions.filter((p) => p.status === 'open'),
        limitOrders: this.limitOrders.filter((o) => o.status === 'resting'),
        combos: this.combos.filter((c) => c.status === 'open'),
        simPrice: this.mode === 'sim' ? this.price : 0,
        simSeed: 0,
        hapticsOn: this.hapticsOn,
        signalsOn: this.signalsOn,
        signalKey: this.signalKey,
        calls: this.calls,
        callModel: this.callModel,
      });
    }, 250);
  }
}

export const market = new MarketStore();
