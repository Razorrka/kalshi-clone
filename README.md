# JIT Coin

A practice simulator of a 15-minute up/down crypto market — the "will the price
be above the target at 4pm" screen, rebuilt so you can learn how these markets
behave without any money involved.

Two price sources:

- **JIT Coin** — a simulated tape that moves like a real one (see below).
- **Live BTC** — real Bitcoin prices streamed from Coinbase's public feed.
  Same screen, same rules, real movement.

Nothing here touches real money or a real exchange. The balance is a number in
your browser's local storage.

## Running it

```bash
npm install
npm run dev
```

Then open the URL it prints. It is built for a phone-sized viewport; on a
desktop it renders inside a phone frame.

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run typecheck  # tsc, no emit
```

## How the market works

**Rounds** are pinned to the wall clock, so a 15-minute market always settles on
the quarter hour, exactly like the real thing. When a round opens, the price at
that instant is locked in as the **target**. Pick **Up** if you think the price
will finish strictly above it, **Down** otherwise. A tie settles Down.

**The percentages are real.** They are the digital-option price under geometric
Brownian motion — `P(finish above target) = N(d₂)` — computed from the live
price, the distance to the target, the volatility and the time left. That is
why they behave the way the real ones do: barely moving early in a round even
when the price swings, then snapping hard toward 0/100 in the closing seconds
as there stops being enough time to travel.

**Payout multipliers** quote a 10% house edge taken out of winnings, not stake:
a side at 49% pays about 1.94x, a side at 5% pays about 18x. Probabilities are
clamped to a 1%–99% band and the multiplier follows the same band, so the
number on the button always matches the percentage beside it. The multiplier
locks in when you place the pick, so a later move in the odds does not change
what you are owed.

Expect the odds to go lopsided near the end of a round. That is not the model
misbehaving — with thirty seconds left and the price a long way from the
target, there genuinely is very little chance of getting back.

**Picks close 5 seconds before settlement**, so you cannot buy a near-certain
outcome at the bell.

**Combos** are parlays across consecutive rounds. Every leg has to land and the
multipliers compound. Future rounds have no target yet, so each is quoted as a
coin flip.

Settings (the gear) let you change the price source, the round length (1 min,
5 min, 15 min, 1 hour — shorter rounds mean practice does not mean waiting),
and the simulated volatility.

## The price engine

`src/engine/priceEngine.ts`. A plain random walk reads as fake immediately —
it wiggles the same amount forever. This one layers four standard pieces:

1. **Geometric Brownian motion** for the trend and diffusion.
2. **Stochastic volatility** — log-volatility mean-reverts as an
   Ornstein–Uhlenbeck process, so the tape has genuinely calm stretches and
   genuinely violent ones instead of uniform noise.
3. **Poisson jumps**, so it occasionally gaps the way news makes a real
   market gap.
4. **Mean-reverting microstructure noise** on top of the "true" price — the
   bid/ask bounce that makes the last few seconds look like an order book
   rather than a smooth curve.

Everything runs off a seeded PRNG (`src/lib/rng.ts`), so a run is reproducible.

For live BTC there is no model volatility to read, so the odds are priced off
**realized** volatility measured from the tape itself: log returns on a fixed
5-second grid over the last ten minutes, annualised. Sampling on a fixed grid
keeps the estimate unbiased even when the underlying data is coarser (the
seeded 1-minute candles), because variance adds linearly in time.

## Live BTC

Coinbase's public market data — no key, no account:

- `wss://ws-feed.exchange.coinbase.com` ticker channel for streaming trades.
- `GET /products/BTC-USD/candles?granularity=60` to seed the chart on connect,
  so the 15M and 1H views have shape immediately.
- `GET /products/BTC-USD/ticker` as a polling fallback if the websocket cannot
  open, with exponential backoff and a staleness watchdog on the stream.

If both are unreachable the market says so and stops accepting picks — with no
price there is nothing to settle against.

## Layout

```
src/
  engine/     price simulation, live feed, odds, rounds, order book, tape
  store/      the market store and its persistence
  components/ the screen
  lib/        rng, math, formatting
```

The store is a plain class with two subscriber sets: a throttled "fast" one
for anything showing the price, and a "slow" one for structural changes such
as a round rolling over. The chart is a canvas driven by its own animation
frame, reading the store directly — at five samples a second, re-rendering the
React tree for every tick would be pure waste.

## Notes and limits

- Open picks are refunded, not settled, when the round they belong to cannot be
  resolved honestly: on reload, when the price source changes, when the round
  length changes, or when rounds elapse with the app closed. There is no price
  path for those, so guessing an outcome would be worse than handing the stake
  back.
- The order book is simulated depth around the model's fair value. A binary
  book is one-sided by construction — buying Down at 40¢ is the same order as
  selling Up at 60¢ — so both columns are two views of one ladder.
- The stream of winnings floating up the chart is simulated. There are no other
  players.
