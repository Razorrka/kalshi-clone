import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtMoney } from '../lib/format';
import { RUIN_TABLE } from '../engine/coach';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function CoachSheet() {
  const store = useMarket(true);
  const call = store.coachCall;
  const limits = store.limits;
  const seconds = store.cooldownLeft;

  return (
    <Sheet
      title="Discipline"
      subtitle={
        call
          ? `Session ${call.sessionPnl >= 0 ? '+' : ''}${fmtMoney(call.sessionPnl)} · your size is ${fmtMoney(call.stakeCap)}`
          : 'Coach is off'
      }
      onClose={() => store.closeSheet()}
      footer={
        store.blocked ? (
          <button className="danger-btn" onClick={() => store.overrideCoach()}>
            Trade through it anyway — one ticket
          </button>
        ) : undefined
      }
    >
      {call && call.findings.length > 0 ? (
        <>
          <div className={`coach-card ${call.verdict.toLowerCase()}`}>
            <div className="coach-card-word">
              {call.verdict === 'STOP' ? 'DO NOT' : 'HOLD ON'}
            </div>
            <div className="coach-card-line">{call.headline}</div>
            <div className="coach-card-action">
              {seconds > 0 ? `Sit out ${seconds}s` : call.action}
            </div>
          </div>
          <div className="section-label">Why</div>
          {call.findings.map((f) => (
            <div className={`coach-finding sev${f.severity}`} key={f.key}>
              <div className="coach-finding-head">{f.headline}</div>
              <div className="coach-finding-body">{f.detail}</div>
            </div>
          ))}
        </>
      ) : (
        <div className="note">
          Nothing flagged. That is not the same as a good bet — every price on
          this board loses money on average. It only means the way you are
          about to take one is not the way accounts end.
        </div>
      )}

      <div className="section-label">Where the numbers come from</div>
      <div className="note">
        20,000 runs of 200 tickets at the 3x band, starting from $1,000, all
        with identical odds and identical picks. The only thing that changed
        between rows is how much went on each time.
      </div>
      <div className="ruin-table">
        {RUIN_TABLE.map((row) => (
          <div className="ruin-row" key={row.label}>
            <span className="ruin-label">{row.label}</span>
            <span className="ruin-bar">
              <span style={{ width: `${row.broke * 100}%` }} />
            </span>
            <span className={`ruin-pct tnum ${row.broke > 0.5 ? 'bad' : row.broke > 0.05 ? 'mid' : 'ok'}`}>
              {(row.broke * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <div className="note">
        The right-hand column is how often the account was empty before the 200
        tickets were up. Nothing about the picks changed. That is the whole
        argument for a size limit, and it is why the coach cares far more about
        how much you stake than about what you stake it on.
      </div>

      <div className="section-label">Your rules</div>
      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Most per ticket</div>
            <div className="d">
              {pct(limits.maxStakePct)} of the bank — {fmtMoney(store.balance * limits.maxStakePct)} right now
            </div>
          </div>
        </div>
        <input
          className="limit-slider"
          type="range"
          min={0.005}
          max={0.1}
          step={0.005}
          value={limits.maxStakePct}
          aria-label="Maximum stake as a share of the bank"
          onChange={(e) => store.setLimits({ maxStakePct: Number(e.target.value) })}
        />
        <div className="slider-ends">
          <span>0.5% · survives</span>
          <span>10% · broke 7 times in 10</span>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Stop the session at</div>
            <div className="d">down {pct(limits.maxSessionLossPct)} from where it started</div>
          </div>
        </div>
        <input
          className="limit-slider"
          type="range"
          min={0.05}
          max={0.6}
          step={0.05}
          value={limits.maxSessionLossPct}
          aria-label="Session loss limit"
          onChange={(e) => store.setLimits({ maxSessionLossPct: Number(e.target.value) })}
        />
        <div className="slider-ends">
          <span>5%</span>
          <span>60%</span>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="grow">
            <div className="k">Forced break after</div>
            <div className="d">
              {limits.lossStreakStop} losses in a row, for{' '}
              {Math.round(limits.cooldownMs / 1000)}s
            </div>
          </div>
        </div>
        <input
          className="limit-slider"
          type="range"
          min={2}
          max={8}
          step={1}
          value={limits.lossStreakStop}
          aria-label="Losses before a forced break"
          onChange={(e) => store.setLimits({ lossStreakStop: Number(e.target.value) })}
        />
        <div className="slider-ends">
          <span>2 losses</span>
          <span>8 losses</span>
        </div>
      </div>

      <div className="book-stats">
        <div className="stat">
          <div className="k">Session</div>
          <div className={`v tnum ${(call?.sessionPnl ?? 0) >= 0 ? 'pos' : 'neg'}`}>
            {call ? `${call.sessionPnl >= 0 ? '+' : ''}${fmtMoney(call.sessionPnl)}` : '—'}
          </div>
          <div className="s">{store.betLog.length} tickets</div>
        </div>
        <div className="stat">
          <div className="k">Streak</div>
          <div className="v tnum">{call?.lossStreak ?? 0}</div>
          <div className="s">losses in a row</div>
        </div>
        <div className="stat">
          <div className="k">Drawdown</div>
          <div className="v tnum">
            {call ? pct(Math.max(0, call.drawdown)) : '—'}
          </div>
          <div className="s">of {pct(limits.maxSessionLossPct)}</div>
        </div>
      </div>

      <div className="section-label">Check a claim yourself</div>
      <div className="note">
        Someone will hand you a list of indicators that make it "10x more
        accurate". The proving ground runs any of them over thousands of
        independent rounds and reports what they actually did, with an
        interval. It is faster than arguing.
      </div>
      <button
        className="chip"
        style={{ width: '100%', marginBottom: 10 }}
        onClick={() => store.openSheet('proving')}
      >
        Open the proving ground
      </button>

      <button className="chip" style={{ width: '100%', marginTop: 10 }} onClick={() => store.resetSession()}>
        Start a fresh session from here
      </button>
      <button
        className="chip"
        style={{ width: '100%', marginTop: 6 }}
        onClick={() => store.setCoach(!store.coachOn)}
      >
        {store.coachOn ? 'Turn the coach off' : 'Turn the coach back on'}
      </button>

      <div className="section-label">What this can and cannot do</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>It cannot make you win.</strong> The
        house takes 10% of winnings and the measurement says every price on this
        board is negative. No rule, no signal and no amount of patience changes
        that. Anyone selling you the opposite is selling you something.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>It can change how long you last.</strong>{' '}
        That is not a consolation prize — it is the only variable you control.
        At 1% a ticket the table above never emptied an account in 200 bets. At
        a quarter of the bank it emptied 96.9% of them, off exactly the same
        picks.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Chasing is the specific killer.</strong>{' '}
        Doubling after a loss feels like control and reads like a system. It
        went broke 92.7% of the time, and it does it in one round after a
        stretch of small wins that make it look like it works.
      </div>
      <div className="note">
        You can override any of this in one tap, and the override lasts one
        ticket. That is deliberate: a rule you cannot break is a rule you will
        resent, and a rule with no friction is not a rule.
      </div>
    </Sheet>
  );
}
