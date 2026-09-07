/**
 * The proving ground, off the main thread.
 *
 * Running the tape at the app's real 60ms tick is what makes these numbers
 * mean anything, and it is also what makes them slow: twenty thousand rounds
 * is three hundred million steps. On the main thread that is a frozen tab, so
 * it runs here and reports progress on the way.
 */
import { RULES, backtestAll, type StrategyResult } from './backtest';

export interface BacktestRequest {
  rounds: number;
  seedBase: number;
}

export type BacktestResponse =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'done'; results: StrategyResult[] }
  | { kind: 'error'; message: string };

self.onmessage = (e: MessageEvent<BacktestRequest>) => {
  const { rounds, seedBase } = e.data;
  try {
    const results = backtestAll(
      RULES.map((r) => ({ name: r.name, rule: r.rule })),
      rounds,
      seedBase,
      (done, total) => {
        const msg: BacktestResponse = { kind: 'progress', done, total };
        self.postMessage(msg);
      },
    );
    const msg: BacktestResponse = { kind: 'done', results };
    self.postMessage(msg);
  } catch (err) {
    const msg: BacktestResponse = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
