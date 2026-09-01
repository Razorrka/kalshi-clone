import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtUsd } from '../lib/format';
import { CONFIDENT_AT, contributions, lockDelayFor, type LockedCall } from '../engine/caller';

const FEATURE_NAMES: Record<'z' | 'bias' | 'momentum', string> = {
  z: 'Distance to target',
  bias: 'Trend (UT Bot)',
  momentum: 'Last two minutes',
};

function pct(p: number | null): string {
  return p === null ? '—' : `${Math.round(p * 100)}%`;
}

/** The reasoning behind one call, in the terms it actually decided on. */
function Reasoning({ call }: { call: LockedCall }) {
  const parts = contributions(call.features, call.weights);
  const lead = call.spot - call.strike;
  const msLeft = call.roundEndsAt - call.lockedAt;
  const left = msLeft < 90_000 ? 'under a minute' : `about ${Math.round(msLeft / 60_000)}m`;

  return (
    <>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What it saw.</strong> With {left}{' '}
        left to run, price sat <span className="tnum">{fmtUsd(Math.abs(lead))}</span>{' '}
        {lead >= 0 ? 'above' : 'below'} the target — that is{' '}
        <span className="tnum">{Math.abs(call.features.z).toFixed(2)}</span> standard
        deviations of the movement still to come. A lead only counts for as much as
        the time left can undo, which is why the same dollar gap means more late in
        a round than early.
      </div>
      <div className="call-factors">
        {parts.map((part) => (
          <div className="call-factor" key={part.key}>
            <div className="k">{FEATURE_NAMES[part.key]}</div>
            <div className="v tnum">{part.value.toFixed(2)}</div>
            <div
              className="s tnum"
              style={{
                color:
                  Math.abs(part.shift) < 0.005
                    ? 'var(--muted-2)'
                    : part.shift > 0
                      ? 'var(--up)'
                      : 'var(--down)',
              }}
            >
              {Math.abs(part.shift) < 0.005
                ? 'no effect'
                : `${part.shift > 0 ? '+' : '−'}${Math.round(Math.abs(part.shift) * 100)} pts`}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The caller's record: what it has said, how often it was right, and whether
 * its confidence means anything.
 */
export function CallsSheet() {
  const store = useMarket(true);
  const record = store.callRecord;
  const latest = store.currentCall ?? store.calls[0] ?? null;
  const graded = store.calls.filter((c) => c.grade);
  const ungraded = store.gradableCalls;
  const lockMs = lockDelayFor(store.roundMs);
  const lockIn =
    lockMs >= 60_000 ? `${Math.round(lockMs / 60_000)} minutes` : `${Math.round(lockMs / 1_000)} seconds`;

  return (
    <Sheet
      title="The call"
      subtitle={
        record.graded === 0
          ? 'One answer per round, locked and left alone'
          : `${record.right} right of ${record.graded} graded · ${pct(record.hitRate)}`
      }
      onClose={() => store.closeSheet()}
      footer={
        <button className="danger-btn" onClick={() => store.resetCaller()}>
          Reset what it has learned
        </button>
      }
    >
      <div className="book-stats">
        <div className="stat">
          <div className="k">Hit rate</div>
          <div className="v tnum">{pct(record.hitRate)}</div>
          <div className="s">{record.graded} graded</div>
        </div>
        <div className="stat">
          <div className="k">When sure</div>
          <div className="v tnum">{pct(record.confidentHitRate)}</div>
          <div className="s">above {Math.round(CONFIDENT_AT * 100)}%</div>
        </div>
        <div className="stat">
          <div className="k">Streak</div>
          <div
            className="v tnum"
            style={{
              color:
                record.streak > 0
                  ? 'var(--up)'
                  : record.streak < 0
                    ? 'var(--down)'
                    : 'var(--text)',
            }}
          >
            {record.streak === 0 ? '—' : `${Math.abs(record.streak)}`}
          </div>
          <div className="s">{record.streak < 0 ? 'wrong in a row' : 'right in a row'}</div>
        </div>
      </div>

      {latest && (
        <>
          <div className="section-label">
            {store.currentCall ? 'This round' : 'Its last call'}
          </div>
          <div className={`call-card ${latest.side === 'up' ? 'yes' : 'no'}`}>
            <span className={`call-badge ${latest.side === 'up' ? 'yes' : 'no'}`}>
              {latest.side === 'up' ? 'YES' : 'NO'}
            </span>
            <div className="grow">
              <div className="call-card-title">
                {latest.side === 'up' ? 'Above' : 'Below'}{' '}
                <span className="tnum">{fmtUsd(latest.strike)}</span>
              </div>
              <div className="call-card-sub">
                {Math.round(latest.confidence * 100)}% confident
                {latest.outcome
                  ? ` · finished ${latest.outcome === 'up' ? 'up' : 'down'}`
                  : ' · still running'}
                {latest.grade ? ` · you marked it ${latest.grade}` : ''}
              </div>
            </div>
          </div>
          <Reasoning call={latest} />
        </>
      )}

      {ungraded.length > 0 && (
        <>
          <div className="section-label">Still to grade</div>
          {ungraded.slice(0, 6).map((c) => (
            <div className="call-log-row ungraded" key={c.id}>
              <span className={`call-mini ${c.side === 'up' ? 'yes' : 'no'}`}>
                {c.side === 'up' ? 'YES' : 'NO'}
              </span>
              <span className="grow">
                <span className="tnum">{fmtUsd(c.strike)}</span>
                <span className="dim">
                  {' '}
                  · closed <span className="tnum">{fmtUsd(c.closePrice ?? 0)}</span>
                </span>
              </span>
              <button className="mini-grade right" onClick={() => store.gradeCall(c.id, 'right')}>
                Right
              </button>
              <button className="mini-grade wrong" onClick={() => store.gradeCall(c.id, 'wrong')}>
                Wrong
              </button>
            </div>
          ))}
          <div className="note">
            A call nobody grades teaches nothing — these are the ones that got
            away while you were not looking.
          </div>
        </>
      )}

      {record.graded >= 3 && (
        <>
          <div className="section-label">Is its confidence honest?</div>
          <div className="calibration">
            {record.calibration
              .filter((b) => b.graded > 0)
              .map((band) => (
                <div className="calib-row" key={band.label}>
                  <div className="calib-label tnum">{band.label}</div>
                  <div className="calib-bars">
                    <span
                      className="actual"
                      style={{ width: `${(band.actual ?? 0) * 100}%` }}
                      title="how often it was right"
                    />
                    <span
                      className="claimed"
                      style={{ left: `${band.claimed * 100}%` }}
                      title="what it claimed"
                    />
                  </div>
                  <div className="calib-count tnum">
                    {band.right}/{band.graded}
                  </div>
                </div>
              ))}
          </div>
          <div className="note">
            The bar is how often it was actually right; the line is what it
            claimed. A caller whose bars reach their lines is calibrated — 80%
            means 80%. One whose bars keep falling short of them is
            overconfident, and its numbers should be read down.
          </div>
        </>
      )}

      {graded.length > 0 && (
        <>
          <div className="section-label">Graded calls</div>
          <div className="call-log">
            {graded.slice(0, 20).map((c) => (
              <div className="call-log-row" key={c.id}>
                <span className={`call-dot ${c.grade === 'right' ? 'right' : 'wrong'}`} />
                <span className={`call-mini ${c.side === 'up' ? 'yes' : 'no'}`}>
                  {c.side === 'up' ? 'YES' : 'NO'}
                </span>
                <span className="grow tnum">{fmtUsd(c.strike)}</span>
                <span className="dim tnum">{Math.round(c.confidence * 100)}%</span>
                <span className={c.grade === 'right' ? 'ok' : 'bad'}>
                  {c.grade === 'right' ? 'right' : 'wrong'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">How it works</div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>One answer, {lockIn} in.</strong>{' '}
        It commits about a quarter of the way through the round and then does not
        move, whatever price does afterwards. That is the point of it: a caller that
        updates every tick is just reading you the price back, and gives you
        nothing to be graded on.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>The WITCG button.</strong> Tap it
        and it commits 90 seconds later, on your clock instead of the round's.
        It is the one way past "locked and left alone", and it throws away
        whatever it had already said — so pressing it until you like the answer
        is possible. Those re-rolls still go in the record, which means the
        habit shows up in the calibration above rather than hiding in it.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Change the target and the clock restarts.</strong>{' '}
        A call answers "does it finish above this number", so a different number
        is a different question — the live call is dropped rather than reworded,
        and the caller watches price around the new target for a minute before
        it commits again. It never calls sooner than it would have: an edit made
        early in the round still waits for the usual mark. Edit late enough that
        a minute of watching would run into the bell and it says nothing at all
        that round.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>Where the confidence comes from.</strong>{' '}
        Untrained, it reproduces the textbook answer — the probability of
        finishing above the target given how far away it is and how much time is
        left. It starts there rather than at a coin flip, so it is useful before
        it has learned anything.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>What grading does.</strong> Marking
        a call right or wrong takes one gradient step on those three inputs. The
        size of the step is how wrong it was, so a confident miss moves it hard
        and a call it already had right barely moves it. It has been trained{' '}
        <span className="tnum">{store.callModel.trained}</span> time
        {store.callModel.trained === 1 ? '' : 's'}. There is no memory of
        individual calls — only the weights they left behind.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>A high hit rate is not an edge.</strong>{' '}
        It mostly calls the favourite, and calling the favourite is right most of
        the time — the market charges you for exactly that, in the multiplier.
        Being right 65% of the time at 1.5x is not a living. The number worth
        reading is the calibration above, not the hit rate.
      </div>
      <div className="note">
        <strong style={{ color: 'var(--muted)' }}>An honest limit.</strong> Jit Coin
        is a random walk with no memory, so distance-to-target is the only input
        that can carry real information; trend and momentum are noise here by
        construction, and you should expect the model to settle on ignoring them.
        What the learning can genuinely do is keep the confidence honest — if it
        says 80% too often, grading pulls that number back down. On live Bitcoin
        there is at least a real question to ask, but a 15-minute market is close
        enough to a coin flip that no caller, this one included, should be
        trusted to beat it.
      </div>
    </Sheet>
  );
}
