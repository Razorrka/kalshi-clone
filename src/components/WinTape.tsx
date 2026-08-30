import { useMarket } from '../store/useMarket';

/** Other players' settled winnings, floating up the left of the chart. */
export function WinTape() {
  const store = useMarket(true);
  return (
    <div className="tape" aria-hidden="true">
      {store.tape.map((entry) => (
        <div key={entry.id} className="tape-entry">
          + ${entry.amount}
        </div>
      ))}
    </div>
  );
}

export function FeedPill() {
  const store = useMarket();
  if (store.mode === 'sim') {
    return (
      <div className="feed-pill">
        <i className="dot" />
        Simulated
      </div>
    );
  }
  const cls =
    store.feedStatus === 'live'
      ? 'live'
      : store.feedStatus === 'error'
        ? 'bad'
        : 'warn';
  const text =
    store.feedStatus === 'live'
      ? 'Live BTC'
      : store.feedStatus === 'error'
        ? 'Feed offline'
        : store.feedStatus === 'reconnecting'
          ? 'Reconnecting'
          : 'Connecting';
  return (
    <div className={`feed-pill ${cls}`} title={store.feedDetail}>
      <i className="dot" />
      {text}
    </div>
  );
}
