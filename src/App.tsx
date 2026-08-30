import { useEffect } from 'react';
import { market } from './store/marketStore';
import { useMarket } from './store/useMarket';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { MarketHeader } from './components/MarketHeader';
import { PriceStrip } from './components/PriceStrip';
import { PriceChart } from './components/PriceChart';
import { FeedPill, WinTape } from './components/WinTape';
import { ControlsRow } from './components/ControlsRow';
import { TradeArea } from './components/TradeButtons';
import { OrderBookSheet } from './components/OrderBookSheet';
import { TicketSheet } from './components/TicketSheet';
import { ComboSheet } from './components/ComboSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { ActivitySheet } from './components/ActivitySheet';
import { ResultToast } from './components/ResultToast';

export default function App() {
  const store = useMarket();

  useEffect(() => {
    market.start();
    return () => market.stop();
  }, []);

  return (
    <div className="app">
      <div className="phone">
        <div className="screen">
          <StatusBar />
          <TopBar />
          <MarketHeader />
          <PriceStrip />
          <div className="chart-wrap">
            <PriceChart />
            <WinTape />
            <FeedPill />
          </div>
          <ControlsRow />
          <TradeArea />
          <div className="home-bar" />
        </div>

        <ResultToast />

        {store.sheet === 'book' && <OrderBookSheet />}
        {store.sheet === 'ticket' && <TicketSheet />}
        {store.sheet === 'combo' && <ComboSheet />}
        {store.sheet === 'settings' && <SettingsSheet />}
        {store.sheet === 'activity' && <ActivitySheet />}
      </div>
    </div>
  );
}
