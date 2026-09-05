import { useMarket } from '../store/useMarket';

/**
 * The words on the screen.
 *
 * Deliberately loud and deliberately rare: it says nothing at all while
 * nothing is wrong, so that when it does speak it is worth reading. It never
 * tells you a bet is good — it cannot, nothing here is — only when the way
 * you are about to take one is the way accounts end.
 */
export function CoachBanner() {
  const store = useMarket(true);
  const call = store.coachCall;
  if (!store.coachOn || !call || call.verdict === 'CLEAR') return null;

  const stop = call.verdict === 'STOP';
  const seconds = store.cooldownLeft;

  return (
    <button
      className={`coach-banner ${stop ? 'stop' : 'wait'}`}
      onClick={() => store.openSheet('coach')}
    >
      <div className="coach-word">{stop ? 'DO NOT' : 'HOLD ON'}</div>
      <div className="coach-line">{call.headline}</div>
      <div className="coach-action">
        {seconds > 0 ? `Sit out ${seconds}s` : call.action}
      </div>
    </button>
  );
}
