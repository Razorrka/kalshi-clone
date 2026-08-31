import type { FeedStatus, Tick } from './types';

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const REST_BASE = 'https://api.exchange.coinbase.com';
const PRODUCT = 'BTC-USD';

export interface LiveFeedHandlers {
  onTick: (tick: Tick) => void;
  onStatus: (status: FeedStatus, detail?: string) => void;
  /** Historical seed so the chart is not empty on connect. */
  onHistory: (ticks: Tick[]) => void;
}

/**
 * Real BTC-USD from Coinbase's public market data. No key, no account.
 *
 * Websocket ticker is the primary source; if it will not open (corporate
 * proxy, offline, region block) we fall back to polling the REST ticker,
 * and only report `error` when both are unavailable.
 */
export class LiveFeed {
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private lastMessageAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(private handlers: LiveFeedHandlers) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.handlers.onStatus('connecting');
    void this.seedHistory();
    this.openSocket();
    this.watchdog = setInterval(() => this.checkStale(), 5_000);
  }

  stop() {
    this.stopped = true;
    this.closeSocket();
    this.stopPolling();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.reconnectTimer = null;
    this.watchdog = null;
    this.handlers.onStatus('idle');
  }

  /** One minute candles for the last few hours, so the wider views have shape. */
  private async seedHistory() {
    try {
      const res = await fetch(
        `${REST_BASE}/products/${PRODUCT}/candles?granularity=60`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error(`history ${res.status}`);
      const rows = (await res.json()) as number[][];
      if (!Array.isArray(rows) || rows.length === 0) return;
      // [ time, low, high, open, close, volume ], newest first.
      const ticks = rows
        .slice(0, 190)
        .map((r) => ({ t: r[0] * 1000, p: r[4] }))
        .filter((t) => Number.isFinite(t.t) && Number.isFinite(t.p))
        .sort((a, b) => a.t - b.t);
      if (ticks.length) this.handlers.onHistory(ticks);
    } catch {
      // Seeding is best effort — a live-only chart still works.
    }
  }

  private openSocket() {
    if (this.stopped) return;
    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        this.attempt = 0;
        this.lastMessageAt = Date.now();
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: [PRODUCT],
            channels: ['ticker'],
          }),
        );
      };

      ws.onmessage = (event) => {
        this.lastMessageAt = Date.now();
        let msg: { type?: string; price?: string; time?: string };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type === 'subscriptions') {
          this.stopPolling();
          this.handlers.onStatus('live');
          return;
        }
        if (msg.type !== 'ticker' || !msg.price) return;
        const p = Number(msg.price);
        if (!Number.isFinite(p)) return;
        const t = msg.time ? Date.parse(msg.time) : Date.now();
        this.handlers.onTick({ t: Number.isFinite(t) ? t : Date.now(), p });
      };

      ws.onerror = () => {
        // onclose always follows; recovery is handled there.
      };

      ws.onclose = () => {
        this.ws = null;
        if (this.stopped) return;
        this.scheduleReconnect();
      };
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : undefined);
    }
  }

  private closeSocket() {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  }

  /** Coinbase goes quiet on a dead connection rather than closing it. */
  private checkStale() {
    if (this.stopped || !this.ws) return;
    if (Date.now() - this.lastMessageAt > 20_000) {
      this.closeSocket();
      this.scheduleReconnect('feed went quiet');
    }
  }

  private scheduleReconnect(detail?: string) {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    // Once the socket has failed twice, keep prices flowing over REST while
    // we keep trying to get the stream back.
    if (this.attempt >= 2) {
      this.startPolling();
      this.handlers.onStatus('reconnecting', detail);
    } else {
      this.handlers.onStatus('connecting', detail);
    }
    const delay = Math.min(1_000 * 2 ** (this.attempt - 1), 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private startPolling() {
    if (this.pollTimer) return;
    const poll = async () => {
      try {
        const res = await fetch(`${REST_BASE}/products/${PRODUCT}/ticker`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`ticker ${res.status}`);
        const body = (await res.json()) as { price?: string };
        const p = Number(body.price);
        if (Number.isFinite(p)) {
          this.handlers.onTick({ t: Date.now(), p });
          this.handlers.onStatus('reconnecting', 'polling');
        }
      } catch (err) {
        this.handlers.onStatus(
          'error',
          err instanceof Error ? err.message : 'no connection',
        );
      }
    };
    void poll();
    this.pollTimer = setInterval(poll, 2_000);
  }

  private stopPolling() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
