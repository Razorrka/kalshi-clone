import type {
  ComboTicket,
  FeedMode,
  LimitOrder,
  Position,
  RoundResult,
} from '../engine/types';
import type { VolPreset } from '../engine/priceEngine';

const KEY = 'jitcoin:v1';

export interface PersistedState {
  mode: FeedMode;
  roundMs: number;
  volPreset: VolPreset;
  balanceCents: number;
  history: RoundResult[];
  positions: Position[];
  limitOrders: LimitOrder[];
  combos: ComboTicket[];
  simPrice: number;
  simSeed: number;
  hapticsOn: boolean;
}

export function loadState(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private browsing / quota — the sim still runs, it just will not resume.
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
