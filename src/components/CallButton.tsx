import { useMarket } from '../store/useMarket';
import { CALL_ON_DEMAND_MS } from '../engine/caller';

const SECONDS = Math.round(CALL_ON_DEMAND_MS / 1_000);

/**
 * Asks for a call on your schedule rather than the round's: tap it and it
 * commits ninety seconds later, throwing away whatever it had already said.
 *
 * Deliberately the one way past "locked and left alone" — you opened it, and
 * the re-rolled call still counts in the record.
 */
export function CallButton() {
  const store = useMarket(true);
  const armed = store.callOnDemand;
  const allowed = store.canRequestCall;

  return (
    <button
      className={`call-button${armed ? ' armed' : ''}`}
      disabled={!allowed}
      onClick={() => store.requestCall()}
    >
      <span className="call-button-name">WITCG</span>
      <span className="call-button-hint">
        {armed
          ? 'counting down — tap to restart it'
          : allowed
            ? `call me in ${SECONDS}s`
            : 'too little of this round left'}
      </span>
    </button>
  );
}
