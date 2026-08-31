import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { SIGNAL_RULES, computeSignals } from '../engine/signals';
import { aggregateBars } from '../engine/candles';
import { fmtUsd } from '../lib/format';

/** Rough character of the setting, so the number means something. */
function describeKey(key: number): string {
  if (key <= 0.7) return 'Very aggressive — fires on small pullbacks, and often.';
  if (key <= 1.3) return 'Standard — the setting the indicator ships with.';
  if (key <= 2.5) return 'Patient — waits for a real reversal, misses the small ones.';
  return 'Very patient — only major turns, few signals.';
}

export function SignalsSheet() {
  const store = useMarket(true);
  const bars = aggregateBars(store.minuteBars, store.candleMs, 160);
  const study = computeSignals(bars, { ...SIGNAL_RULES, keyValue: store.signalKey });
  const { state } = study;
  const minutes = Math.round(store.candleMs / 60_000);

  return (
    <Sheet
      title="Buy / sell signals"
      subtitle={`UT Bot Alerts (${store.signalKey}, ${SIGNAL_RULES.atrPeriod}) · DEMA ${SIGNAL_RULES.demaPeriod} · ${minutes}m bars`}
      onClose={() => store.closeSheet()}
    >
      <div className="book-stats">
        <div className="stat">
          <div className="k">Now</div>
          <div
            className="v"
            style={{
              color: state.bias === 'long' ? 'var(--up)' : 'var(--down)',
            }}
          >
            {state.bias === null ? '—' : state.bias === 'long' ? 'Long' : 'Short'}
          </div>
          <div className="s">side of the stop</div>
        </div>
        <div className="stat">
          <div className="k">Stop</div>
          <div className="v tnum">{state.stop === null ? '—' : fmtUsd(state.stop)}</div>
          <div className="s tnum">
            {state.distance === null ? '—' : `${fmtUsd(Math.abs(state.distance))} away`}
          </div>
        </div>
        <div className="stat">
          <div className="k">Signals</div>
          <div className="v tnum">{study.signals.length}</div>
          <div className="s">on screen</div>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Aggressiveness</div>
            <div className="d">{describeKey(store.signalKey)}</div>
          </div>
          <div className="limit-stepper">
            <span className="tnum">{store.signalKey.toFixed(1)}</span>
          </div>
        </div>
        <input
          className="limit-slider"
          type="range"
          min={0.3}
          max={6}
          step={0.1}
          value={store.signalKey}
          aria-label="Signal aggressiveness"
          onChange={(e) => store.setSignalKey(Number(e.target.value))}
        />
        <div className="slider-ends">
          <span>0.3 · more signals</span>
          <span>6.0 · fewer</span>
        </div>
      </div>

      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What it actually does.</strong>{' '}
        UT Bot is a trailing stop, not a crossover. It sits a distance below price
        in an uptrend — that distance being{' '}
        <span className="tnum">{store.signalKey}</span> × ATR(
        {SIGNAL_RULES.atrPeriod}), the average range of the last{' '}
        {SIGNAL_RULES.atrPeriod} bars — and it <em>ratchets</em>: as price climbs
        the stop follows it up and never slides back down. When a bar closes
        through it, the stop flips to the other side of price and that bar is
        marked. In a downtrend the whole thing mirrors.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Why the number matters.</strong>{' '}
        Because the distance is measured in ATR rather than dollars, the stop
        widens by itself when the market gets volatile and tightens when it calms
        down. A low setting keeps the stop close, so ordinary noise trips it and
        you get frequent signals with more false ones. A high setting holds
        through pullbacks and only marks real reversals, but marks them later.
        There is no correct value — it is the trade between catching a move early
        and being shaken out of it.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>The green line</strong> is a DEMA
        ({SIGNAL_RULES.demaPeriod}), a double-smoothed average that hugs price more
        closely than a plain one. It is not part of the signal; it is there to make
        the trend the stop is following easier to see.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Only closed bars are marked.</strong>{' '}
        The bar still forming has a close that moves with every tick, so a label
        on it would appear and vanish as price wobbles. That is called repainting,
        and a chart that does it will show you a history of signals it never
        actually gave.
      </div>
      <div className="note">
        None of this is advice, and a trailing stop has no opinion about whether a
        move continues. It is a rule for describing what price has already done.
      </div>
    </Sheet>
  );
}
