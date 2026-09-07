import { useEffect, useRef, useState } from 'react';
import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { RULES, type StrategyResult } from '../engine/backtest';
import type { BacktestRequest, BacktestResponse } from '../engine/backtestWorker';

const SIZES = [
  { rounds: 1_000, label: '1k' },
  { rounds: 5_000, label: '5k' },
  { rounds: 20_000, label: '20k' },
];

const pct = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

/** Does the interval clear zero, or is this just a run of luck? */
function verdictOf(r: StrategyResult): { text: string; tone: string } {
  if (r.bets < 40) return { text: 'too few bets to say', tone: 'dead' };
  if (r.evLow > 0) return { text: 'genuinely ahead', tone: 'good' };
  if (r.evHigh < 0) return { text: 'genuinely behind', tone: 'bad' };
  return { text: 'indistinguishable from luck', tone: 'dead' };
}

/**
 * The proving ground: run any rule over thousands of independent rounds and
 * read what it actually did.
 *
 * It exists so that "this indicator makes it more accurate" stops being an
 * argument and becomes a number with an interval on it.
 */
export function ProvingSheet() {
  const store = useMarket();
  const [rounds, setRounds] = useState(5_000);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<StrategyResult[] | null>(null);
  const worker = useRef<Worker | null>(null);

  // The tape runs at the app's own 60ms tick, so 20,000 rounds is 300 million
  // steps. That belongs on another thread.
  useEffect(() => {
    const w = new Worker(new URL('../engine/backtestWorker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent<BacktestResponse>) => {
      const msg = e.data;
      if (msg.kind === 'progress') setProgress(msg.done / msg.total);
      else if (msg.kind === 'done') {
        setResults(msg.results);
        setRunning(false);
      } else {
        setRunning(false);
      }
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  const run = () => {
    if (!worker.current) return;
    setRunning(true);
    setProgress(0);
    const req: BacktestRequest = { rounds, seedBase: 991 };
    worker.current.postMessage(req);
  };

  const control = results?.find((r) => r.name.startsWith('Coin flip'));

  return (
    <Sheet
      title="Proving ground"
      subtitle="Run a rule over thousands of rounds and see what it really did"
      onClose={() => store.closeSheet()}
      footer={
        <button className="primary-btn" disabled={running} onClick={run}>
          {running
            ? `Running… ${Math.round(progress * 100)}%`
            : `Test every rule over ${rounds.toLocaleString()} rounds`}
        </button>
      }
    >
      <div className="proving-sizes">
        {SIZES.map((s) => (
          <button
            key={s.rounds}
            className={`chip${rounds === s.rounds ? ' active' : ''}`}
            onClick={() => setRounds(s.rounds)}
          >
            {s.label} rounds
          </button>
        ))}
      </div>
      <div className="note">
        One bet per round at most, so no two results share an outcome. Run the
        same rule at 1k and again at 20k — that is the entire lesson, and it is
        cheaper to see than to argue about.
      </div>

      {results ? (
        <>
          <div className="section-label">Results</div>
          {results.map((r, i) => {
            const v = verdictOf(r);
            const rule = RULES[i];
            return (
              <div className="proving-row" key={r.name}>
                <div className="proving-head">
                  <span className="proving-name">{r.name}</span>
                  <span className={`proving-verdict ${v.tone}`}>{v.text}</span>
                </div>
                <div className="proving-nums">
                  <span>
                    <b className="tnum">{r.bets.toLocaleString()}</b> bets
                  </span>
                  <span>
                    win <b className="tnum">{(r.winRate * 100).toFixed(1)}%</b>
                  </span>
                  <span>
                    pays <b className="tnum">{r.averagePayout.toFixed(2)}x</b>
                  </span>
                  <span className={r.ev >= 0 ? 'pos' : 'neg'}>
                    <b className="tnum">{pct(r.ev)}</b>
                    <span className="ci"> ±{(r.ci * 100).toFixed(1)}</span>
                  </span>
                </div>
                <div className="proving-blurb">{rule?.blurb}</div>
              </div>
            );
          })}
          {control && (
            <div className="note">
              The control backed a side at random and returned{' '}
              <span className="tnum">{pct(control.ev)}</span> ±
              {(control.ci * 100).toFixed(1)}. Any rule whose interval overlaps
              that one has not beaten a coin flip, whatever its win rate says.
            </div>
          )}
        </>
      ) : (
        <div className="note">
          Nothing run yet. Press the button.
        </div>
      )}

      <div className="section-label">How to read it</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>The win rate is the trap.</strong>{' '}
        Backing the favourite every time wins about three times in four and
        still loses money, because it pays 1.34x. Multi-timeframe agreement
        does the same thing — a 76% win rate and a negative return. A win rate
        can be set to almost anything by choosing which odds you take, so it
        tells you nothing on its own.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>The interval is the whole answer.</strong>{' '}
        The edge hunter reads <span className="tnum">−73.6%</span> over 2,000
        rounds and <span className="tnum">+13.4%</span> over 20,000. Same rule,
        same code — and neither number means anything, because the intervals
        run from −125 to +571 and from −90 to +303. Multi-timeframe agreement
        goes <span className="tnum">−15.8% ±5.7</span> to{' '}
        <span className="tnum">−9.5% ±2.6</span>; MACD does the same. Watch the
        ± column, not the return.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Why rare rules lie loudest.</strong>{' '}
        A rule that only fires on 60x long shots gets a handful of wins, and a
        handful of wins moves its return by tens of points. That is why the
        selective-looking rules always look the most promising and are the
        least trustworthy. Fewer signals is not the same as better signals.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What this tool cannot settle.</strong>{' '}
        Twenty thousand rounds gives the hunter about 700 bets at 50x, which
        cannot tell +13% from −50%. Run away from here it was measured over
        700,000 rounds, sampled at the moments it actually fires, and came in
        at <span className="tnum">+2.27% ± 1.94</span> against a prediction of
        +1.20% made before the run — the one rule on this list whose interval
        clears zero. This screen is honest about not being able to show you
        that; a tool that could would be lying about something else.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What it settles easily.</strong>{' '}
        Long shots priced under 1% come in at{' '}
        <span className="tnum">−84.6% ±8.9</span> — no ambiguity at all,
        because the board's multiplier stops improving below 1% while the odds
        keep getting worse. A rule that is genuinely terrible needs far less
        evidence than one that is slightly good.
      </div>
    </Sheet>
  );
}
