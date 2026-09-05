import { useState } from 'react';
import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { RULES, backtest, type StrategyResult } from '../engine/backtest';

const SIZES = [
  { rounds: 1_000, label: '1k' },
  { rounds: 5_000, label: '5k' },
  { rounds: 20_000, label: '20k' },
];

const pct = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

/** Does the interval clear zero, or is this just a run of luck? */
function verdictOf(r: StrategyResult): { text: string; tone: string } {
  if (r.bets < 40) return { text: 'too few bets to say', tone: 'dead' };
  if (r.ev - r.ci > 0) return { text: 'genuinely ahead', tone: 'good' };
  if (r.ev + r.ci < 0) return { text: 'genuinely behind', tone: 'bad' };
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
  const [results, setResults] = useState<StrategyResult[] | null>(null);

  const run = () => {
    setRunning(true);
    // Yield once so the button can paint its running state before the work.
    setTimeout(() => {
      setResults(RULES.map((r) => backtest(r.rule, r.name, rounds, 991)));
      setRunning(false);
    }, 30);
  };

  const control = results?.find((r) => r.name.startsWith('Coin flip'));

  return (
    <Sheet
      title="Proving ground"
      subtitle="Run a rule over thousands of rounds and see what it really did"
      onClose={() => store.closeSheet()}
      footer={
        <button className="primary-btn" disabled={running} onClick={run}>
          {running ? 'Running…' : `Test every rule over ${rounds.toLocaleString()} rounds`}
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
        RSI extremes measured <span className="tnum">+12.7%</span> over 3,000
        rounds, which reads like a discovery. Its interval was ±62 points. Run
        the same rule over 40,000 rounds and it comes back at{' '}
        <span className="tnum">−0.2%</span>. Nothing about the rule changed —
        only the sample. Bollinger reversion did the same thing: +2.8% became
        −1.5%.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Why rare rules lie loudest.</strong>{' '}
        A rule that only fires on 30x long shots gets a handful of wins, and a
        handful of wins moves its return by tens of points. That is why the
        selective-looking rules always look the most promising and are the
        least trustworthy. Fewer signals is not the same as better signals.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What would a real edge look like?</strong>{' '}
        A return whose whole interval sits above zero, holding on rounds it was
        never tuned against. Nothing here has ever produced one, and on a
        process with no memory nothing should — the price the market quotes is
        already the best available answer, and the house takes 10% on top.
      </div>
    </Sheet>
  );
}
