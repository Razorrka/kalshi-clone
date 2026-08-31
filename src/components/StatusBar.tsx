import { useEffect, useState } from 'react';
import { fmtStatusClock } from '../lib/format';
import { StatusGlyphs } from './icons';

/** True when launched from the home screen rather than a browser tab. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosLegacy = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosLegacy === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

/**
 * The iOS status bar, so the page reads as a phone screen on the desktop too.
 * Installed to a home screen the device draws its own, so ours gets out of the
 * way and just reserves the notch.
 */
export function StatusBar() {
  const [now, setNow] = useState(() => Date.now());
  const [standalone, setStandalone] = useState(isStandalone);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onChange = () => setStandalone(isStandalone());
    mq?.addEventListener?.('change', onChange);
    return () => {
      clearInterval(id);
      mq?.removeEventListener?.('change', onChange);
    };
  }, []);

  if (standalone) return <div className="statusbar-spacer" />;

  return (
    <div className="statusbar">
      <span className="tnum">{fmtStatusClock(now)}</span>
      <span className="glyphs">
        <StatusGlyphs />
      </span>
    </div>
  );
}
