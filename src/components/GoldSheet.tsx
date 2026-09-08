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
  if (a <= 0.2) return 'Patient — the long end of the window, where the board is least wrong.';
  if (a <= 0.45) return 'Selective — that, plus the better of the middle.';
  if (a <= 0.75) return 'Loose — most of the window, mostly two to four times.';
  return 'Wide open — anything in the window, the worst-priced rungs included.';
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
      subtitle={`Flips and reversals from ${MIN_MULTIPLIER.toFixed(2)}x to ${MAX_MULTIPLIER.toFixed(0)}x, priced against the measurement`}
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
        <strong style={{ color: 'var(--muted)' }}>How often it lights, and on
        what.</strong>{' '}
        Watched second by second over 500 rounds: 2.9% of the time at the
        patient end, 16.5% a quarter up, 37.9% halfway, 54.0% where it starts,
        71.3% wide open. The slider is spaced by that measurement rather than
        drawn as a straight line, because almost every price in this window
        sits between −4.5% and −6.5% — a bar moving in equal steps does nothing
        across most of its travel and then everything at the end.
      </div>
      <div className="note">
        And it fires on the payouts you came for. At the setting it starts on,
        the median ticket it picks pays <span className="tnum">2.4x</span>, and{' '}
        <span className="tnum">66%</span> of its picks land between 2x and
        4.5x. Turn the slider down and it holds out for the long end of the
        window instead — a median of 6.5x — because that is where the board's
        error is largest.
      </div>
      <div className="note">
        The number beside the slider is the worst expected value it will
        accept. It is negative all the way along, because every price in this
        window is — what the slider buys is how close to the best of a bad set
        you insist on. At the patient end it holds out for the long end of the
        window and fires rarely; turning it up buys signals by accepting worse
        prices, and hands you the two-to-four-times tickets more often.
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
        {curve.map((row) => {
          // Lit when the slider would take it, not when it happens to be
          // profitable. Those are different questions, and the table used to
          // answer the second one while the strip acted on the first — so it
          // showed a single gold row at 90x however far the slider was pushed,
          // and said nothing about the rest of the board you were actually
          // buying. Push the slider up and the ladder lights up with it.
          const taken = row.ev >= threshold;
          const profitable = row.ev > 0;
          const cls = profitable ? ' even' : taken ? ' taken' : '';
          return (
            <div className={`gold-row${cls}`} key={row.quoted}>
              <span className="tnum">{(row.quoted * 100).toFixed(0)}%</span>
              <span className="tnum">{row.multiplier.toFixed(1)}x</span>
              <span className="tnum">{(row.fair * 100).toFixed(2)}%</span>
              <span className={`tnum ${profitable ? 'even-txt' : 'neg'}`}>
                {pct(row.ev)} <span className="ci">±{(row.evCi * 100).toFixed(1)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="note">
        "Really" is the rate that price actually lands at, measured. The gap is
        the whole edge, and it closes as the round runs — which is why this
        table is drawn for the clock as it stands rather than once for all
        time. A <span style={{ color: 'var(--gold)' }}>gold</span> row makes
        money. An outlined row is one your slider will take anyway — the light
        comes on for it, and the number beside it says what it costs.
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
        <strong style={{ color: 'var(--muted)' }}>What this window is for.</strong>{' '}
        Flips and reversals, which pay two to four times. An earlier version
        opened the window all the way to the multiplier clamp because that is
        where the measurement says expected value finally beats the vig — and
        what it then found were ninety-to-one lottery tickets. Those are a
        different bet. The window tops out at{' '}
        {MAX_MULTIPLIER.toFixed(0)}x whatever the tail is worth, and inside it
        the job is to find the best-priced moment rather than to refuse to
        play.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Most of it loses, and here is
        where it does not.</strong>{' '}
        The house takes {Math.round(VIG * 100)}% of winnings, and on an
        ordinary tape every price in this window is behind that
        — the best of them about −1% and the worst about −6%. The exception is
        the corner you are probably hunting anyway: a tape that has gone quiet
        near the target with seconds to run. The best price in the window
        measures <span className="tnum">+25.5%</span> with 15 seconds left on a
        calm tape and <span className="tnum">+3.2%</span> with a minute, against{' '}
        <span className="tnum">−1.1%</span> and <span className="tnum">−4.2%</span>{' '}
        at ordinary volatility. When the tape stops moving the board keeps
        pricing off a volatility that is not what happens next.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Checked end to end, in this
        window.</strong>{' '}
        Not "the model predicts better" — the tickets the light actually picks,
        settled. Over 700,000 rounds with one bet each, taken at the first
        moment the hunter fired, the patient setting returned{' '}
        <span className="tnum">−4.85% ± 0.70</span> per dollar across 626,759
        bets, against the −4.66% it predicted before the run. Wide open:{' '}
        <span className="tnum">−5.37% ± 0.22</span>. The model is honest about
        what it is picking; what it is picking still loses.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>That is the price of this
        window.</strong>{' '}
        Opened to the multiplier clamp instead, the same hunter measured{' '}
        <span className="tnum">+2.10% ± 0.97</span> over 2.8 million rounds —
        genuinely profitable, and entirely on ninety-to-one tickets that win
        about once in fifty. Trading two-to-four-times reversals costs roughly
        five percent a ticket against that. Both numbers are real; which one
        you want is a choice about what you came here to do, and the slider
        does not change it.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>3x is the worst rung on this
        ladder.</strong>{' '}
        The mispricing grows the further into the tail you go, and the vig is a
        flat cut of winnings, so the two do not cross until well past this
        window. That leaves its middle — right where 3x sits — as the weakest
        price on it. The long end of the window is consistently the best of a
        bad set, which is why the light picks it when you are being picky.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What the grade means.</strong>{' '}
        Not "this wins" — almost nothing here does. PRIME means this moment is
        in roughly the best quarter of the moments the light comes on for, THIN
        that it is in the worst half. The number beside it is the real expected
        value with its real sign, and PRIME is the only grade that pulses.
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
