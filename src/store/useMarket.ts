import { useEffect, useReducer } from 'react';
import { market, type MarketStore } from './marketStore';

/**
 * Subscribes a component to the store. `fast` opts into the throttled
 * price stream (~14 fps); everything else only re-renders on real state
 * changes such as a round rolling over or a ticket being placed.
 */
export function useMarket(fast = false): MarketStore {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => market.subscribe(force, fast), [fast]);
  return market;
}
