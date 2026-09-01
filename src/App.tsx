import { useEffect } from 'react';
import { market } from './store/marketStore';
import { useMarket } from './store/useMarket';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { MarketHeader } from './components/MarketHeader';
import { PriceStrip } from './components/PriceStrip';
import { PriceChart } from './components/PriceChart';
import { CandleChart } from './components/CandleChart';
import { PositionsPanel } from './components/PositionsPanel';
import { ViewTabs } from './components/ViewTabs';
import { WinTape } from './components/WinTape';
import { ControlsRow } from './components/ControlsRow';
import { TradeArea } from './components/TradeButtons';
import { OrderBookSheet } from './components/OrderBookSheet';
import { TicketSheet } from './components/TicketSheet';
import { ComboSheet } from './components/ComboSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { ActivitySheet } from './components/ActivitySheet';
import { StrikeSheet } from './components/StrikeSheet';
import { SignalsSheet } from './components/SignalsSheet';
import { BalanceSheet } from './components/BalanceSheet';
import { SignalReadout } from './components/SignalReadout';
import { CallStrip } from './components/CallStrip';
import { CallButton } from './components/CallButton';
import { CallsSheet } from './components/CallsSheet';
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
          <ViewTabs />
          <div className="chart-wrap">
            {store.chartView === 'line' && (
              <>
                <PriceChart />
                <WinTape />
              </>
            )}
            {store.chartView === 'candles' && <CandleChart />}
            {store.chartView === 'positions' && <PositionsPanel />}
            <ResultToast />
          </div>
          <CallStrip />
          <CallButton />
          <SignalReadout />
          <ControlsRow />
          <TradeArea />
          <div className="home-bar" />
        </div>

        {store.sheet === 'book' && <OrderBookSheet />}
        {store.sheet === 'ticket' && <TicketSheet />}
        {store.sheet === 'combo' && <ComboSheet />}
        {store.sheet === 'settings' && <SettingsSheet />}
        {store.sheet === 'activity' && <ActivitySheet />}
        {store.sheet === 'strike' && <StrikeSheet />}
        {store.sheet === 'signals' && <SignalsSheet />}
        {store.sheet === 'balance' && <BalanceSheet />}
        {store.sheet === 'calls' && <CallsSheet />}
      </div>
    </div>
  );
}
