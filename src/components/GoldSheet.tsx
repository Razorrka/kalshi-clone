import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtMoney } from '../lib/format';
import {
  MAX_MULTIPLIER,
  MEASURED_EV,
  MIN_MULTIPLIER,
  VIG,
  evThresholdFor,
  isBreakEven,
} from '../engine/edge';

const pct = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

function describe(a: number): string {
  if (a <= 0.2) return 'Patient — only the far tail, where the price is least bad.';
  if (a <= 0.45) return 'Selective — the long shots, nothing near a coin flip.';
  if (a <= 0.75) return 'Loose — most of the payout window.';
  return 'Wide open — anything in the window, including the worst-priced bands.';
}

export function GoldSheet() {
  const store = useMarket(true);
  const gold = store.gold;
  const record = store.goldSummary;
  const threshold = evThresholdFor(store.goldAggression);
  const realised = record.staked > 0 ? record.returned / record.staked - 1 : null;

  return (
    <Sheet
      title="Edge hunter"
      subtitle={`Long shots from ${MIN_MULTIPLIER.toFixed(2)}x to ${MAX_MULTIPLIER}x, priced against the measurement`}
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
        The number beside the slider is the worst expected value it will accept.
        Every one of them is negative, and that is not a bug in the slider.
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
            A long shot's record is mostly noise until there are a few hundred of
            them. At {MEASURED_EV[2].pays.toFixed(0)}x you can lose twenty in a
            row at no fault of the pricing, so read this against the table below
            rather than as a verdict.
          </div>
        </>
      )}

      <div className="section-label">What every price is actually worth</div>
      <div className="gold-table">
        <div className="gold-row head">
          <span>Book</span>
          <span className="tnum">Pays</span>
          <span className="tnum">Won</span>
          <span className="tnum">Per $1</span>
        </div>
        {MEASURED_EV.map((b) => (
          <div className={`gold-row${isBreakEven(b) ? ' even' : ''}`} key={b.from}>
            <span>
              {(b.from * 100).toFixed(0)}–{(b.to * 100).toFixed(0)}%
            </span>
            <span className="tnum">{b.pays.toFixed(1)}x</span>
            <span className="tnum">{(b.rate * 100).toFixed(1)}%</span>
            <span className={`tnum ${isBreakEven(b) ? 'even-txt' : 'neg'}`}>
              {pct(b.ev)} <span className="ci">±{(b.ci * 100).toFixed(0)}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="section-label">Read this before you trust the gold</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Nothing here is profitable.</strong>{' '}
        That table is 120,000 bets — one per round, so no two share an outcome —
        and every band with a tight enough interval to judge is negative. The
        house takes {Math.round(VIG * 100)}% of winnings and the price process's
        fat tails only hand back enough to cancel that at the very far end.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>3x is the worst place to fish.</strong>{' '}
        The bands that pay 2x to 4x measure about −4% to −6% per dollar, the
        weakest on the board. The bands that pay 7x to 28x come in at roughly
        break-even, because jumps and moving volatility put more weight in the
        tail than the N(d2) quote models. If you want the least-bad long shot,
        it is further out than 3x, not at it.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Read the interval, not the number.</strong>{' '}
        The 2–5% band shows {pct(MEASURED_EV[0].ev)} and means nothing: at{' '}
        {MEASURED_EV[0].pays.toFixed(0)}x a handful of extra wins moves the
        estimate ten points, which is why its interval is ±{(MEASURED_EV[0].ci * 100).toFixed(0)}.
        Bands marked even are the ones the measurement genuinely cannot separate
        from break-even.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>A fitted curve was tried and thrown out.</strong>{' '}
        Recalibrating the quote in log-odds is the textbook move, and against
        fresh seeds it scored 661.73 on Brier loss against the raw quote's
        661.70 — no better. So the fair price here is the raw measurement, not a
        curve through it, and the quote it is correcting turns out to be good.
      </div>
      <div className="note">
        Stakes are quarter-Kelly where Kelly is positive and a 1% token where it
        is not, which is every price on this board. None of this transfers to a
        real market: the edge measured here is a property of this simulator's
        pricing, not of Bitcoin.
      </div>
    </Sheet>
  );
}
