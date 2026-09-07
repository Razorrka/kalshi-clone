import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtMoney } from '../lib/format';
import {
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  VIG,
  evCurve,
  evThresholdFor,
} from '../engine/edge';
import { CAL_SECONDS, volInflation } from '../engine/calibration';

const pct = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

function describe(a: number): string {
  if (a <= 0.2) return 'Patient — only what the measurement says actually makes money.';
  if (a <= 0.45) return 'Selective — that, plus prices a shade behind the vig.';
  if (a <= 0.75) return 'Loose — most of the payout window, most of it negative.';
  return 'Wide open — anything in the window, the worst-priced parts included.';
}

const clock = (s: number) => (s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`);

export function GoldSheet() {
  const store = useMarket(true);
  const gold = store.gold;
  const record = store.goldSummary;
  const threshold = evThresholdFor(store.goldAggression);
  const curve = evCurve(store.secondsLeft, store.volRatio);
  const realised = record.staked > 0 ? record.returned / record.staked - 1 : null;

  return (
    <Sheet
      title="Edge hunter"
      subtitle={`Long shots from ${MIN_MULTIPLIER.toFixed(2)}x to ${MAX_MULTIPLIER.toFixed(1)}x, priced against the measurement`}
      onClose={() => store.closeSheet()}
    >
      {gold ? (
        <div className={`gold-card ${gold.grade.toLowerCase()}`}>
          <div className="gold-card-top">
            <span className={`gold-side ${gold.side === 'up' ? 'yes' : 'no'}`}>
              {gold.side === 'up' ? 'UP' : 'DOWN'}
            </span>
            <span className="gold-card-mult tnum">{gold.multiplier.toFixed(2)}x</span>
            <span className={`gold-grade ${gold.grade.toLowerCase()}`}>{gold.grade}</span>
          </div>
          <div className="gold-card-row">
            <div>
              <div className="k">Book says</div>
              <div className="v tnum">{(gold.quoted * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="k">Measured</div>
              <div className="v tnum">{(gold.fair * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="k">Edge</div>
              <div className={`v tnum ${gold.ev >= 0 ? 'pos' : 'neg'}`}>{pct(gold.ev)}</div>
            </div>
            <div>
              <div className="k">Stake</div>
              <div className="v tnum">{fmtMoney(gold.stake)}</div>
            </div>
          </div>
          <div className="gold-card-note">{gold.note}</div>
        </div>
      ) : (
        <div className="note">
          Nothing on the board is priced well enough for the current setting.
          That is the normal state, not a fault.
        </div>
      )}

      <div className="section-label">How picky</div>
      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Aggressiveness</div>
            <div className="d">{describe(store.goldAggression)}</div>
          </div>
          <div className="limit-stepper">
            <span className="tnum">{pct(threshold)}</span>
          </div>
        </div>
        <input
          className="limit-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={store.goldAggression}
          aria-label="Edge hunter aggressiveness"
          onChange={(e) => store.setGoldAggression(Number(e.target.value))}
        />
        <div className="slider-ends">
          <span>patient · rare</span>
          <span>wide open · constant</span>
        </div>
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>How often it lights.</strong>{' '}
        Watched second by second over 600 rounds: 1.6% of the time at the
        patient end, 5.8% a quarter up, 20.6% halfway, 53.9% at three
        quarters, 87.3% wide open. The slider is spaced by that measurement
        rather than drawn as a straight line, because almost every price on
        this board sits between −4.5% and −6.5% — a bar moving in equal steps
        does nothing across most of its travel and then everything at the end.
        The patient setting spends 6.3% of the final minute lit against 1.6% of
        a round overall, four times as often, because that is where the board
        is wrong. Wide open runs the other way, 33.5% late against 87.3%
        overall, because what it takes is near coin flips and those are
        everywhere.
      </div>
      <div className="note">
        The number beside the slider is the worst expected value it will
        accept. At the patient end it is positive, so the light only comes on
        for prices the measurement says actually make money — which is a rare
        state, mostly late in a round. Turning it up buys signals by accepting
        worse prices.
      </div>

      <div className="section-label">Its actual record</div>
      {record.n === 0 ? (
        <div className="note">
          No gold picks have settled yet. Take one while the button is lit and it
          gets scored here — what the hunter really did, not what it claimed.
        </div>
      ) : (
        <>
          <div className="book-stats">
            <div className="stat">
              <div className="k">Picks</div>
              <div className="v tnum">{record.n}</div>
              <div className="s">settled</div>
            </div>
            <div className="stat">
              <div className="k">Hit</div>
              <div className="v tnum">{Math.round((record.won / record.n) * 100)}%</div>
              <div className="s">{record.won} won</div>
            </div>
            <div className="stat">
              <div className="k">Return</div>
              <div className={`v tnum ${(realised ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                {realised === null ? '—' : pct(realised)}
              </div>
              <div className="s">per $1</div>
            </div>
          </div>
          <div className="note">
            A long shot's record is mostly noise until there are a few hundred
            of them. At 20x you can lose twenty in a row with nothing wrong with
            the pricing, so read this against the tables below rather than as a
            verdict.
          </div>
        </>
      )}

      <div className="section-label">
        What every price is worth right now · {clock(store.secondsLeft)} left
      </div>
      <div className="gold-table">
        <div className="gold-row head">
          <span>Book</span>
          <span className="tnum">Pays</span>
          <span className="tnum">Really</span>
          <span className="tnum">Per $1</span>
        </div>
        {curve.map((row) => (
          <div className={`gold-row${row.ev > 0 ? ' even' : ''}`} key={row.quoted}>
            <span className="tnum">{(row.quoted * 100).toFixed(0)}%</span>
            <span className="tnum">{row.multiplier.toFixed(1)}x</span>
            <span className="tnum">{(row.fair * 100).toFixed(2)}%</span>
            <span className={`tnum ${row.ev > 0 ? 'even-txt' : 'neg'}`}>
              {pct(row.ev)} <span className="ci">±{(row.evCi * 100).toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="note">
        "Really" is the rate that price actually lands at, measured. The gap is
        the whole edge, and it closes as the round runs — which is why this
        table is drawn for the clock as it stands rather than once for all time.
      </div>

      <div className="section-label">How wrong the board is, by the clock</div>
      <div className="gold-table">
        <div className="gold-row head">
          <span>Left</span>
          <span className="tnum">Calm tape</span>
          <span className="tnum">Normal</span>
          <span className="tnum">Wild</span>
        </div>
        {CAL_SECONDS.map((sec) => (
          <div className="gold-row" key={sec}>
            <span className="tnum">{clock(sec)}</span>
            <span className="tnum">{volInflation(sec, 0.35).toFixed(3)}x</span>
            <span className="tnum">{volInflation(sec, 1).toFixed(3)}x</span>
            <span className="tnum">{volInflation(sec, 2.5).toFixed(3)}x</span>
          </div>
        ))}
      </div>
      <div className="note">
        The board prices every ticket as if the tape's volatility were exactly
        what it is now and stayed there. The real spread of outcomes is this
        much wider. It is worst with seconds left on a calm tape — a
        microstructure bounce is a fixed fraction of a basis point whatever the
        volatility, so it is a large share of a small move — and it fades to
        almost nothing over a whole round.
      </div>

      <div className="section-label">Read this before you trust the gold</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What the ± covers.</strong>{' '}
        Both the noise in the measurement and the fact that one number per
        cell cannot fit twenty-one measured prices exactly. Over all 1,176
        cells the model sits 0.69 points of expected value from the measured
        rate on average and 1.63 at worst, and no interval here is quoted
        narrower than that — with billions of samples behind it the
        measurement's own error alone would print ±0.1 beside an edge of +85%,
        which would be a precision this does not have.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>It was checked end to end.</strong>{' '}
        Not "the model predicts better" — the tickets the light actually picks,
        settled. Over 2,800,000 rounds with one bet each, taken at the first
        moment the hunter fired, the patient setting returned{' '}
        <span className="tnum">+2.10% ± 0.97</span> per dollar across 2.56
        million bets, against the +1.20% it predicted before the run. Halfway
        up the slider: −0.84% ± 0.59. Wide open: −5.18% ± 0.11. The slider does
        what it says, and the model is conservative rather than flattering.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>The edge is real and it is small.</strong>{' '}
        The board's price is wrong in a measurable direction, but the house
        takes {Math.round(VIG * 100)}% of winnings and that swallows the error
        over most of the board. What survives is a narrow window, mostly in the
        closing stretch of a round, and the strip shows its expected value with
        the sign either way.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>3x is still a bad place to fish.</strong>{' '}
        The mispricing grows the further into the tail you go, but the vig is a
        flat cut of winnings, so the two only cross well past 3x. The table
        above marks where they cross for the clock as it stands — and that
        point moves toward you as the round runs out.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Never below a 1% quote.</strong>{' '}
        The board's multiplier clamps at 1%, so a side quoted at 0.4% pays what
        a 1% side pays and lands less than half as often. Everything under the
        clamp is strictly worse than the clamp, and the hunter will not take it.
        The proving ground has that rule on its list if you want to watch it
        lose.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>An older version of this was
        incoherent.</strong>{' '}
        It corrected each price with its own measured offset, which put Up at
        30% and Down at 70% together at 101.16% — not a pair of probabilities.
        The correction is now a single volatility multiplier, so the two sides
        of a market always sum to exactly one.
      </div>
      <div className="note">
        Stakes are quarter-Kelly where Kelly is positive and a 1% token where it
        is not. None of this transfers to a real exchange: the edge measured
        here is a property of how this simulator prices its own tape, not of
        Bitcoin.
      </div>
    </Sheet>
  );
}
