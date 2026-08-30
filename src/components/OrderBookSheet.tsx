import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtMultiplier } from '../lib/format';

const maxSize = (sizes: number[]) => Math.max(1, ...sizes);

export function OrderBookSheet() {
  const store = useMarket(true);
  const book = store.book;
  if (!book) return null;

  const rows = Math.max(book.upBids.length, book.downBids.length);
  const peak = maxSize([
    ...book.upBids.map((l) => l.size),
    ...book.downBids.map((l) => l.size),
  ]);

  return (
    <Sheet
      title="Order book"
      subtitle={
        <>
          Contracts settle at $1.00 · spread {book.spreadCents}¢
          {book.lastTradeCents !== null && ` · last ${book.lastTradeCents}¢`}
        </>
      }
      onClose={() => store.closeSheet()}
    >
      <div className="book-stats">
        <div className="stat">
          <div className="k">Up</div>
          <div className="v tnum" style={{ color: 'var(--up)' }}>
            {store.quote.upPct}%
          </div>
        </div>
        <div className="stat">
          <div className="k">Down</div>
          <div className="v tnum" style={{ color: 'var(--down)' }}>
            {store.quote.downPct}%
          </div>
        </div>
        <div className="stat">
          <div className="k">Payout</div>
          <div className="v tnum">
            {fmtMultiplier(store.quote.upMultiplier)} /{' '}
            {fmtMultiplier(store.quote.downMultiplier)}
          </div>
        </div>
      </div>

      <div className="book-head">
        <span>Up size</span>
        <span>Price</span>
        <span>Down size</span>
      </div>

      {Array.from({ length: rows }).map((_, i) => {
        const up = book.upBids[i];
        const down = book.downBids[i];
        return (
          <div className="book-row" key={i}>
            <div className="book-cell up">
              {up && (
                <>
                  <span className="fill" style={{ width: `${(up.size / peak) * 100}%` }} />
                  <span className="tnum">{up.size.toLocaleString()}</span>
                </>
              )}
            </div>
            <div className="book-price tnum">
              {up && <span className="book-price up">{up.cents}¢</span>}
              {up && down && ' / '}
              {down && <span className="book-price down">{down.cents}¢</span>}
            </div>
            <div className="book-cell down right">
              {down && (
                <>
                  <span
                    className="fill"
                    style={{ width: `${(down.size / peak) * 100}%` }}
                  />
                  <span className="tnum">{down.size.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>
        );
      })}

      <div className="note">
        A binary book is one sided — buying Down at 40¢ is the same order as selling Up
        at 60¢, so both columns are two views of one ladder. Depth here is simulated
        around the model's fair value.
      </div>
    </Sheet>
  );
}
