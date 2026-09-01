import { useMarket } from '../store/useMarket';
import { fmtClock, fmtUsd } from '../lib/format';
import { Check, Cross } from './icons';

/**
 * The locked call.
 *
 * Four minutes into the round it commits to yes or no and then holds that
 * answer to the bell, however the price moves. When the round closes it asks
 * you to mark it right or wrong, and that verdict is what trains it — a call
 * nobody grades teaches nothing.
 */
export function CallStrip() {
  const store = useMarket(true);
  const pending = store.pendingGrade;
  const call = store.currentCall;

  // The live call comes first; the verdict prompt fills the gap between the
  // bell and the next call locking, so it can never hide a running call.
  if (!call && pending) {
    const up = pending.side === 'up';
    const wentUp = pending.outcome === 'up';
    return (
      <div className="call-strip grading">
        <div className="call-row">
          <span className={`call-badge ${up ? 'yes' : 'no'}`}>{up ? 'YES' : 'NO'}</span>
          <span className="call-text stack">
            <span>
              Called {up ? 'up' : 'down'} at {Math.round(pending.confidence * 100)}%
            </span>
            <span className="dim">
              Closed <span className="tnum">{fmtUsd(pending.closePrice ?? 0)}</span> —{' '}
              {wentUp ? 'up' : 'down'} from <span className="tnum">{fmtUsd(pending.strike)}</span>
            </span>
          </span>
          <button
            className="sig-more"
            aria-label="How the call is made"
            onClick={() => store.openSheet('calls')}
          >
            ?
          </button>
        </div>
        <div className="call-grade">
          <button className="grade-btn right" onClick={() => store.gradeCall(pending.id, 'right')}>
            <Check size={13} /> Right
          </button>
          <button className="grade-btn wrong" onClick={() => store.gradeCall(pending.id, 'wrong')}>
            <Cross size={13} /> Wrong
          </button>
        </div>
      </div>
    );
  }

  if (!call && store.callWindowClosed) {
    return (
      <div className="call-strip">
        <span className="call-badge pending">—</span>
        <span className="call-text dim">
          No call this round — too little of it left to be worth grading
        </span>
      </div>
    );
  }

  if (!call) {
    const wait = store.msToCall;
    const total = store.callWaitMs;
    const done = total > 0 ? 1 - wait / total : 1;
    return (
      <button className="call-strip waiting" onClick={() => store.openSheet('calls')}>
        <span className="call-badge pending">···</span>
        <span className="call-text">
          {store.callRearmed ? 'New target · call locks in ' : 'Call locks in '}
          <span className="tnum">{fmtClock(wait)}</span>
          {/* The re-arm line is longer, so it goes without the tail rather
              than ellipsing away the countdown's explanation. */}
          {!store.callRearmed && (
            <span className="dim"> · one answer, then no take-backs</span>
          )}
        </span>
        <span className="call-progress">
          <span style={{ width: `${Math.max(0, Math.min(1, done)) * 100}%` }} />
        </span>
      </button>
    );
  }

  const up = call.side === 'up';
  const pct = Math.round(call.confidence * 100);
  return (
    <button
      className={`call-strip ${up ? 'yes' : 'no'}`}
      onClick={() => store.openSheet('calls')}
    >
      <span className={`call-badge ${up ? 'yes' : 'no'}`}>{up ? 'YES' : 'NO'}</span>
      <span className="call-text">
        {up ? 'Finishes above' : 'Finishes below'}{' '}
        <span className="tnum">{fmtUsd(call.strike)}</span>
        <span className="dim"> · {pct}% · locked, will not change</span>
      </span>
      <span className="sig-more">?</span>
    </button>
  );
}
