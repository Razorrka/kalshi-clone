import { useMarket } from '../store/useMarket';
import { SIGNAL_RULES, computeSignals } from '../engine/signals';
import { toCandles } from '../engine/candles';
import { fmtUsd } from '../lib/format';

/**
 * What the indicator is saying at this moment, in words. The chart shows the
 * stop; this says which side of it price is on and how far it has to travel
 * to flip — which is the part that decides whether a signal is imminent.
 */
export function SignalReadout() {
  const store = useMarket(true);
  if (!store.signalsOn || store.chartView !== 'candles') return null;

  const bars = toCandles(store.series, store.candleMs, 160);
  const { state } = computeSignals(bars, {
    ...SIGNAL_RULES,
    keyValue: store.signalKey,
  });

  if (state.bias === null || state.stop === null) {
    return (
      <div className="signal-readout">
        <span className="dim">Not enough closed bars yet for UT Bot.</span>
      </div>
    );
  }

  const long = state.bias === 'long';
  const gap = Math.abs(state.distance ?? 0);
  const mins = Math.round((store.candleMs / 60_000) * (state.barsSince ?? 0));

  return (
    <button className="signal-readout" onClick={() => store.openSheet('signals')}>
      <span className={`sig-chip ${long ? 'long' : 'short'}`}>
        {long ? 'LONG' : 'SHORT'}
      </span>
      <span className="sig-text">
        stop <span className="tnum">{fmtUsd(state.stop)}</span>
        <span className="dim">
          {' '}
          · {fmtUsd(gap)} to flip
          {state.last ? ` · last ${state.last.side} ${mins}m ago` : ''}
        </span>
      </span>
      <span className="sig-more">?</span>
    </button>
  );
}
