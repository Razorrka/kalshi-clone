import type {
  ComboTicket,
  FeedMode,
  LimitOrder,
  Position,
  RoundResult,
  StrikeMode,
} from '../engine/types';
import type { VolPreset } from '../engine/priceEngine';
import type { CallModel, LockedCall } from '../engine/caller';

const KEY = 'jitcoin:v1';

export interface PersistedState {
  mode: FeedMode;
  roundMs: number;
  volPreset: VolPreset;
  strikeMode: StrikeMode;
  manualStrike: number;
  balanceCents: number;
  startingBalanceCents: number;
  history: RoundResult[];
  positions: Position[];
  limitOrders: LimitOrder[];
  combos: ComboTicket[];
  simPrice: number;
  simSeed: number;
  hapticsOn: boolean;
  signalsOn: boolean;
  signalKey: number;
  calls: LockedCall[];
  callModel: CallModel;
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
