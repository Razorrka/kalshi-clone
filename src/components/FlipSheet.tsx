import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { FLIP_HORIZON_MS, MEASURED_AUC } from '../engine/flip';
import { touchProbabilityAt } from '../engine/calibration';
import { normCdf } from '../lib/math';

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
          The geometry first:{' '}
          {pct(2 * normCdf(-Math.abs(flip.features.horizonGap)))}.
        </strong>{' '}
        Price is <span className="tnum">{flip.features.horizonGap.toFixed(2)}</span>{' '}
        standard deviations of the next {seconds} seconds clear of the target.
        For a walk with no memory the chance of touching a level that far off
        would be exactly 2 × N(−z) — the reflection principle: every path that
        touches and finishes above pairs with one that touches and finishes
        below, so touching is twice finishing beyond.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>
          Then the correction: {pct(flip.baseline)}.
        </strong>{' '}
        The formula assumes the target is watched without blinking, and this app
        checks once a second — a cross that comes straight back is not a flip
        here, so near the target it promises flips that never register. It also
        assumes no jumps, and this tape jumps. Both were measured, over
        1,984,000,000 samples, and this is what actually happens. It is the
        honest core of this screen.
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
        input was scored on whether it predicts a flip inside the next minute
        once the gap is conditioned out. Two
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
        <strong style={{ color: 'var(--muted)' }}>The weights were refitted, and
        they came back as nothing.</strong>{' '}
        The old ones were fitted on 260 rounds — and every sample inside a round
        rides the same price path, so that is an effective sample of about 260
        for sixteen inputs, which is enough to fit noise. Refitted over
        3,560,000 samples from 40,000 rounds, with the penalty chosen by
        cross-validation grouped <em>by round</em>, the sixteen together are
        worth <span className="tnum">+0.00011</span> of AUC over the geometry
        alone. Every penalty from 100,000 down to 1 gives the same held-out
        score, which is what a regression does when there is nothing to
        regularise.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>And they do not
        replicate.</strong>{' '}
        Fitted the same way on 400 rounds and again on 40,000, six of the
        sixteen come back with the <em>opposite sign</em> — failed breakout,
        acceleration, depth, rate of change, regime shift and momentum
        divergence. A real signal does not change direction when you give it a
        hundred times the data. The numbers shipped are the 40,000-round ones
        because they are the better estimate, not because they can be trusted,
        and the reasons above are ranked by how far each input has actually
        moved rather than by a weight that does not mean anything. The pattern
        match is drawing on{' '}
        <span className="tnum">{store.flipMemorySize}</span> resolved setups.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>So the geometry is the
        detector</strong>{' '}
        — and it was worth measuring properly. The textbook anchor, 2·N(−|z|),
        assumes the target is watched continuously; this app checks once a
        second, so a cross that comes straight back never registers, and near
        the target the formula promised flips that do not happen — 7.6 points
        too high at a quarter of a standard deviation with fifteen seconds to
        run. Far out it ran the other way, because jumps reach where a
        lognormal does not. Both are now measured, over 1,984,000,000 samples,
        and the fitted correction reproduces the known
        Broadie–Glasserman–Kou constant for a discretely watched barrier to
        three significant figures.
      </div>
      <div className="note">
        A flip warning is not a trade. At one standard deviation clear the chance of
        being touched is already{' '}
        {pct(touchProbabilityAt(1, FLIP_HORIZON_MS / 1_000, store.volRatio))} — being "comfortably
        ahead" in a 15-minute market mostly means the market has not got round to you
        yet.
      </div>
    </Sheet>
  );
}
