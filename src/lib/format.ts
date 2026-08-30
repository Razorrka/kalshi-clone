const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** $78,229.80 */
export function fmtUsd(n: number): string {
  return usd2.format(n);
}

/** $78,230 — used for chips and balances that read better without cents. */
export function fmtUsdWhole(n: number): string {
  return usd0.format(n);
}

/** $12 when whole, $12.50 otherwise. Used for stakes and payouts. */
export function fmtMoney(n: number): string {
  return Math.abs(n % 1) < 0.005 ? usd0.format(n) : usd2.format(n);
}

/** Axis labels: $78,230.0 — decimals chosen from the tick step. */
export function fmtAxis(n: number, step: number): string {
  const dp = step >= 10 ? 0 : step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
  return (
    '$' +
    n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  );
}

/** 07:00 — the countdown pill. Hours are only shown when present. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 4pm / 4:15pm — the target time label. */
export function fmtTargetTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${suffix}` : `${h}:${String(m).padStart(2, '0')}${suffix}`;
}

/** 3:52 — the fake status-bar clock. */
export function fmtStatusClock(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours() % 12;
  if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function fmtMultiplier(x: number): string {
  return `${x.toFixed(2)}x`;
}
