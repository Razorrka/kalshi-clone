import { PriceEngine, VOL_PRESETS, type VolPreset } from '../engine/priceEngine';
import { LiveFeed } from '../engine/liveFeed';
import { OrderBookSim, type OrderBookSnapshot } from '../engine/orderBook';
import { TapeSim, type TapeEntry } from '../engine/tape';
import { LOCK_MS, displayPercents, multiplierFor, probUp } from '../engine/odds';
import { DEFAULT_ROUND_MS, makeRound, roundBounds, settleRound } from '../engine/rounds';
import type {
  ComboLeg,
  ComboTicket,
  FeedMode,
  FeedStatus,
  Position,
  Round,
  RoundResult,
  Side,
  Tick,
  Timeframe,
} from '../engine/types';
import { clearState, loadState, saveState } from './persist';

/** ~5 Hz sampling keeps an hour of tape in a few thousand points. */
const SAMPLE_MS = 200;
const SERIES_WINDOW_MS = 65 * 60_000;
const MAX_TAPE = 4;
const MAX_HISTORY = 40;
const STARTING_BALANCE_CENTS = 1_000_00;

export type SheetName = 'book' | 'ticket' | 'settings' | 'combo' | 'activity';

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
  feedStatus: FeedStatus = 'idle';
  feedDetail = '';

  // ---- account -----------------------------------------------------------
  balanceCents = STARTING_BALANCE_CENTS;
  positions: Position[] = [];
  combos: ComboTicket[] = [];
  history: RoundResult[] = [];

  // ---- ui ----------------------------------------------------------------
  timeframe: Timeframe = 'live';
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
  private lastFastEmit = 0;
  private fastQueued = false;
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
      if (typeof saved.balanceCents === 'number') {
        this.balanceCents = Math.max(0, Math.round(saved.balanceCents));
      }
      if (Array.isArray(saved.history)) this.history = saved.history.slice(0, MAX_HISTORY);
      if (typeof saved.hapticsOn === 'boolean') this.hapticsOn = saved.hapticsOn;
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
    this.round = makeRound(now, this.roundMs, this.price);
    this.refundStale(saved?.positions, saved?.combos);
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
    if (now - this.lastFastEmit < 70) {
      this.fastQueued = true;
      return;
    }
    this.lastFastEmit = now;
    this.fastQueued = false;
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
    if (this.series.length === 0) this.seedSyntheticHistory();
    if (this.mode === 'live') this.connectLive();
    this.loop = setInterval(() => this.tick(), 60);
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.disconnectLive();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  /**
   * Pre-fills the chart by running the engine backwards from "now" so the
   * first frame is a real chart instead of a single dot.
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
    // Re-anchor so the warm-up ends exactly where the live engine begins.
    const drift = this.price - warm.price;
    for (let i = 0; i < points.length; i++) {
      points[i].p = Math.round((points[i].p + drift * (i / points.length)) * 100) / 100;
    }
    this.series = points;
    const bounds = roundBounds(now, this.roundMs);
    this.round = { ...this.round, strike: this.priceAt(bounds.startsAt) };
  }

  // =========================================================================
  // main loop
  // =========================================================================

  private tick() {
    const now = Date.now();
    const dt = Math.min(now - this.lastStepAt, 2_000);
    this.lastStepAt = now;

    if (this.mode === 'sim') {
      const next = this.engine.step(dt);
      this.setPrice(next);
      this.annualVol = this.engine.vol;
    } else if (this.livePrice > 0) {
      this.setPrice(this.livePrice);
    }

    if (now - this.lastSampleAt >= SAMPLE_MS) {
      this.lastSampleAt = now;
      this.series.push({ t: now, p: this.price });
      this.trimSeries(now);
    }

    const past = this.priceAt(now - 1_500);
    const epsilon = Math.max(0.01, this.price * 2e-6);
    this.recentDir =
      this.price > past + epsilon ? 1 : this.price < past - epsilon ? -1 : 0;

    const rolled = this.maybeRollRound(now);
    this.recompute(now);
    this.pollTape(now);

    if (this.sheet === 'book') this.book = this.bookSim.snapshot(this.quote.pUp);

    if (rolled) this.emitSlow();
    else this.emitFast();
    if (this.fastQueued) this.emitFast();
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

  private trimSeries(now: number) {
    const cutoff = now - SERIES_WINDOW_MS;
    if (this.series.length > 64 && this.series[0].t < cutoff) {
      let i = 0;
      while (i < this.series.length && this.series[i].t < cutoff) i++;
      // Keep one point before the cutoff so the line still reaches the edge.
      if (i > 1) this.series.splice(0, i - 1);
    }
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
    this.settlePositions(settled);
    this.round = makeRound(now, this.roundMs, this.price);
    this.pruneComboDraft();
    this.queueSave();
    return true;
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
  private refundStale(positions?: Position[], combos?: ComboTicket[]) {
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
    if (refunded > 0) {
      this.toast = {
        id: this.toastSeq++,
        kind: 'info',
        title: 'Open picks refunded',
        detail: `$${refunded.toFixed(2)} returned — the round closed while you were away`,
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

  placeCombo(stake: number): { ok: boolean; error?: string } {
    const amount = Math.round(stake * 100) / 100;
    const entries = [...this.comboDraft.entries()].sort((a, b) => a[0] - b[0]);
    if (entries.length < 2) return { ok: false, error: 'Pick at least two rounds' };
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount' };
    if (Math.round(amount * 100) > this.balanceCents) {
      return { ok: false, error: 'Not enough balance' };
    }
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

  setMode(mode: FeedMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.series = [];
    this.lastSampleAt = 0;
    if (mode === 'live') {
      this.connectLive();
      this.feedStatus = 'connecting';
    } else {
      this.disconnectLive();
      this.feedStatus = 'idle';
      this.engine.reseed(Math.floor(Math.random() * 0xffffffff), this.price);
      this.seedSyntheticHistory();
    }
    // The strike belongs to the old series; re-anchor to the new feed.
    this.round = { ...this.round, strike: this.price };
    this.queueSave();
    this.emitSlow();
  }

  setRoundMs(roundMs: number) {
    if (roundMs === this.roundMs) return;
    this.roundMs = roundMs;
    const now = Date.now();
    const bounds = roundBounds(now, roundMs);
    this.round = makeRound(now, roundMs, this.priceAt(bounds.startsAt));
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

  setHaptics(on: boolean) {
    this.hapticsOn = on;
    this.queueSave();
    this.emitSlow();
  }

  setTimeframe(tf: Timeframe) {
    this.timeframe = tf;
    this.emitSlow();
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

  resetAccount() {
    this.balanceCents = STARTING_BALANCE_CENTS;
    this.positions = [];
    this.combos = [];
    this.history = [];
    this.comboDraft = new Map();
    clearState();
    this.queueSave();
    this.showToast({
      kind: 'info',
      title: 'Practice account reset',
      detail: 'Balance back to $1,000',
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
        this.livePrice = tick.p;
        if (this.mode === 'live' && this.series.length === 0) {
          this.setPrice(tick.p);
          this.round = { ...this.round, strike: tick.p };
        }
      },
      onStatus: (status, detail) => {
        this.feedStatus = status;
        this.feedDetail = detail ?? '';
        this.emitSlow();
      },
      onHistory: (ticks) => {
        if (this.mode !== 'live') return;
        // Only use the seed if we have not already built a live series.
        const existing = this.series;
        const merged = [...ticks, ...existing].sort((a, b) => a.t - b.t);
        this.series = merged;
        const bounds = roundBounds(Date.now(), this.roundMs);
        this.round = { ...this.round, strike: this.priceAt(bounds.startsAt) };
        this.emitSlow();
      },
    });
    this.feed.start();
  }

  private disconnectLive() {
    this.feed?.stop();
    this.feed = null;
    this.livePrice = 0;
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
        balanceCents: this.balanceCents,
        history: this.history,
        positions: this.positions.filter((p) => p.status === 'open'),
        combos: this.combos.filter((c) => c.status === 'open'),
        simPrice: this.mode === 'sim' ? this.price : 0,
        simSeed: 0,
        hapticsOn: this.hapticsOn,
      });
    }, 250);
  }
}

export const market = new MarketStore();
