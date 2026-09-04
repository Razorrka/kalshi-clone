import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { FLIP_HORIZON_MS, MEASURED_AUC, touchProbability } from '../engine/flip';

const NAMES: Record<string, string> = {
  velocity: 'Price velocity',
  acceleration: 'Price acceleration',
  roc: 'Short-term ROC',
  volumeAccel: 'Volume acceleration',
  tradeImbalance: 'Buy/sell imbalance',
  bookImbalance: 'Order-book imbalance',
  spread: 'Bid/ask spread',
  depth: 'Market depth',
  liquidityPull: 'Liquidity withdrawal',
  largeOrders: 'Large order activity',
  volatility: 'Volatility',
  momentumDivergence: 'Momentum divergence',
  failedBreak: 'Failed breakout/breakdown',
  rejection: 'Price rejection',
  regimeShift: 'Regime change',
  trajectory: 'Recent price trajectory',
};

/** How much a single input is worth, in words, from its measured score. */
function worth(auc: number): { text: string; tone: string } {
  const edge = Math.abs(auc - 0.5);
  if (edge > 0.1) return { text: 'carries real signal', tone: 'good' };
  if (edge > 0.03) return { text: 'marginal', tone: 'mid' };
  return { text: 'no signal here', tone: 'dead' };
}

export function FlipSheet() {
  const store = useMarket(true);
  const flip = store.flip;
  const seconds = Math.round(FLIP_HORIZON_MS / 1_000);

  if (!flip) {
    return (
      <Sheet title="Flip detection" onClose={() => store.closeSheet()}>
        <div className="note">Not enough tape yet. Give it a few seconds.</div>
      </Sheet>
    );
  }

  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const ranked = flip.contributions;

  return (
    <Sheet
      title="Flip detection"
      subtitle={`Chance the favoured side changes within ${seconds}s`}
      onClose={() => store.closeSheet()}
    >
      <div className={`flip-headline ${flip.probability >= 0.6 ? 'hot' : ''}`}>
        <div className="flip-headline-dir">{flip.direction}</div>
        <div className="flip-headline-row">
          <div>
            <div className="k">Probability</div>
            <div className="v tnum">{pct(flip.probability)}</div>
          </div>
          <div>
            <div className="k">Confidence</div>
            <div className="v">{flip.confidence}</div>
          </div>
          <div>
            <div className="k">Strength</div>
            <div className="v tnum">{flip.strength.toFixed(1)}/10</div>
          </div>
        </div>
      </div>

      {flip.reasons.length > 0 ? (
        <>
          <div className="section-label">Reasons</div>
          <ul className="flip-reasons">
            {flip.reasons.map((r) => (
              <li key={r.key} className={r.backed ? 'backed' : ''}>
                {r.text}
                {!r.backed && <span className="unbacked"> · not shown to predict</span>}
              </li>
            ))}
          </ul>
          <div className="note">
            Every line is a true description of what the tape is doing. Only the
            marked ones come from an input that measurably predicts a flip; the
            rest are conditions worth seeing, not evidence.
          </div>
        </>
      ) : (
        <div className="note">
          Nothing is arguing for a flip right now beyond the distance to the
          target itself.
        </div>
      )}

      <div className="section-label">Where the number comes from</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>
          The geometry first: {pct(flip.baseline)}.
        </strong>{' '}
        Price is <span className="tnum">{flip.features.horizonGap.toFixed(2)}</span>{' '}
        standard deviations of the next {seconds} seconds clear of the target. For a
        walk with no memory the chance of touching a level that far off is exactly
        2 × N(−z) — the reflection principle, not a fitted curve. Every path that
        touches and finishes above pairs with one that touches and finishes below,
        so touching is twice finishing beyond. That is the {pct(flip.baseline)}, and
        it is the honest core of this screen.
      </div>
      <div className="note">
        The sixteen inputs then argue at the margin, moving it to{' '}
        <span className="tnum">{pct(flip.probability)}</span>. They are normalised
        against their own history <em>at this distance from the target</em>, so an
        input cannot smuggle the gap back in and have it counted twice.
      </div>

      <div className="section-label">The sixteen inputs</div>
      <div className="flip-table">
        {ranked.map((part) => {
          const w = worth(MEASURED_AUC[part.key] ?? 0.5);
          return (
            <div className="flip-row" key={part.key}>
              <span className="flip-row-name">{NAMES[part.key] ?? part.key}</span>
              <span className="flip-row-z tnum">
                {part.value >= 0 ? '+' : ''}
                {part.value.toFixed(2)}σ
              </span>
              <span className={`flip-row-worth ${w.tone}`}>{w.text}</span>
            </div>
          );
        })}
      </div>

      <div className="section-label">What these are actually worth</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Measured, not asserted.</strong> Each
        input was scored over 72,540 samples from 260 simulated rounds, on whether it
        predicts a flip inside the next minute once the gap is conditioned out. Two
        of them carry real information — <em>failed breakout</em> at 0.68 and{' '}
        <em>price rejection</em> at 0.68, where 0.50 is a coin flip. Both describe
        the path: a target already tested and not held is genuinely more likely to be
        tested again.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>The book tells you nothing here.</strong>{' '}
        Order-book imbalance, spread, depth, buy/sell imbalance and large orders all
        look predictive raw — spread scores 0.69 — but in this simulator they are
        generated <em>from</em> the price rather than causing it. Condition on the gap
        and every one collapses to a coin flip. That is why they are weighted near
        zero: on real Bitcoin an order book can lead price, but a book computed from
        the price it is supposed to predict never can, and pretending otherwise would
        make this screen a very convincing liar.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Weights were fitted, then cut.</strong>{' '}
        A logistic regression over those samples, with the geometry as a fixed offset
        so the inputs could only earn weight for what it does not already say. At full
        strength they scored 0.893 against the geometry's own 0.918 — worse. Shrinking
        them found the peak at a tenth: 0.9181 against 0.9178. They ship at a tenth,
        which is the honest size of them. The pattern match is drawing on{' '}
        <span className="tnum">{store.flipMemorySize}</span> resolved setups.
      </div>
      <div className="note">
        A flip warning is not a trade. At one standard deviation clear the chance of
        being touched is already {pct(touchProbability(1))} — being "comfortably
        ahead" in a 15-minute market mostly means the market has not got round to you
        yet.
      </div>
    </Sheet>
  );
}
