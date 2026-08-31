import { useMarket } from '../store/useMarket';
import type { ChartView } from '../engine/types';

const TABS: { key: ChartView; label: string }[] = [
  { key: 'line', label: 'Chart' },
  { key: 'candles', label: 'Candles' },
  { key: 'positions', label: 'Orders' },
];

export function ViewTabs() {
  const store = useMarket(true);
  const openCount = store.openPositions.length + store.restingOrders.length;
  const pnl = store.openPnl;

  return (
    <div className="view-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={store.chartView === tab.key ? 'active' : ''}
          onClick={() => store.setChartView(tab.key)}
        >
          {tab.label}
          {tab.key === 'positions' && openCount > 0 && (
            <span className={`tab-badge ${pnl >= 0 ? 'pos' : 'neg'}`}>{openCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}
