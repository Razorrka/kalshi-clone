import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { ROUND_LENGTHS } from '../engine/rounds';
import { VOL_PRESETS, type VolPreset } from '../engine/priceEngine';
import { HOUSE_EDGE, LOCK_MS } from '../engine/odds';
import { SIGNAL_RULES } from '../engine/signals';
import { fmtMoney } from '../lib/format';

const VOL_LABELS: Record<VolPreset, string> = {
  calm: 'Calm',
  normal: 'Normal',
  wild: 'Wild',
};

export function SettingsSheet() {
  const store = useMarket();

  return (
    <Sheet
      title="Market settings"
      subtitle="Practice mode — no real money, ever"
      onClose={() => store.closeSheet()}
    >
      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Price source</div>
            <div className="d">
              JIT Coin is a simulated tape. Live BTC streams real Coinbase prices —
              same market, same rules, real movement.
            </div>
          </div>
        </div>
        <div className="seg">
          <button
            className={store.mode === 'sim' ? 'active' : ''}
            onClick={() => store.setMode('sim')}
          >
            JIT Coin
          </button>
          <button
            className={store.mode === 'live' ? 'active' : ''}
            onClick={() => store.setMode('live')}
          >
            Live BTC
          </button>
        </div>
        {store.mode === 'live' && store.feedStatus === 'error' && (
          <div className="form-error" style={{ textAlign: 'left', marginTop: 10 }}>
            Cannot reach Coinbase{store.feedDetail ? ` (${store.feedDetail})` : ''}. Check
            your connection, or switch back to JIT Coin.
          </div>
        )}
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Round length</div>
            <div className="d">
              Rounds are pinned to the clock, so 15 min always settles on the quarter
              hour. Shorter rounds are there so practice does not mean waiting.
            </div>
          </div>
        </div>
        <div className="seg">
          {ROUND_LENGTHS.map((r) => (
            <button
              key={r.ms}
              className={store.roundMs === r.ms ? 'active' : ''}
              onClick={() => store.setRoundMs(r.ms)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Volatility</div>
            <div className="d">
              How hard the simulated tape moves, as annualised volatility. JIT Coin
              only — live BTC is priced off its own realized volatility, measured
              from the tape.
            </div>
          </div>
        </div>
        <div className="seg">
          {(Object.keys(VOL_PRESETS) as VolPreset[]).map((p) => (
            <button
              key={p}
              className={store.volPreset === p ? 'active' : ''}
              onClick={() => store.setVolPreset(p)}
            >
              {VOL_LABELS[p]} · {Math.round(VOL_PRESETS[p] * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Buy / sell labels</div>
            <div className="d">
              UT Bot Alerts ({store.signalKey}, {SIGNAL_RULES.atrPeriod}) with a DEMA{' '}
              {SIGNAL_RULES.demaPeriod} overlay, on the candle chart. Tap the reading
              under the chart to change how aggressive it is and see what it means.
            </div>
          </div>
          <button
            className={`switch${store.signalsOn ? ' on' : ''}`}
            role="switch"
            aria-checked={store.signalsOn}
            aria-label="Buy and sell markers"
            onClick={() => store.setSignals(!store.signalsOn)}
          >
            <i />
          </button>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Haptics</div>
            <div className="d">Buzz on placing a pick and on settlement.</div>
          </div>
          <button
            className={`switch${store.hapticsOn ? ' on' : ''}`}
            role="switch"
            aria-checked={store.hapticsOn}
            aria-label="Haptics"
            onClick={() => store.setHaptics(!store.hapticsOn)}
          >
            <i />
          </button>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Practice account</div>
            <div className="d">
              Balance <span className="tnum">{fmtMoney(store.balance)}</span>. Pick a
              stake small enough that losing it registers — that is most of what
              makes practice worth anything.
            </div>
          </div>
        </div>
        <button
          className="danger-btn"
          style={{ borderColor: '#2c323b', color: '#fff' }}
          onClick={() => store.openSheet('balance')}
        >
          Set or add funds
        </button>
        <button className="danger-btn" onClick={() => store.resetAccount()}>
          Reset to {fmtMoney(store.startingBalanceCents / 100)}
        </button>
      </div>

      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>How the odds work.</strong> The target
        is the price at the moment the round opened. The percentages are the real
        probability of finishing above it — N(d₂) under geometric Brownian motion —
        so they barely move early and snap hard in the closing seconds. The house edge
        is {Math.round(HOUSE_EDGE * 100)}% of winnings, and picks close{' '}
        {LOCK_MS / 1000}s before settlement, both the way the real product works.
      </div>
      <div className="note">
        Nothing here touches real money or a real exchange. It is a toy for learning how
        short-dated binary markets behave.
      </div>
    </Sheet>
  );
}
