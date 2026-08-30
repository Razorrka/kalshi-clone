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
