# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/kijanginova88/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/kijanginova88/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Momentum breakout bot for Coinbase Wrapped BTC (cbBTC) on 1-minute on-chain prices. Long only, $1,000 paper money. It enters when price breaks above the highest close of the last 20 bars while EMA(9) sits above EMA(30) and RSI(14) confirms momentum (>= 50), rides the move with a trailing stop (armed at +30 bp, exits on a 30 bp pullback from the peak), a hard stop at -40 bp, an RSI <= 30 exit, and a 240-bar max hold. After realised cash falls $10 below its realised peak it stops opening new trades for the rest of the window (chop protection). One position at a time, 100% of cash per entry. Deterministic: no clock, no randomness, no network, no files outside the repo.

Dev window (24h before the opening): net PnL +$21.44 on $1,000, 6 trades, max drawdown 1.51%.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=thr15azb&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
