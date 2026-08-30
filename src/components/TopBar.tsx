import { useState } from 'react';
import { useMarket } from '../store/useMarket';
import { fmtMoney } from '../lib/format';
import { ArrowLeft, Calendar, Gear, Star } from './icons';

export function TopBar() {
  const store = useMarket(true);
  const [starred, setStarred] = useState(true);

  return (
    <div className="topbar">
      <button className="circ" aria-label="Back" onClick={() => store.closeSheet()}>
        <ArrowLeft />
      </button>
      <button
        className="balance-pill tnum"
        onClick={() => store.openSheet('activity')}
        aria-label="Practice balance and activity"
      >
        <i className="dot" />
        {fmtMoney(store.balance)}
      </button>
      <span className="spacer" />
      <button
        className="circ"
        aria-label="Upcoming rounds"
        onClick={() => store.openSheet('combo')}
      >
        <Calendar />
      </button>
      <button
        className={`circ${starred ? ' on' : ''}`}
        aria-label="Watchlist"
        aria-pressed={starred}
        onClick={() => setStarred((v) => !v)}
        style={{ ['--star-fill' as string]: starred ? '1' : '0' }}
      >
        <Star />
      </button>
      <button
        className="circ"
        aria-label="Settings"
        onClick={() => store.openSheet('settings')}
      >
        <Gear />
      </button>
    </div>
  );
}
