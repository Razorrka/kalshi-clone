import { useEffect, useState } from 'react';
import { fmtStatusClock } from '../lib/format';
import { StatusGlyphs } from './icons';

/** The iOS status bar, so the page reads as a phone screen on the desktop too. */
export function StatusBar() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="statusbar">
      <span className="tnum">{fmtStatusClock(now)}</span>
      <span className="glyphs">
        <StatusGlyphs />
      </span>
    </div>
  );
}
