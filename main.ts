// Momentum breakout bot for cbBTC (CBBTC/USDC), 1-minute bars, long only.
//
// Idea: cbBTC trends in bursts. Enter when price breaks above the highest
// close of the last 20 bars while the fast EMA sits above the slow EMA and
// RSI(14) confirms momentum (>= 50). Ride the move with a trailing stop
// (armed at +30 bp, exit on a 30 bp pullback from the peak since entry), a
// hard stop at -40 bp, an RSI <= 30 exit, and a 240-bar max hold. After
// realised cash falls $10 below its realised peak, stop opening new trades
// for the rest of the window (chop protection). One position at a time,
// 100% of cash per entry. No clock, no randomness, no network, no files:
// every decision is a pure function of the bars received so far.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (tuned on the published dev window) ---
const BREAK_N = 20; // breakout lookback, bars
const RSI_MIN = 50; // momentum confirmation
const EMA_FAST = 9;
const EMA_SLOW = 30;
const SL_BP = -40; // hard stop, bp from average fill
const TRAIL_ARM_BP = 30; // trailing stop arms once up this far
const TRAIL_DROP_BP = 30; // ...then exits on this pullback from the peak
const RSI_EXIT = 30; // momentum gone
const MAX_HOLD = 240; // bars
const COOLDOWN = 5; // bars after an exit before a new entry
const HALT_USD = 10; // stop new entries once realised cash is this far below its peak
const MAX_SLIPPAGE_BPS = 300;

const BPS = 10000;

const closes: number[] = []; // closes in USDC per cbBTC, in arrival order
const emaFast: (number | null)[] = [];
const emaSlow: (number | null)[] = [];
const rsiArr: (number | null)[] = [];

let avgFill = 0; // average fill price of the open position (USDC)
let fillQty = 0; // quantity units (1e-8 cbBTC) the avg fill covers
let peak = 0; // highest close since entry (USDC)
let entrySeq = -1; // seq of the batch in which the buy filled
let cooldownUntil = -1; // earliest seq a new entry may be decided on
let peakCash = 1000_000_000n; // realised peak cash, quote units (1e-6 USDC)
let halted = false;

function pushClose(c: number): void {
  const i = closes.length;
  closes.push(c);
  emaFast.push(emaStep(emaFast, closes, EMA_FAST, i));
  emaSlow.push(emaStep(emaSlow, closes, EMA_SLOW, i));
  rsiArr.push(rsiStep(closes, i));
}

function emaStep(series: (number | null)[], data: number[], period: number, i: number): number | null {
  const k = 2 / (period + 1);
  if (i === period - 1) {
    let s = 0;
    for (let j = 0; j < period; j++) s += data[j];
    return s / period;
  }
  if (i < period - 1) return null;
  const prev = series[i - 1];
  if (prev === null) return null;
  return data[i] * k + prev * (1 - k);
}

function rsiStep(data: number[], i: number): number | null {
  const period = 14;
  if (i < period) return null;
  if (i === period) {
    let ag = 0;
    let al = 0;
    for (let j = 1; j <= period; j++) {
      const d = data[j] - data[j - 1];
      if (d > 0) ag += d;
      else al -= d;
    }
    ag /= period;
    al /= period;
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  // Wilder smoothing from the previous averages; recover them from the
  // previous RSI value is impossible, so keep running averages in closure.
  return rsiSmooth(data, i);
}

// Running Wilder averages, kept in module state so rsiStep stays pure-ish.
let rsiAvgGain = 0;
let rsiAvgLoss = 0;
let rsiSeeded = false;

function rsiSmooth(data: number[], i: number): number | null {
  const period = 14;
  if (!rsiSeeded) {
    // Seed from the first `period` changes (bars 1..14), exactly as the
    // i === period branch above does.
    let ag = 0;
    let al = 0;
    for (let j = 1; j <= period; j++) {
      const d = data[j] - data[j - 1];
      if (d > 0) ag += d;
      else al -= d;
    }
    rsiAvgGain = ag / period;
    rsiAvgLoss = al / period;
    rsiSeeded = true;
  }
  const d = data[i] - data[i - 1];
  rsiAvgGain = (rsiAvgGain * (period - 1) + Math.max(d, 0)) / period;
  rsiAvgLoss = (rsiAvgLoss * (period - 1) + Math.max(-d, 0)) / period;
  return rsiAvgLoss === 0 ? 100 : 100 - 100 / (1 + rsiAvgGain / rsiAvgLoss);
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Fold this batch's fills into the position bookkeeping.
    for (const f of batch.fills) {
      if (f.symbol !== SYMBOL) continue;
      if (f.status !== 'filled') continue;
      const price = Number(f.price) / 1e5; // price_scale 5
      const qty = Number(f.qty); // qty_scale 8
      if (f.side === 'buy') {
        avgFill = (avgFill * fillQty + price * qty) / (fillQty + qty);
        fillQty += qty;
        peak = avgFill;
        entrySeq = batch.seq;
      }
    }
    const pos = state.positions.get(SYMBOL);
    const heldQty = pos === undefined ? 0n : pos.qty;
    if (heldQty === 0n) {
      avgFill = 0;
      fillQty = 0;
      peak = 0;
      entrySeq = -1;
      // Realised-cash peak / halt: only while flat.
      if (state.cash > peakCash) peakCash = state.cash;
      if (!halted && peakCash - state.cash >= BigInt(HALT_USD) * 1_000_000n) halted = true;
    }

    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c) / 1e5;
    pushClose(close);
    const n = closes.length;
    const rsi = rsiArr[n - 1] ?? null;
    const ef = emaFast[n - 1] ?? null;
    const es = emaSlow[n - 1] ?? null;

    if (state.warmingUp) return [];

    // --- exits ---
    if (heldQty > 0n && avgFill > 0) {
      if (close > peak) peak = close;
      const retBp = ((close / avgFill - 1) * BPS) | 0;
      const trailBp = peak > 0 ? (((peak - close) / peak) * BPS) | 0 : 0;
      let exit = false;
      if (retBp <= SL_BP) exit = true;
      else if (retBp >= TRAIL_ARM_BP && trailBp >= TRAIL_DROP_BP) exit = true;
      else if (rsi !== null && rsi <= RSI_EXIT) exit = true;
      else if (entrySeq >= 0 && batch.seq - entrySeq >= MAX_HOLD) exit = true;
      if (exit) {
        cooldownUntil = batch.seq + COOLDOWN;
        return [{ side: 'sell', symbol: SYMBOL, qty: heldQty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // --- entries (flat only) ---
    if (halted || batch.seq < cooldownUntil) return [];
    if (state.cash <= 0n) return [];
    if (n <= BREAK_N || ef === null || es === null || rsi === null) return [];
    let prevHigh = 0;
    for (let j = n - BREAK_N - 1; j < n - 1; j++) if (closes[j]! > prevHigh) prevHigh = closes[j]!;
    if (close > prevHigh && rsi >= RSI_MIN && ef > es) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
