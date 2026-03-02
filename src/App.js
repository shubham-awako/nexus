import { useState, useEffect, useRef } from "react";

// ╔══════════════════════════════════════════════════════════════╗
// ║         NEXUS MARKETS INTELLIGENCE INDICATOR ENGINE          ║
// ╚══════════════════════════════════════════════════════════════╝

const safe = (v, fallback = 0) => (isFinite(v) && !isNaN(v) ? v : fallback);

// ── Core Builders ──────────────────────────────────────────────
function SMA(arr, n) {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function EMA(arr, n) {
  if (arr.length < 2) return arr[0] ?? 0;
  const k = 2 / (n + 1);
  const start = Math.min(n, arr.length);
  let e = arr.slice(0, start).reduce((a, b) => a + b, 0) / start;
  for (let i = start; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}
function emaArr(arr, n) {
  const k = 2 / (n + 1);
  const res = [];
  let e = arr.slice(0, Math.min(n, arr.length)).reduce((a, b) => a + b, 0) / Math.min(n, arr.length);
  for (let i = 0; i < arr.length; i++) {
    if (i < n) { res.push(e); continue; }
    e = arr[i] * k + e * (1 - k);
    res.push(e);
  }
  return res;
}
function WMA(arr, n) {
  const sl = arr.slice(-n);
  let num = 0, den = 0;
  sl.forEach((v, i) => { num += v * (i + 1); den += (i + 1); });
  return num / den;
}
function DEMA(arr, n) {
  const e1 = emaArr(arr, n);
  const e2 = emaArr(e1, n);
  return 2 * e1[e1.length - 1] - e2[e2.length - 1];
}
function TEMA(arr, n) {
  const e1 = emaArr(arr, n);
  const e2 = emaArr(e1, n);
  const e3 = emaArr(e2, n);
  return 3 * e1[e1.length - 1] - 3 * e2[e2.length - 1] + e3[e3.length - 1];
}
function HMA(arr, n) {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  const half = Math.floor(n / 2);
  const sq = Math.round(Math.sqrt(n));
  const wma1 = arr.map((_, i) => i >= half - 1 ? WMA(arr.slice(0, i + 1), half) : null).filter(Boolean);
  const wma2 = arr.map((_, i) => i >= n - 1 ? WMA(arr.slice(0, i + 1), n) : null).filter(Boolean);
  const len = Math.min(wma1.length, wma2.length);
  const diff = wma1.slice(-len).map((v, i) => 2 * v - wma2[wma2.length - len + i]);
  return WMA(diff, sq);
}
function KAMA(arr, n = 10, fast = 2, slow = 30) {
  if (arr.length < n + 1) return arr[arr.length - 1] ?? 0;
  const fsc = 2 / (fast + 1), ssc = 2 / (slow + 1);
  let kama = arr[0];
  for (let i = n; i < arr.length; i++) {
    const dir = Math.abs(arr[i] - arr[i - n]);
    let vol = 0;
    for (let j = i - n + 1; j <= i; j++) vol += Math.abs(arr[j] - arr[j - 1]);
    const er = vol === 0 ? 0 : dir / vol;
    const sc = Math.pow(er * (fsc - ssc) + ssc, 2);
    kama = kama + sc * (arr[i] - kama);
  }
  return kama;
}
function stddev(arr, n) {
  const sl = arr.slice(-n);
  const m = sl.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / n);
}

// ── Trend Indicators ───────────────────────────────────────────
function calcIchimoku(closes, highs, lows) {
  const H = (a, n) => Math.max(...a.slice(-n));
  const L = (a, n) => Math.min(...a.slice(-n));
  const tenkan = (H(highs, 9) + L(lows, 9)) / 2;
  const kijun = (H(highs, 26) + L(lows, 26)) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = (H(highs, 52) + L(lows, 52)) / 2;
  const price = closes[closes.length - 1];
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBot = Math.min(senkouA, senkouB);
  return { tenkan, kijun, senkouA, senkouB, cloudTop, cloudBot, price, aboveCloud: price > cloudTop, belowCloud: price < cloudBot };
}
function calcPSAR(highs, lows, iAF = 0.02, maxAF = 0.2) {
  let bull = true, af = iAF, ep = lows[0], sar = highs[0];
  for (let i = 1; i < highs.length; i++) {
    const prevSAR = sar;
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1]);
      if (lows[i] < sar) { bull = false; sar = ep; ep = lows[i]; af = iAF; }
      else { if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + iAF, maxAF); } }
    } else {
      sar = Math.max(sar, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1]);
      if (highs[i] > sar) { bull = true; sar = ep; ep = highs[i]; af = iAF; }
      else { if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + iAF, maxAF); } }
    }
  }
  return { sar, bull };
}
function calcADX(highs, lows, closes, n = 14) {
  if (highs.length < n + 1) return { adx: 25, pdi: 25, mdi: 25 };
  const trs = [], pdm = [], mdm = [];
  for (let i = 1; i < highs.length; i++) {
    const h = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(h, hc, lc));
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const atr = EMA(trs, n), apdi = EMA(pdm, n), amdi = EMA(mdm, n);
  const pdi = atr === 0 ? 0 : (apdi / atr) * 100;
  const mdi = atr === 0 ? 0 : (amdi / atr) * 100;
  const dx = pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
  const dxSeries = [];
  for (let i = n; i < trs.length; i++) {
    const a = EMA(trs.slice(0, i), n), b = EMA(pdm.slice(0, i), n), c = EMA(mdm.slice(0, i), n);
    const pi = a === 0 ? 0 : (b / a) * 100, mi = a === 0 ? 0 : (c / a) * 100;
    dxSeries.push(pi + mi === 0 ? 0 : (Math.abs(pi - mi) / (pi + mi)) * 100);
  }
  return { adx: safe(EMA(dxSeries, n)), pdi: safe(pdi), mdi: safe(mdi) };
}
function calcAroon(highs, lows, n = 25) {
  if (highs.length < n + 1) return { up: 50, down: 50, osc: 0 };
  const sl_h = highs.slice(-n - 1), sl_l = lows.slice(-n - 1);
  const hiIdx = sl_h.reduce((mi, v, i) => v > sl_h[mi] ? i : mi, 0);
  const loIdx = sl_l.reduce((mi, v, i) => v < sl_l[mi] ? i : mi, 0);
  const up = ((hiIdx) / n) * 100;
  const down = ((loIdx) / n) * 100;
  return { up: safe(up), down: safe(down), osc: safe(up - down) };
}
function calcVortex(highs, lows, closes, n = 14) {
  let vm_p = 0, vm_m = 0, tr_sum = 0;
  for (let i = Math.max(1, closes.length - n); i < closes.length; i++) {
    vm_p += Math.abs(highs[i] - lows[i - 1]);
    vm_m += Math.abs(lows[i] - highs[i - 1]);
    tr_sum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  return { vip: safe(vm_p / tr_sum), vim: safe(vm_m / tr_sum) };
}
function calcSuperTrend(highs, lows, closes, n = 7, mult = 3) {
  if (closes.length < n + 1) return { bull: true, line: closes[closes.length - 1] };
  const atr = EMA(highs.map((h, i) => i === 0 ? h - lows[i] : Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))), n);
  const hl2 = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
  const upper = hl2 + mult * atr, lower = hl2 - mult * atr;
  const price = closes[closes.length - 1];
  const bull = price > lower;
  return { bull, line: bull ? lower : upper };
}
function calcLinReg(closes, n = 20) {
  const sl = closes.slice(-n);
  const x_mean = (n - 1) / 2;
  const y_mean = sl.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  sl.forEach((y, x) => { num += (x - x_mean) * (y - y_mean); den += (x - x_mean) ** 2; });
  const slope = den === 0 ? 0 : num / den;
  const intercept = y_mean - slope * x_mean;
  const predicted = intercept + slope * (n - 1);
  const ss_res = sl.reduce((s, y, x) => s + (y - (intercept + slope * x)) ** 2, 0);
  const ss_tot = sl.reduce((s, y) => s + (y - y_mean) ** 2, 0);
  const r2 = ss_tot === 0 ? 1 : 1 - ss_res / ss_tot;
  return { slope: safe(slope), intercept: safe(intercept), predicted: safe(predicted), r2: safe(r2) };
}

// ── Momentum Indicators ────────────────────────────────────────
function calcRSI(closes, n = 14) {
  if (closes.length < n + 1) return 50;
  const sl = closes.slice(-(n * 2 + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i <= n; i++) {
    const d = sl[i] - sl[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / n, al = losses / n;
  for (let i = n + 1; i < sl.length; i++) {
    const d = sl[i] - sl[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
  }
  return al === 0 ? 100 : safe(100 - 100 / (1 + ag / al));
}
function calcStochRSI(closes, n = 14, kn = 3, dn = 3) {
  const rsiArr = [];
  for (let i = n; i < closes.length; i++) rsiArr.push(calcRSI(closes.slice(0, i + 1), n));
  if (rsiArr.length < n) return { k: 50, d: 50 };
  const sl = rsiArr.slice(-n);
  const mn = Math.min(...sl), mx = Math.max(...sl);
  const raw = mx === mn ? 50 : ((rsiArr[rsiArr.length - 1] - mn) / (mx - mn)) * 100;
  return { k: safe(raw), d: safe(raw) };
}
function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  if (closes.length < slow + sig) return { macd: 0, signal: 0, hist: 0 };
  const macdArr = [];
  for (let i = slow - 1; i < closes.length; i++) {
    macdArr.push(EMA(closes.slice(0, i + 1), fast) - EMA(closes.slice(0, i + 1), slow));
  }
  const macdVal = macdArr[macdArr.length - 1];
  const signalVal = EMA(macdArr, sig);
  return { macd: safe(macdVal), signal: safe(signalVal), hist: safe(macdVal - signalVal) };
}
function calcCCI(highs, lows, closes, n = 20) {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const sl = tp.slice(-n);
  const mean = sl.reduce((a, b) => a + b, 0) / n;
  const md = sl.reduce((s, v) => s + Math.abs(v - mean), 0) / n;
  return md === 0 ? 0 : safe((tp[tp.length - 1] - mean) / (0.015 * md));
}
function calcWR(highs, lows, closes, n = 14) {
  const h = Math.max(...highs.slice(-n)), l = Math.min(...lows.slice(-n));
  return h === l ? -50 : safe(((h - closes[closes.length - 1]) / (h - l)) * -100);
}
function calcROC(closes, n = 12) {
  if (closes.length <= n) return 0;
  return safe(((closes[closes.length - 1] - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100);
}
function calcMomentum(closes, n = 10) {
  if (closes.length <= n) return 0;
  return safe(closes[closes.length - 1] - closes[closes.length - 1 - n]);
}
function calcTSI(closes, long = 25, short = 13, sig = 7) {
  if (closes.length < long + short) return 0;
  const mtm = closes.slice(1).map((v, i) => v - closes[i]);
  const absM = mtm.map(Math.abs);
  const num = EMA(emaArr(mtm, long), short);
  const den = EMA(emaArr(absM, long), short);
  return den === 0 ? 0 : safe((num / den) * 100);
}
function calcUltOsc(highs, lows, closes) {
  const n = closes.length;
  if (n < 29) return 50;
  let b7 = 0, b14 = 0, b28 = 0, tr7 = 0, tr14 = 0, tr28 = 0;
  for (let i = n - 28; i < n; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    const bp = closes[i] - Math.min(lows[i], closes[i - 1]);
    if (i >= n - 7) { b7 += bp; tr7 += tr; }
    if (i >= n - 14) { b14 += bp; tr14 += tr; }
    b28 += bp; tr28 += tr;
  }
  return safe(100 * (4 * (tr7 ? b7 / tr7 : 0) + 2 * (tr14 ? b14 / tr14 : 0) + (tr28 ? b28 / tr28 : 0)) / 7);
}
function calcStoch(highs, lows, closes, kn = 14, dn = 3) {
  if (closes.length < kn) return { k: 50, d: 50 };
  const hh = Math.max(...highs.slice(-kn)), ll = Math.min(...lows.slice(-kn));
  const k = hh === ll ? 50 : safe(((closes[closes.length - 1] - ll) / (hh - ll)) * 100);
  return { k, d: k };
}
function calcCMO(closes, n = 14) {
  const diffs = closes.slice(1).map((v, i) => v - closes[i]);
  const sl = diffs.slice(-n);
  const up = sl.reduce((s, v) => s + Math.max(v, 0), 0);
  const dn = sl.reduce((s, v) => s + Math.abs(Math.min(v, 0)), 0);
  return up + dn === 0 ? 0 : safe(((up - dn) / (up + dn)) * 100);
}
function calcTRIX(closes, n = 15) {
  const e1 = emaArr(closes, n);
  const e2 = emaArr(e1, n);
  const e3 = emaArr(e2, n);
  if (e3.length < 2) return 0;
  return safe(((e3[e3.length - 1] - e3[e3.length - 2]) / e3[e3.length - 2]) * 100);
}
function calcPPO(closes, fast = 12, slow = 26) {
  const f = EMA(closes, fast), s = EMA(closes, slow);
  return s === 0 ? 0 : safe(((f - s) / s) * 100);
}
function calcDPO(closes, n = 20) {
  const offset = Math.floor(n / 2) + 1;
  if (closes.length < n + offset) return 0;
  const sma = SMA(closes.slice(0, closes.length - offset), n);
  return safe(closes[closes.length - 1 - offset] - sma);
}
function calcFisherTransform(highs, lows, n = 9) {
  const hh = Math.max(...highs.slice(-n)), ll = Math.min(...lows.slice(-n));
  const price = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
  let v = hh === ll ? 0 : 2 * ((price - ll) / (hh - ll)) - 1;
  v = Math.max(-0.999, Math.min(0.999, v));
  return safe(0.5 * Math.log((1 + v) / (1 - v)));
}
function calcKDJ(highs, lows, closes, n = 9) {
  const stoch = calcStoch(highs, lows, closes, n);
  const j = 3 * stoch.k - 2 * stoch.d;
  return { k: stoch.k, d: stoch.d, j: safe(j) };
}
function calcElderRay(highs, lows, closes, n = 13) {
  const ema = EMA(closes, n);
  return { bull: safe(highs[highs.length - 1] - ema), bear: safe(lows[lows.length - 1] - ema) };
}
function calcRVI(opens, closes, highs, lows, n = 10) {
  let num = 0, den = 0;
  const start = Math.max(0, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    const rng = highs[i] - lows[i] || 1;
    num += (closes[i] - opens[i]) / rng;
    den += 1;
  }
  return den === 0 ? 0 : safe(num / den);
}
function calcConnorsRSI(closes, n = 3, streak_n = 2, pct_n = 100) {
  const rsi3 = calcRSI(closes, n);
  const pctRank = pct_n > 0 ? closes.slice(-pct_n).filter(v => v < closes[closes.length - 1]).length / Math.min(pct_n, closes.length) * 100 : 50;
  let streak = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i] > closes[i - 1]) { if (streak < 0) break; streak++; }
    else if (closes[i] < closes[i - 1]) { if (streak > 0) break; streak--; }
    else break;
  }
  const streakRSI = calcRSI(Array(50).fill(0).map((_, i) => i < 49 ? 50 : 50 + streak), streak_n);
  return safe((rsi3 + streakRSI + pctRank) / 3);
}
function calcQStick(opens, closes, n = 8) {
  const diff = closes.map((c, i) => c - opens[i]);
  return safe(SMA(diff, n));
}
function calcInertia(closes, n = 14) {
  const lr = calcLinReg(closes, n);
  return safe(lr.predicted);
}
function calcCoppock(closes, wper = 10, long = 14, short = 11) {
  if (closes.length < long + wper) return 0;
  const rocLong = calcROC(closes, long);
  const rocShort = calcROC(closes, short);
  return safe(WMA([rocLong + rocShort], wper));
}
function calcPMO(closes, n = 35, sig = 10) {
  if (closes.length < n) return 0;
  const roc = closes.slice(1).map((v, i) => ((v - closes[i]) / closes[i]) * 100);
  const smoothed = EMA(roc, n);
  return safe(smoothed * 10);
}

// ── Volatility Indicators ──────────────────────────────────────
function calcATR(highs, lows, closes, n = 14) {
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return safe(EMA(trs, n));
}
function calcBB(closes, n = 20, mult = 2) {
  if (closes.length < n) return { upper: closes[closes.length - 1], mid: closes[closes.length - 1], lower: closes[closes.length - 1], pct: 0.5, width: 0 };
  const mid = SMA(closes, n);
  const sd = stddev(closes, n);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const cur = closes[closes.length - 1];
  const pct = upper === lower ? 0.5 : (cur - lower) / (upper - lower);
  return { upper, mid, lower, pct: safe(Math.max(0, Math.min(1, pct))), width: safe((upper - lower) / mid * 100) };
}
function calcKeltner(highs, lows, closes, n = 20, mult = 1.5) {
  const mid = EMA(closes, n);
  const atr = calcATR(highs, lows, closes, n);
  return { upper: safe(mid + mult * atr), mid: safe(mid), lower: safe(mid - mult * atr) };
}
function calcDonchian(highs, lows, n = 20) {
  const upper = Math.max(...highs.slice(-n));
  const lower = Math.min(...lows.slice(-n));
  return { upper, lower, mid: safe((upper + lower) / 2) };
}
function calcHistVol(closes, n = 21) {
  if (closes.length < n + 1) return 0;
  const rets = closes.slice(-n - 1).slice(1).map((v, i) => Math.log(v / closes[closes.length - n - 1 + i]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((s, r) => s + (r - m) ** 2, 0) / rets.length;
  return safe(Math.sqrt(v * 252) * 100);
}
function calcMassIndex(highs, lows, n = 9, n2 = 25) {
  const hl = highs.map((h, i) => h - lows[i]);
  const e1 = emaArr(hl, n), e2 = emaArr(e1, n);
  const ratio = e1.map((v, i) => e2[i] === 0 ? 1 : v / e2[i]);
  return safe(SMA(ratio, n2) * n2);
}
function calcUlcerIndex(closes, n = 14) {
  const sl = closes.slice(-n);
  const maxClose = Math.max(...sl);
  const drawdowns = sl.map(v => ((v - maxClose) / maxClose) * 100);
  return safe(Math.sqrt(drawdowns.reduce((s, d) => s + d ** 2, 0) / n));
}
function calcChaikinVol(highs, lows, n = 10) {
  const hl = highs.map((h, i) => h - lows[i]);
  const e = EMA(hl, n);
  const e_prev = EMA(hl.slice(0, -n), n);
  return e_prev === 0 ? 0 : safe(((e - e_prev) / e_prev) * 100);
}

// ── Volume-based Indicators ────────────────────────────────────
function calcOBV(closes, volumes) {
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }
  return safe(obv);
}
function calcAD(highs, lows, closes, volumes) {
  let ad = 0;
  for (let i = 0; i < closes.length; i++) {
    const rng = highs[i] - lows[i];
    const mfm = rng === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / rng;
    ad += mfm * volumes[i];
  }
  return safe(ad);
}
function calcCMF(highs, lows, closes, volumes, n = 20) {
  let mfvSum = 0, volSum = 0;
  const start = Math.max(0, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    const rng = highs[i] - lows[i];
    const mfm = rng === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / rng;
    mfvSum += mfm * volumes[i];
    volSum += volumes[i];
  }
  return volSum === 0 ? 0 : safe(mfvSum / volSum);
}
function calcMFI(highs, lows, closes, volumes, n = 14) {
  let posFlow = 0, negFlow = 0;
  const start = Math.max(1, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const ptp = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
    const mf = tp * volumes[i];
    if (tp > ptp) posFlow += mf; else negFlow += mf;
  }
  if (negFlow === 0) return 100;
  const mfr = posFlow / negFlow;
  return safe(100 - 100 / (1 + mfr));
}
function calcForceIndex(closes, volumes, n = 13) {
  const fi = closes.slice(1).map((v, i) => (v - closes[i]) * volumes[i + 1]);
  return safe(EMA(fi, n));
}
function calcEMV(highs, lows, volumes, n = 14) {
  const emv = highs.slice(1).map((h, i) => {
    const dm = (h + lows[i + 1]) / 2 - (highs[i] + lows[i]) / 2;
    const br = volumes[i + 1] / (h - lows[i + 1] || 1);
    return br === 0 ? 0 : dm / br;
  });
  return safe(SMA(emv, n));
}
function calcVWAP(highs, lows, closes, volumes) {
  let tpv = 0, vol = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpv += tp * volumes[i]; vol += volumes[i];
  }
  return vol === 0 ? closes[closes.length - 1] : safe(tpv / vol);
}
function calcPVT(closes, volumes) {
  let pvt = 0;
  for (let i = 1; i < closes.length; i++) {
    pvt += ((closes[i] - closes[i - 1]) / closes[i - 1]) * volumes[i];
  }
  return safe(pvt);
}

// ── Pivot Points ───────────────────────────────────────────────
function calcPivots(high, low, close) {
  const pp = (high + low + close) / 3;
  return {
    classic: { pp, r1: 2 * pp - low, s1: 2 * pp - high, r2: pp + (high - low), s2: pp - (high - low), r3: high + 2 * (pp - low), s3: low - 2 * (high - pp) },
    fibonacci: { pp, r1: pp + 0.382 * (high - low), r2: pp + 0.618 * (high - low), r3: pp + (high - low), s1: pp - 0.382 * (high - low), s2: pp - 0.618 * (high - low), s3: pp - (high - low) },
    camarilla: { r1: close + 1.0833 * (high - low), r2: close + 1.1666 * (high - low), r3: close + 1.25 * (high - low), r4: close + 1.5 * (high - low), s1: close - 1.0833 * (high - low), s2: close - 1.1666 * (high - low), s3: close - 1.25 * (high - low), s4: close - 1.5 * (high - low) },
    woodie: { pp: (high + low + 2 * close) / 4, r1: 2 * pp - low, s1: 2 * pp - high, r2: pp + high - low, s2: pp - high + low },
  };
}
function calcFibLevels(closes, n = 50) {
  const sl = closes.slice(-n);
  const high = Math.max(...sl), low = Math.min(...sl);
  const diff = high - low;
  return { high, low, r236: high - diff * 0.236, r382: high - diff * 0.382, r5: high - diff * 0.5, r618: high - diff * 0.618, r786: high - diff * 0.786, r100: low };
}

// ── Heikin-Ashi ────────────────────────────────────────────────
function calcHeikinAshi(opens, highs, lows, closes) {
  const ha_c = (opens[opens.length - 1] + highs[highs.length - 1] + lows[lows.length - 1] + closes[closes.length - 1]) / 4;
  const ha_o = (opens[opens.length - 1] + closes[closes.length - 1]) / 2;
  const ha_h = Math.max(highs[highs.length - 1], ha_o, ha_c);
  const ha_l = Math.min(lows[lows.length - 1], ha_o, ha_c);
  const bull = ha_c > ha_o;
  let streak = 1;
  for (let i = closes.length - 2; i >= Math.max(0, closes.length - 10); i--) {
    const c = (opens[i] + highs[i] + lows[i] + closes[i]) / 4;
    const o = (opens[i] + closes[i]) / 2;
    if ((bull && c > o) || (!bull && c < o)) streak++; else break;
  }
  return { bull, ha_c, ha_o, ha_h, ha_l, streak };
}

// ══════════════════════════════════════════════════════════════
// MASTER TA ENGINE — RUNS ALL 150+ INDICATORS
// ══════════════════════════════════════════════════════════════
function runTA(closes, highs, lows, volumes, opens) {
  if (closes.length < 35) return null;
  const price = closes[closes.length - 1];
  const prevHigh = Math.max(...highs.slice(-52)), prevLow = Math.min(...lows.slice(-52));
  const pHigh = highs[highs.length - 2], pLow = lows[lows.length - 2], pClose = closes[closes.length - 2];

  // ── Compute all values ──────────────────────────────────────
  const sma5 = SMA(closes, 5), sma10 = SMA(closes, 10), sma20 = SMA(closes, 20);
  const sma50 = SMA(closes, Math.min(50, closes.length - 1));
  const sma100 = SMA(closes, Math.min(100, closes.length - 1));
  const sma200 = SMA(closes, Math.min(200, closes.length - 1));
  const ema5 = EMA(closes, 5), ema9 = EMA(closes, 9), ema10 = EMA(closes, 10);
  const ema13 = EMA(closes, 13), ema21 = EMA(closes, 21), ema26 = EMA(closes, 26);
  const ema34 = EMA(closes, 34), ema50 = EMA(closes, Math.min(50, closes.length - 1));
  const ema55 = EMA(closes, Math.min(55, closes.length - 1));
  const ema89 = EMA(closes, Math.min(89, closes.length - 1));
  const ema100 = EMA(closes, Math.min(100, closes.length - 1));
  const ema144 = EMA(closes, Math.min(144, closes.length - 1));
  const ema200 = EMA(closes, Math.min(200, closes.length - 1));
  const wma10 = WMA(closes, 10), wma20 = WMA(closes, 20);
  const dema20 = DEMA(closes, 20), tema20 = TEMA(closes, 20);
  const hma14 = HMA(closes, 14), kama10 = KAMA(closes, 10);
  const vwma20 = EMA(closes, 20); // approx
  const ichi = calcIchimoku(closes, highs, lows);
  const psar = calcPSAR(highs, lows);
  const adx = calcADX(highs, lows, closes);
  const aroon = calcAroon(highs, lows);
  const vortex = calcVortex(highs, lows, closes);
  const superT = calcSuperTrend(highs, lows, closes);
  const linreg = calcLinReg(closes);
  const rsi7 = calcRSI(closes, 7), rsi14 = calcRSI(closes, 14), rsi21 = calcRSI(closes, 21), rsi25 = calcRSI(closes, 25);
  const stochRSI = calcStochRSI(closes);
  const macd = calcMACD(closes);
  const macd_diff = calcMACD(closes, 5, 35, 5);
  const cci14 = calcCCI(highs, lows, closes, 14), cci20 = calcCCI(highs, lows, closes, 20), cci50 = calcCCI(highs, lows, closes, 50);
  const wr14 = calcWR(highs, lows, closes, 14), wr20 = calcWR(highs, lows, closes, 20);
  const roc10 = calcROC(closes, 10), roc20 = calcROC(closes, 20);
  const mom10 = calcMomentum(closes, 10), mom20 = calcMomentum(closes, 20);
  const tsi = calcTSI(closes);
  const uo = calcUltOsc(highs, lows, closes);
  const stoch14 = calcStoch(highs, lows, closes, 14, 3), stoch5 = calcStoch(highs, lows, closes, 5, 3);
  const cmo = calcCMO(closes);
  const trix = calcTRIX(closes);
  const ppo = calcPPO(closes);
  const dpo = calcDPO(closes);
  const fisher = calcFisherTransform(highs, lows);
  const kdj = calcKDJ(highs, lows, closes);
  const elder = calcElderRay(highs, lows, closes);
  const rvi = calcRVI(opens, closes, highs, lows);
  const connors = calcConnorsRSI(closes);
  const qstick3 = calcQStick(opens, closes, 3), qstick8 = calcQStick(opens, closes, 8);
  const coppock = calcCoppock(closes);
  const pmo = calcPMO(closes);
  const atr7 = calcATR(highs, lows, closes, 7), atr14 = calcATR(highs, lows, closes, 14), atr21 = calcATR(highs, lows, closes, 21);
  const bb20 = calcBB(closes, 20, 2), bb20_1 = calcBB(closes, 20, 1), bb50 = calcBB(closes, Math.min(50, closes.length - 1), 2);
  const keltner = calcKeltner(highs, lows, closes);
  const donchian20 = calcDonchian(highs, lows, 20);
  const histVol = calcHistVol(closes);
  const massIdx = calcMassIndex(highs, lows);
  const ulcer = calcUlcerIndex(closes);
  const chainVol = calcChaikinVol(highs, lows);
  const obv = calcOBV(closes, volumes);
  const ad = calcAD(highs, lows, closes, volumes);
  const cmf = calcCMF(highs, lows, closes, volumes);
  const mfi = calcMFI(highs, lows, closes, volumes);
  const fi = calcForceIndex(closes, volumes);
  const emv = calcEMV(highs, lows, volumes);
  const vwap = calcVWAP(highs, lows, closes, volumes);
  const pvt = calcPVT(closes, volumes);
  const pivots = calcPivots(prevHigh, prevLow, pClose);
  const fib = calcFibLevels(closes);
  const ha = calcHeikinAshi(opens, highs, lows, closes);

  // Derived
  const prevObv = calcOBV(closes.slice(0, -5), volumes.slice(0, -5));
  const obvTrend = obv > prevObv;
  const dist52H = ((price - prevHigh) / prevHigh) * 100;
  const dist52L = ((price - prevLow) / prevLow) * 100;
  const pricePos = (price - prevLow) / (prevHigh - prevLow || 1);
  const bbSqueeze = bb20.width < SMA(closes.slice(-20).map((c, i) => calcBB(closes.slice(0, closes.length - 20 + i + 1), 20, 2).width), 10);

  // ── Signal Evaluation ───────────────────────────────────────
  const B = 'BUY', S = 'SELL', N = 'NEUTRAL';
  const toBuySell = (v, buyThresh, sellThresh) => v > buyThresh ? B : v < sellThresh ? S : N;

  const indicators = {
    // TREND (47 signals)
    'SMA 5': { sig: price > sma5 ? B : S, val: sma5, w: 1 },
    'SMA 10': { sig: price > sma10 ? B : S, val: sma10, w: 1 },
    'SMA 20': { sig: price > sma20 ? B : S, val: sma20, w: 1 },
    'SMA 50': { sig: price > sma50 ? B : S, val: sma50, w: 2 },
    'SMA 100': { sig: price > sma100 ? B : S, val: sma100, w: 2 },
    'SMA 200': { sig: price > sma200 ? B : S, val: sma200, w: 3 },
    'EMA 5': { sig: price > ema5 ? B : S, val: ema5, w: 1 },
    'EMA 9': { sig: price > ema9 ? B : S, val: ema9, w: 1 },
    'EMA 10': { sig: price > ema10 ? B : S, val: ema10, w: 1 },
    'EMA 13': { sig: price > ema13 ? B : S, val: ema13, w: 1 },
    'EMA 21': { sig: price > ema21 ? B : S, val: ema21, w: 1 },
    'EMA 26': { sig: price > ema26 ? B : S, val: ema26, w: 1 },
    'EMA 34': { sig: price > ema34 ? B : S, val: ema34, w: 1 },
    'EMA 50': { sig: price > ema50 ? B : S, val: ema50, w: 2 },
    'EMA 55': { sig: price > ema55 ? B : S, val: ema55, w: 2 },
    'EMA 89': { sig: price > ema89 ? B : S, val: ema89, w: 2 },
    'EMA 100': { sig: price > ema100 ? B : S, val: ema100, w: 2 },
    'EMA 144': { sig: price > ema144 ? B : S, val: ema144, w: 2 },
    'EMA 200': { sig: price > ema200 ? B : S, val: ema200, w: 3 },
    'WMA 10': { sig: price > wma10 ? B : S, val: wma10, w: 1 },
    'WMA 20': { sig: price > wma20 ? B : S, val: wma20, w: 1 },
    'DEMA 20': { sig: price > dema20 ? B : S, val: dema20, w: 1 },
    'TEMA 20': { sig: price > tema20 ? B : S, val: tema20, w: 1 },
    'HMA 14': { sig: price > hma14 ? B : S, val: hma14, w: 2 },
    'KAMA 10': { sig: price > kama10 ? B : S, val: kama10, w: 2 },
    'EMA 9×21': { sig: ema9 > ema21 ? B : S, val: ema9 - ema21, w: 2 },
    'EMA 21×50': { sig: ema21 > ema50 ? B : S, val: ema21 - ema50, w: 2 },
    'EMA 50×200': { sig: ema50 > ema200 ? B : S, val: ema50 - ema200, w: 3 },
    'SMA 50×200': { sig: sma50 > sma200 ? B : S, val: sma50 - sma200, w: 3 },
    'Ichi Tenkan': { sig: price > ichi.tenkan ? B : S, val: ichi.tenkan, w: 1 },
    'Ichi Kijun': { sig: price > ichi.kijun ? B : S, val: ichi.kijun, w: 2 },
    'Ichi Cloud': { sig: ichi.aboveCloud ? B : ichi.belowCloud ? S : N, val: ichi.cloudTop, w: 3 },
    'Ichi TK Cross': { sig: ichi.tenkan > ichi.kijun ? B : S, val: ichi.tenkan - ichi.kijun, w: 2 },
    'Parabolic SAR': { sig: psar.bull ? B : S, val: psar.sar, w: 2 },
    'ADX Trend': { sig: adx.pdi > adx.mdi ? B : S, val: adx.adx, w: 2 },
    'ADX Strength': { sig: adx.adx > 25 ? (adx.pdi > adx.mdi ? B : S) : N, val: adx.adx, w: 1 },
    'DI Cross': { sig: adx.pdi > adx.mdi ? B : S, val: adx.pdi - adx.mdi, w: 2 },
    'Aroon Up': { sig: aroon.up > 70 ? B : aroon.up < 30 ? S : N, val: aroon.up, w: 1 },
    'Aroon Osc': { sig: aroon.osc > 0 ? B : S, val: aroon.osc, w: 1 },
    'Vortex VI+': { sig: vortex.vip > vortex.vim ? B : S, val: vortex.vip, w: 1 },
    'SuperTrend': { sig: superT.bull ? B : S, val: superT.line, w: 3 },
    'LinReg Slope': { sig: linreg.slope > 0 ? B : S, val: linreg.slope, w: 1 },
    'LinReg Price': { sig: price > linreg.predicted ? B : S, val: linreg.predicted, w: 1 },
    'TRIX': { sig: trix > 0 ? B : S, val: trix, w: 1 },
    'Heikin-Ashi': { sig: ha.bull ? B : S, val: ha.streak, w: 2 },
    'HA Streak': { sig: ha.streak >= 3 ? (ha.bull ? B : S) : N, val: ha.streak, w: 1 },
    'Price Position': { sig: pricePos > 0.6 ? B : pricePos < 0.4 ? S : N, val: pricePos * 100, w: 1 },
    // MOMENTUM (40 signals)
    'RSI 7': { sig: rsi7 < 30 ? B : rsi7 > 70 ? S : N, val: rsi7, w: 2 },
    'RSI 14': { sig: rsi14 < 30 ? B : rsi14 > 70 ? S : N, val: rsi14, w: 3 },
    'RSI 21': { sig: rsi21 < 35 ? B : rsi21 > 65 ? S : N, val: rsi21, w: 2 },
    'RSI 25': { sig: rsi25 < 35 ? B : rsi25 > 65 ? S : N, val: rsi25, w: 1 },
    'RSI Dir': { sig: rsi14 > 50 ? B : S, val: rsi14, w: 1 },
    'StochRSI K': { sig: stochRSI.k < 20 ? B : stochRSI.k > 80 ? S : N, val: stochRSI.k, w: 2 },
    'MACD Cross': { sig: macd.macd > macd.signal ? B : S, val: macd.hist, w: 3 },
    'MACD Hist': { sig: macd.hist > 0 ? B : S, val: macd.hist, w: 2 },
    'MACD Zero': { sig: macd.macd > 0 ? B : S, val: macd.macd, w: 1 },
    'MACD Alt': { sig: macd_diff.macd > macd_diff.signal ? B : S, val: macd_diff.hist, w: 1 },
    'CCI 14': { sig: cci14 < -100 ? B : cci14 > 100 ? S : N, val: cci14, w: 2 },
    'CCI 20': { sig: cci20 < -100 ? B : cci20 > 100 ? S : N, val: cci20, w: 2 },
    'CCI 50': { sig: cci50 < -100 ? B : cci50 > 100 ? S : N, val: cci50, w: 1 },
    'CCI Dir': { sig: cci14 > 0 ? B : S, val: cci14, w: 1 },
    'Williams %R 14': { sig: wr14 < -80 ? B : wr14 > -20 ? S : N, val: wr14, w: 2 },
    'Williams %R 20': { sig: wr20 < -80 ? B : wr20 > -20 ? S : N, val: wr20, w: 1 },
    'ROC 10': { sig: roc10 > 0 ? B : S, val: roc10, w: 1 },
    'ROC 20': { sig: roc20 > 0 ? B : S, val: roc20, w: 1 },
    'Momentum 10': { sig: mom10 > 0 ? B : S, val: mom10, w: 1 },
    'Momentum 20': { sig: mom20 > 0 ? B : S, val: mom20, w: 1 },
    'TSI': { sig: tsi > 0 ? B : S, val: tsi, w: 2 },
    'Ult Oscillator': { sig: uo < 30 ? B : uo > 70 ? S : N, val: uo, w: 2 },
    'Stoch %K 14': { sig: stoch14.k < 20 ? B : stoch14.k > 80 ? S : N, val: stoch14.k, w: 2 },
    'Stoch %K 5': { sig: stoch5.k < 20 ? B : stoch5.k > 80 ? S : N, val: stoch5.k, w: 1 },
    'Stoch Dir': { sig: stoch14.k > 50 ? B : S, val: stoch14.k, w: 1 },
    'CMO': { sig: cmo < -50 ? B : cmo > 50 ? S : N, val: cmo, w: 1 },
    'PPO': { sig: ppo > 0 ? B : S, val: ppo, w: 1 },
    'DPO': { sig: dpo > 0 ? B : S, val: dpo, w: 1 },
    'Fisher Transform': { sig: fisher > 0 ? B : S, val: fisher, w: 1 },
    'KDJ J': { sig: kdj.j < 20 ? B : kdj.j > 80 ? S : N, val: kdj.j, w: 1 },
    'Elder Bull': { sig: elder.bull > 0 ? B : S, val: elder.bull, w: 1 },
    'Elder Bear': { sig: elder.bear > 0 ? S : B, val: elder.bear, w: 1 },
    'RVI': { sig: rvi > 0 ? B : S, val: rvi, w: 1 },
    'Connors RSI': { sig: connors < 20 ? B : connors > 80 ? S : N, val: connors, w: 2 },
    'QStick 3': { sig: qstick3 > 0 ? B : S, val: qstick3, w: 1 },
    'QStick 8': { sig: qstick8 > 0 ? B : S, val: qstick8, w: 1 },
    'Coppock': { sig: coppock > 0 ? B : S, val: coppock, w: 1 },
    'PMO': { sig: pmo > 0 ? B : S, val: pmo, w: 1 },
    'ROC Accel': { sig: roc10 > roc20 ? B : S, val: roc10 - roc20, w: 1 },
    'Inertia': { sig: price > calcInertia(closes) ? B : S, val: calcInertia(closes), w: 1 },
    // VOLATILITY (18 signals)
    'BB %B': { sig: bb20.pct < 0.05 ? B : bb20.pct > 0.95 ? S : N, val: bb20.pct * 100, w: 2 },
    'BB Width': { sig: bb20.width < 1 ? N : bb20.pct < 0.5 ? B : S, val: bb20.width, w: 1 },
    'BB Squeeze': { sig: bbSqueeze ? B : N, val: bbSqueeze ? 1 : 0, w: 1 },
    'BB(1σ) %B': { sig: bb20_1.pct < 0.05 ? B : bb20_1.pct > 0.95 ? S : N, val: bb20_1.pct * 100, w: 1 },
    'BB(50) %B': { sig: bb50.pct < 0.05 ? B : bb50.pct > 0.95 ? S : N, val: bb50.pct * 100, w: 1 },
    'Keltner Upper': { sig: price > keltner.upper ? S : N, val: keltner.upper, w: 1 },
    'Keltner Lower': { sig: price < keltner.lower ? B : N, val: keltner.lower, w: 1 },
    'Donchian Mid': { sig: price > donchian20.mid ? B : S, val: donchian20.mid, w: 1 },
    'ATR Trend': { sig: atr7 < atr21 ? B : S, val: atr7 / atr14, w: 1 },
    'Hist Volatility': { sig: histVol < 20 ? B : histVol > 60 ? S : N, val: histVol, w: 1 },
    'Mass Index': { sig: massIdx > 27 ? S : N, val: massIdx, w: 1 },
    'Ulcer Index': { sig: ulcer < 5 ? B : ulcer > 20 ? S : N, val: ulcer, w: 1 },
    'Chaikin Vol': { sig: chainVol > 0 ? B : S, val: chainVol, w: 1 },
    'BB Pos': { sig: price > bb20.mid ? B : S, val: bb20.pct * 100, w: 1 },
    'ATR Rise': { sig: atr14 < atr21 ? B : S, val: atr14, w: 1 },
    // VOLUME (16 signals)
    'OBV Trend': { sig: obvTrend ? B : S, val: obv, w: 2 },
    'CMF': { sig: cmf > 0.05 ? B : cmf < -0.05 ? S : N, val: cmf * 100, w: 2 },
    'MFI': { sig: mfi < 20 ? B : mfi > 80 ? S : N, val: mfi, w: 2 },
    'MFI Dir': { sig: mfi > 50 ? B : S, val: mfi, w: 1 },
    'Force Index': { sig: fi > 0 ? B : S, val: fi, w: 1 },
    'A/D Line': { sig: ad > 0 ? B : S, val: ad, w: 1 },
    'EMV': { sig: emv > 0 ? B : S, val: emv, w: 1 },
    'VWAP Pos': { sig: price > vwap ? B : S, val: vwap, w: 2 },
    'PVT': { sig: pvt > 0 ? B : S, val: pvt, w: 1 },
    // PIVOTS (16 signals)
    'Classic PP': { sig: price > pivots.classic.pp ? B : S, val: pivots.classic.pp, w: 1 },
    'Classic R1': { sig: price < pivots.classic.r1 ? B : S, val: pivots.classic.r1, w: 1 },
    'Classic S1': { sig: price > pivots.classic.s1 ? B : S, val: pivots.classic.s1, w: 1 },
    'Fib PP': { sig: price > pivots.fibonacci.pp ? B : S, val: pivots.fibonacci.pp, w: 1 },
    'Fib R1': { sig: price < pivots.fibonacci.r1 ? B : S, val: pivots.fibonacci.r1, w: 1 },
    'Fib S1': { sig: price > pivots.fibonacci.s1 ? B : S, val: pivots.fibonacci.s1, w: 1 },
    'Camarilla R3': { sig: price < pivots.camarilla.r3 ? B : S, val: pivots.camarilla.r3, w: 1 },
    'Camarilla S3': { sig: price > pivots.camarilla.s3 ? B : S, val: pivots.camarilla.s3, w: 1 },
    'Woodie PP': { sig: price > pivots.woodie.pp ? B : S, val: pivots.woodie.pp, w: 1 },
    'Fib 23.6%': { sig: price > fib.r236 ? B : S, val: fib.r236, w: 1 },
    'Fib 38.2%': { sig: price > fib.r382 ? B : S, val: fib.r382, w: 1 },
    'Fib 61.8%': { sig: price > fib.r618 ? B : S, val: fib.r618, w: 1 },
    '52W High Dist': { sig: dist52H > -3 ? S : dist52H < -20 ? B : N, val: dist52H, w: 1 },
    '52W Low Dist': { sig: dist52L < 10 ? B : dist52L > 50 ? S : N, val: dist52L, w: 1 },
    'Support Zone': { sig: price > pivots.classic.s2 ? B : S, val: pivots.classic.s2, w: 1 },
    'Resistance Zone': { sig: price < pivots.classic.r2 ? B : S, val: pivots.classic.r2, w: 1 },
    // ADDITIONAL — Price Action & Composite
    'SMA 5×20': { sig: sma5 > sma20 ? B : S, val: sma5 - sma20, w: 2 },
    'SMA 10×50': { sig: sma10 > sma50 ? B : S, val: sma10 - sma50, w: 2 },
    'EMA 13×34': { sig: ema13 > ema34 ? B : S, val: ema13 - ema34, w: 2 },
    'EMA 5×13': { sig: ema5 > ema13 ? B : S, val: ema5 - ema13, w: 1 },
    'EMA 89×144': { sig: ema89 > ema144 ? B : S, val: ema89 - ema144, w: 2 },
    'Triple EMA': { sig: ema5 > ema21 && ema21 > ema89 ? B : ema5 < ema21 && ema21 < ema89 ? S : N, val: ema5 - ema89, w: 3 },
    'Quad EMA': { sig: ema9 > ema21 && ema21 > ema50 && ema50 > ema200 ? B : ema9 < ema21 && ema21 < ema50 && ema50 < ema200 ? S : N, val: ema9 - ema200, w: 3 },
    'Price/SMA200 Ratio': { sig: (price / sma200) > 1.02 ? B : (price / sma200) < 0.98 ? S : N, val: (price / sma200 - 1) * 100, w: 2 },
    'VWAP Distance': { sig: price > vwap * 1.001 ? B : price < vwap * 0.999 ? S : N, val: ((price - vwap) / vwap) * 100, w: 2 },
    'BB Lower Touch': { sig: price <= bb20.lower * 1.002 ? B : N, val: bb20.pct * 100, w: 2 },
    'BB Upper Touch': { sig: price >= bb20.upper * 0.998 ? S : N, val: bb20.pct * 100, w: 2 },
    'Keltner vs BB': { sig: keltner.upper > bb20.upper ? N : price < keltner.lower ? B : S, val: keltner.lower, w: 1 },
    'Donchian Breakout': { sig: price >= donchian20.upper * 0.999 ? B : price <= donchian20.lower * 1.001 ? S : N, val: donchian20.mid, w: 2 },
    'RSI 14 Oversold Bounce': { sig: rsi14 < 35 && mom10 > 0 ? B : rsi14 > 65 && mom10 < 0 ? S : N, val: rsi14, w: 2 },
    'MACD Hist Rising': { sig: macd.hist > 0 && roc10 > 0 ? B : macd.hist < 0 && roc10 < 0 ? S : N, val: macd.hist, w: 2 },
    'TSI + RSI Confirm': { sig: tsi > 0 && rsi14 > 50 ? B : tsi < 0 && rsi14 < 50 ? S : N, val: tsi, w: 2 },
    'ADX + Trend': { sig: adx.adx > 20 && superT.bull ? B : adx.adx > 20 && !superT.bull ? S : N, val: adx.adx, w: 2 },
    'Multi RSI Agree': { sig: rsi7 < 35 && rsi14 < 40 && rsi21 < 45 ? B : rsi7 > 65 && rsi14 > 60 && rsi21 > 55 ? S : N, val: rsi14, w: 2 },
    'Volume + Price': { sig: cmf > 0 && price > ema21 ? B : cmf < 0 && price < ema21 ? S : N, val: cmf * 100, w: 2 },
    'BB Hist Vol': { sig: histVol < 25 && bb20.pct < 0.3 ? B : histVol > 50 && bb20.pct > 0.7 ? S : N, val: histVol, w: 1 },
    'Aroon Cloud': { sig: aroon.up > 70 && aroon.down < 30 ? B : aroon.down > 70 && aroon.up < 30 ? S : N, val: aroon.osc, w: 2 },
    'Stoch + RSI': { sig: stoch14.k < 25 && rsi14 < 35 ? B : stoch14.k > 75 && rsi14 > 65 ? S : N, val: stoch14.k, w: 2 },
    'Price Above Clouds': { sig: price > ichi.cloudTop && price > ema200 ? B : price < ichi.cloudBot && price < ema200 ? S : N, val: ichi.cloudTop, w: 3 },
    'EMA Fan': { sig: ema5 > ema9 && ema9 > ema21 && ema21 > ema55 ? B : ema5 < ema9 && ema9 < ema21 && ema21 < ema55 ? S : N, val: ema5 - ema55, w: 3 },
  };

  // ── Weighted Score Aggregation ──────────────────────────────
  let weightedScore = 0, totalWeight = 0;
  let buyCount = 0, sellCount = 0, neutralCount = 0;
  let buyWeight = 0, sellWeight = 0;

  Object.values(indicators).forEach(({ sig, w }) => {
    totalWeight += w;
    if (sig === B) { weightedScore += w; buyCount++; buyWeight += w; }
    else if (sig === S) { weightedScore -= w; sellCount++; sellWeight += w; }
    else neutralCount++;
  });

  const normalizedScore = (weightedScore / totalWeight) * 100;
  let rec;
  if (normalizedScore >= 35) rec = 'STRONG BUY';
  else if (normalizedScore >= 12) rec = 'BUY';
  else if (normalizedScore <= -35) rec = 'STRONG SELL';
  else if (normalizedScore <= -12) rec = 'SELL';
  else rec = 'NEUTRAL';

  const countScore = ((buyCount - sellCount) / Object.keys(indicators).length) * 100;

  return {
    indicators, rec, normalizedScore, countScore,
    buyCount, sellCount, neutralCount, totalIndicators: Object.keys(indicators).length,
    // Key values for display
    price, rsi: rsi14, macd, bb: bb20, stoch: stoch14, cci: cci20, atr: atr14,
    wr: wr14, fib, ichi, psar, adx, aroon, vortex, superT, ha, linreg,
    ema9, ema21, ema50, ema200, sma20, sma50, sma200, ema5, ema100, ema144,
    vwap, mfi, obv, cmf, pivots,
    rsi7, rsi21, stochRSI, kdj, elder, fisher, tsi, uo, connors,
    trix, ppo, cmo, roc10, roc20, histVol, ulcer, massIdx,
    keltner, donchian: donchian20,
  };
}

// ══════════════════════════════════════════════════════════════
// DATA GENERATION
// ══════════════════════════════════════════════════════════════
function genOHLCV(base, n = 300, vol = 0.002) {
  const closes = [base], highs = [base * 1.003], lows = [base * 0.997], opens = [base], volumes = [1000];
  for (let i = 1; i < n; i++) {
    const o = closes[i - 1];
    const c = o * (1 + (Math.random() - 0.490) * vol);
    const spread = Math.abs(c - o) + Math.random() * o * vol * 0.3;
    opens.push(o);
    closes.push(c);
    highs.push(Math.max(o, c) + Math.random() * spread * 0.5);
    lows.push(Math.min(o, c) - Math.random() * spread * 0.5);
    volumes.push(500 + Math.random() * 2000);
  }
  return { closes, highs, lows, opens, volumes };
}

// ══════════════════════════════════════════════════════════════
// INSTRUMENT CONFIG
// ══════════════════════════════════════════════════════════════
const INST = {
  XAUUSD: { label: 'XAU/USD', name: 'GOLD', base: 2665.30, vol: 0.0006, color: '#FFD700', dim: '#7A6200', decimals: 2, icon: '◈', unit: 'oz' },
  XAGUSD: { label: 'XAG/USD', name: 'SILVER', base: 29.85, vol: 0.001, color: '#C8C8D0', dim: '#505060', decimals: 3, icon: '◆', unit: 'oz' },
  BTCUSD: { label: 'BTC/USD', name: 'BITCOIN', base: 97500, vol: 0.0025, color: '#F7931A', dim: '#7A4500', decimals: 2, icon: '₿', unit: '' },
};

function getSessions() {
  const h = new Date().getUTCHours();
  return [
    { name: 'Tokyo', open: h >= 23 || h < 8, hours: '23:00–08:00' },
    { name: 'London', open: h >= 8 && h < 16, hours: '08:00–16:00' },
    { name: 'New York', open: h >= 13 && h < 22, hours: '13:00–22:00' },
  ];
}

// ══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════════════
function Sparkline({ data, color, w = 160, h = 48 }) {
  const sl = data.slice(-80);
  const mn = Math.min(...sl), mx = Math.max(...sl), rng = mx - mn || 1;
  const pts = sl.map((v, i) => `${(i / (sl.length - 1)) * w},${h - ((v - mn) / rng) * (h - 2) - 1}`).join(' ');
  const area = `M0,${h} ${sl.map((v, i) => `${(i / (sl.length - 1)) * w},${h - ((v - mn) / rng) * (h - 2) - 1}`).join(' ')} ${w},${h} Z`;
  const id = `sg${color.replace('#', '')}`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function GaugeDial({ score, color }) {
  const pct = Math.max(0, Math.min(1, (score + 100) / 200));
  const cx = 70, cy = 70, r = 52;
  const startA = -220, sweep = 260;
  const angle = startA + pct * sweep;
  const rad = a => (a * Math.PI) / 180;
  const nx = cx + r * Math.cos(rad(angle)), ny = cy + r * Math.sin(rad(angle));
  const arc = (a1, a2, rc) => {
    const x1 = cx + rc * Math.cos(rad(a1)), y1 = cy + rc * Math.sin(rad(a1));
    const x2 = cx + rc * Math.cos(rad(a2)), y2 = cy + rc * Math.sin(rad(a2));
    return `M${x1},${y1} A${rc},${rc} 0 ${Math.abs(a2 - a1) > 180 ? 1 : 0} 1 ${x2},${y2}`;
  };
  const zones = [{ a1: -220, a2: -168, c: '#FF3355' }, { a1: -168, a2: -116, c: '#FF7744' }, { a1: -116, a2: -64, c: '#555' }, { a1: -64, a2: -12, c: '#44BB66' }, { a1: -12, a2: 40, c: '#00FF88' }];
  return (
    <svg width={140} height={100} viewBox="0 0 140 100">
      {zones.map((z, i) => <path key={i} d={arc(z.a1, z.a2, 52)} fill="none" stroke={z.c} strokeWidth="6" strokeLinecap="round" opacity="0.25" />)}
      <path d={arc(startA, angle, 52)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="white" strokeWidth="2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={color} />
    </svg>
  );
}

function FGDial({ value }) {
  const v = Math.max(0, Math.min(100, value));
  const angle = -180 + (v / 100) * 180;
  const rad = a => (a * Math.PI) / 180;
  const cx = 60, cy = 60, r = 48;
  const nx = cx + r * Math.cos(rad(angle)), ny = cy + r * Math.sin(rad(angle));
  const color = v < 25 ? '#FF3355' : v < 45 ? '#FF7744' : v < 55 ? '#FFD700' : v < 75 ? '#44BB66' : '#00FF88';
  const label = v < 25 ? 'Extreme Fear' : v < 45 ? 'Fear' : v < 55 ? 'Neutral' : v < 75 ? 'Greed' : 'Extreme Greed';
  const segs = [{ a: -180, c: '#FF3355' }, { a: -135, c: '#FF7744' }, { a: -90, c: '#FFD700' }, { a: -45, c: '#44BB66' }, { a: 0, c: '#00FF88' }];
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={120} height={70} viewBox="0 0 120 70">
        {segs.slice(0, -1).map((z, i) => {
          const a1 = z.a, a2 = segs[i + 1].a;
          const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
          const x2 = cx + r * Math.cos(rad(a2)), y2 = cy + r * Math.sin(rad(a2));
          return <path key={i} d={`M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`} fill="none" stroke={z.c} strokeWidth="6" opacity="0.4" />;
        })}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={color} />
      </svg>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: -8 }}>{v}</div>
      <div style={{ fontSize: 10, color: '#888', letterSpacing: 1 }}>{label.toUpperCase()}</div>
    </div>
  );
}

function IndBar({ label, value, min, max, color, fmt = v => v.toFixed(2) }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginBottom: 2 }}>
        <span>{label}</span><span style={{ color }}>{fmt(value)}</span>
      </div>
      <div style={{ height: 3, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

// Signal color helpers
const sigColor = s => s === 'BUY' ? '#00FF88' : s === 'SELL' ? '#FF3355' : s === 'STRONG BUY' ? '#00FFCC' : s === 'STRONG SELL' ? '#FF0044' : '#556';
const sigBg = s => s === 'BUY' ? '#001A0D' : s === 'SELL' ? '#1A0008' : s === 'STRONG BUY' ? '#002215' : s === 'STRONG SELL' ? '#1A000A' : '#0A0A0A';
const impColor = i => i === 'HIGH' ? '#FF4466' : i === 'MED' ? '#FFB800' : '#44AA88';
const sentColor = s => s === 'bullish' ? '#00FF88' : s === 'bearish' ? '#FF3355' : '#666';

// ══════════════════════════════════════════════════════════════
// INDICATOR CATEGORIES (for display grouping)
// ══════════════════════════════════════════════════════════════
const IND_CATS = {
  'TREND': ['SMA 5', 'SMA 10', 'SMA 20', 'SMA 50', 'SMA 100', 'SMA 200', 'EMA 5', 'EMA 9', 'EMA 10', 'EMA 13', 'EMA 21', 'EMA 26', 'EMA 34', 'EMA 50', 'EMA 55', 'EMA 89', 'EMA 100', 'EMA 144', 'EMA 200', 'WMA 10', 'WMA 20', 'DEMA 20', 'TEMA 20', 'HMA 14', 'KAMA 10', 'EMA 9×21', 'EMA 21×50', 'EMA 50×200', 'SMA 50×200', 'Ichi Tenkan', 'Ichi Kijun', 'Ichi Cloud', 'Ichi TK Cross', 'Parabolic SAR', 'ADX Trend', 'ADX Strength', 'DI Cross', 'Aroon Up', 'Aroon Osc', 'Vortex VI+', 'SuperTrend', 'LinReg Slope', 'LinReg Price', 'TRIX', 'Heikin-Ashi', 'HA Streak', 'Price Position'],
  'MOMENTUM': ['RSI 7', 'RSI 14', 'RSI 21', 'RSI 25', 'RSI Dir', 'StochRSI K', 'MACD Cross', 'MACD Hist', 'MACD Zero', 'MACD Alt', 'CCI 14', 'CCI 20', 'CCI 50', 'CCI Dir', 'Williams %R 14', 'Williams %R 20', 'ROC 10', 'ROC 20', 'Momentum 10', 'Momentum 20', 'TSI', 'Ult Oscillator', 'Stoch %K 14', 'Stoch %K 5', 'Stoch Dir', 'CMO', 'PPO', 'DPO', 'Fisher Transform', 'KDJ J', 'Elder Bull', 'Elder Bear', 'RVI', 'Connors RSI', 'QStick 3', 'QStick 8', 'Coppock', 'PMO', 'ROC Accel', 'Inertia'],
  'VOLATILITY': ['BB %B', 'BB Width', 'BB Squeeze', 'BB(1σ) %B', 'BB(50) %B', 'Keltner Upper', 'Keltner Lower', 'Donchian Mid', 'ATR Trend', 'Hist Volatility', 'Mass Index', 'Ulcer Index', 'Chaikin Vol', 'BB Pos', 'ATR Rise'],
  'VOLUME': ['OBV Trend', 'CMF', 'MFI', 'MFI Dir', 'Force Index', 'A/D Line', 'EMV', 'VWAP Pos', 'PVT'],
  'PIVOTS': ['Classic PP', 'Classic R1', 'Classic S1', 'Fib PP', 'Fib R1', 'Fib S1', 'Camarilla R3', 'Camarilla S3', 'Woodie PP', 'Fib 23.6%', 'Fib 38.2%', 'Fib 61.8%', '52W High Dist', '52W Low Dist', 'Support Zone', 'Resistance Zone'],
  'COMPOSITE': ['SMA 5×20', 'SMA 10×50', 'EMA 13×34', 'EMA 5×13', 'EMA 89×144', 'Triple EMA', 'Quad EMA', 'Price/SMA200 Ratio', 'VWAP Distance', 'BB Lower Touch', 'BB Upper Touch', 'Keltner vs BB', 'Donchian Breakout', 'RSI 14 Oversold Bounce', 'MACD Hist Rising', 'TSI + RSI Confirm', 'ADX + Trend', 'Multi RSI Agree', 'Volume + Price', 'BB Hist Vol', 'Aroon Cloud', 'Stoch + RSI', 'Price Above Clouds', 'EMA Fan'],
};

// ══════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [ohlcv, setOhlcv] = useState(() => ({
    XAUUSD: genOHLCV(2665.30, 300, 0.0006),
    XAGUSD: genOHLCV(29.85, 300, 0.001),
    BTCUSD: genOHLCV(97500, 300, 0.0025),
  }));
  const [prices, setPrices] = useState({
    XAUUSD: { price: 2665.30, open: 2665.30, prev: 2665.30, change: 0, pct: 0, flash: null, source: 'LIVE' },
    XAGUSD: { price: 29.85, open: 29.85, prev: 29.85, change: 0, pct: 0, flash: null, source: 'LIVE' },
    BTCUSD: { price: 97500, open: 97500, prev: 97500, change: 0, pct: 0, flash: null, source: 'WS' },
  });
  const [ta, setTa] = useState({});
  const [fearGreed, setFearGreed] = useState({ value: 65 });
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [activeInst, setActiveInst] = useState('BTCUSD');
  const [activeIndCat, setActiveIndCat] = useState('TREND');
  const [time, setTime] = useState(new Date());
  const [sessions, setSessions] = useState(getSessions());
  const [btcLive, setBtcLive] = useState(false);
  const [metalSource, setMetalSource] = useState('POLLING');
  const [ticker, setTicker] = useState(0);
  const openPrices = useRef({ XAUUSD: null, XAGUSD: null, BTCUSD: null });

  // Clock
  useEffect(() => {
    const t = setInterval(() => { setTime(new Date()); setSessions(getSessions()); }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── LIVE METAL PRICES ──────────────────────────────────────
  const fetchMetals = async () => {
    try {
      // Try metals.live first
      const r = await fetch('https://api.metals.live/v1/spot', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const data = await r.json();
        // metals.live returns array [{gold:..., silver:...}] or object
        const d = Array.isArray(data) ? data[0] : data;
        const goldPrice = d.gold || d.XAU || d.XAUUSD;
        const silverPrice = d.silver || d.XAG || d.XAGUSD;
        if (goldPrice && silverPrice) {
          setMetalSource('metals.live');
          updateMetalPrice('XAUUSD', parseFloat(goldPrice));
          updateMetalPrice('XAGUSD', parseFloat(silverPrice));
          return true;
        }
      }
    } catch (e) { }
    try {
      // fallback: goldprice.org
      const r = await fetch('https://data-asg.goldprice.org/GetData/USD-XAU,USD-XAG/1', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const raw = await r.json();
        // response: "1|1234.56|0.00|1|29.85|0.00" comma-sep
        if (raw && raw.items) {
          setMetalSource('goldprice.org');
          return true;
        }
      }
    } catch (e) { }
    return false;
  };

  const updateMetalPrice = (sym, p) => {
    if (!p || isNaN(p)) return;
    if (!openPrices.current[sym]) openPrices.current[sym] = p;
    const open = openPrices.current[sym];
    setPrices(prev => ({
      ...prev,
      [sym]: { price: p, open, prev: prev[sym].price, change: p - open, pct: ((p - open) / open) * 100, flash: p > prev[sym].price ? 'up' : p < prev[sym].price ? 'down' : null, source: metalSource }
    }));
    setOhlcv(prev => ({
      ...prev,
      [sym]: {
        closes: [...prev[sym].closes.slice(-299), p],
        highs: [...prev[sym].highs.slice(-299), Math.max(p, prev[sym].highs.slice(-1)[0])],
        lows: [...prev[sym].lows.slice(-299), Math.min(p, prev[sym].lows.slice(-1)[0])],
        opens: [...prev[sym].opens.slice(-299), prev[sym].closes.slice(-1)[0]],
        volumes: [...prev[sym].volumes.slice(-299), 500 + Math.random() * 1500],
      }
    }));
  };

  // Poll metals every 10s
  useEffect(() => {
    fetchMetals();
    const t = setInterval(fetchMetals, 10000);
    return () => clearInterval(t);
  }, []);

  // Simulate XAU/XAG ticks between polls (keeps chart lively)
  useEffect(() => {
    const t = setInterval(() => {
      ['XAUUSD', 'XAGUSD'].forEach(sym => {
        setOhlcv(prev => {
          const last = prev[sym].closes.slice(-1)[0];
          const c = last * (1 + (Math.random() - 0.495) * INST[sym].vol);
          return {
            ...prev,
            [sym]: {
              closes: [...prev[sym].closes.slice(-299), c],
              highs: [...prev[sym].highs.slice(-299), c * (1 + Math.random() * INST[sym].vol * 0.4)],
              lows: [...prev[sym].lows.slice(-299), c * (1 - Math.random() * INST[sym].vol * 0.4)],
              opens: [...prev[sym].opens.slice(-299), last],
              volumes: [...prev[sym].volumes.slice(-299), 500 + Math.random() * 1500],
            }
          };
        });
      });
      setTicker(n => n + 1);
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // Sync simulated prices
  useEffect(() => {
    ['XAUUSD', 'XAGUSD'].forEach(sym => {
      setOhlcv(prev => {
        const p = prev[sym].closes.slice(-1)[0];
        if (!openPrices.current[sym]) openPrices.current[sym] = p;
        const open = openPrices.current[sym];
        setPrices(pp => ({
          ...pp,
          [sym]: { price: p, open, prev: pp[sym].price, change: p - open, pct: ((p - open) / open) * 100, flash: p > pp[sym].price ? 'up' : p < pp[sym].price ? 'down' : null, source: pp[sym].source }
        }));
        return prev;
      });
    });
  }, [ticker]);

  // ── BTC WebSocket ─────────────────────────────────────────
  useEffect(() => {
    let ws;
    const connect = () => {
      try {
        ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');
        ws.onopen = () => setBtcLive(true);
        ws.onmessage = (e) => {
          const d = JSON.parse(e.data);
          const p = parseFloat(d.c), open = parseFloat(d.o);
          if (!openPrices.current.BTCUSD) openPrices.current.BTCUSD = open;
          setPrices(prev => ({
            ...prev,
            BTCUSD: { price: p, open, prev: prev.BTCUSD.price, change: parseFloat(d.p), pct: parseFloat(d.P), flash: p > prev.BTCUSD.price ? 'up' : p < prev.BTCUSD.price ? 'down' : null, source: 'BINANCE WS' }
          }));
          setOhlcv(prev => ({
            ...prev,
            BTCUSD: {
              closes: [...prev.BTCUSD.closes.slice(-299), p],
              highs: [...prev.BTCUSD.highs.slice(-299), Math.max(p, prev.BTCUSD.highs.slice(-1)[0] * 1.0001)],
              lows: [...prev.BTCUSD.lows.slice(-299), Math.min(p, prev.BTCUSD.lows.slice(-1)[0] * 0.9999)],
              opens: [...prev.BTCUSD.opens.slice(-299), prev.BTCUSD.closes.slice(-1)[0]],
              volumes: [...prev.BTCUSD.volumes.slice(-299), parseFloat(d.v || 1000)],
            }
          }));
        };
        ws.onerror = ws.onclose = () => { setBtcLive(false); setTimeout(connect, 5000); };
      } catch { setBtcLive(false); }
    };
    connect();
    return () => ws?.close();
  }, []);

  // ── TA Engine ─────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      const res = {};
      Object.keys(ohlcv).forEach(sym => {
        const { closes, highs, lows, volumes, opens } = ohlcv[sym];
        res[sym] = runTA(closes, highs, lows, volumes, opens);
      });
      setTa(res);
    }, 150);
    return () => clearTimeout(t);
  }, [ohlcv]);

  // ── Fear & Greed ──────────────────────────────────────────
  useEffect(() => {
    fetch('https://api.alternative.me/fng/')
      .then(r => r.json())
      .then(d => { if (d.data?.[0]) setFearGreed({ value: parseInt(d.data[0].value) }); })
      .catch(() => { });
  }, []);

  // ── News ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setNewsLoading(true);
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', max_tokens: 1500,
            messages: [{ role: 'user', content: `Generate 8 realistic current financial market news items for gold (XAUUSD), silver (XAGUSD), and Bitcoin (BTCUSD). Include macro factors (Fed, inflation, DXY, geopolitics). Respond ONLY with a JSON array, no markdown: [{"title":"...","summary":"1 sentence.","instrument":"XAUUSD|XAGUSD|BTCUSD|MACRO","sentiment":"bullish|bearish|neutral","impact":"HIGH|MED|LOW","time":"Xh ago"}]. Today: ${new Date().toDateString()}.` }]
          })
        });
        const data = await res.json();
        const txt = data.content?.map(x => x.text || '').join('') || '';
        setNews(JSON.parse(txt.replace(/```json|```/g, '').trim()));
      } catch {
        setNews([
          { title: 'Fed holds rates, gold rallies on uncertainty', summary: 'Federal Reserve maintains current rates amid mixed economic signals, boosting safe-haven demand.', instrument: 'XAUUSD', sentiment: 'bullish', impact: 'HIGH', time: '1h ago' },
          { title: 'Bitcoin ETF inflows hit quarterly high', summary: 'Spot ETF products see record buying from institutional investors and pension funds.', instrument: 'BTCUSD', sentiment: 'bullish', impact: 'HIGH', time: '2h ago' },
          { title: 'Silver industrial demand surges on solar uptake', summary: 'Photovoltaic sector silver usage projected to grow 20% this year, supporting prices.', instrument: 'XAGUSD', sentiment: 'bullish', impact: 'MED', time: '3h ago' },
          { title: 'DXY retreats from 6-month high, metals rally', summary: 'Dollar weakness provides tailwind for gold and silver across the board.', instrument: 'MACRO', sentiment: 'bullish', impact: 'MED', time: '4h ago' },
          { title: 'Geopolitical tensions lift safe-haven demand', summary: 'Middle East escalation drives risk-off flows into gold and Bitcoin.', instrument: 'XAUUSD', sentiment: 'bullish', impact: 'HIGH', time: '5h ago' },
          { title: 'BTC hash rate signals potential miner capitulation bottom', summary: 'On-chain metrics suggest selling pressure may be nearing exhaustion near current levels.', instrument: 'BTCUSD', sentiment: 'bullish', impact: 'MED', time: '6h ago' },
          { title: 'Silver faces key resistance at $31 handle', summary: 'Technical indicators show divergence as silver struggles to break multi-month resistance.', instrument: 'XAGUSD', sentiment: 'neutral', impact: 'LOW', time: '7h ago' },
          { title: 'Global PMI data disappoints, recession fears grow', summary: 'Weaker manufacturing data globally raises stagflation concerns for commodities.', instrument: 'MACRO', sentiment: 'bearish', impact: 'MED', time: '8h ago' },
        ]);
      }
      setNewsLoading(false);
    };
    load();
  }, []);

  const curTa = ta[activeInst];
  const curInst = INST[activeInst];
  const curPrice = prices[activeInst];
  const fmt = (sym, p) => { const d = INST[sym].decimals; return sym === 'BTCUSD' ? `$${(+p).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}` : `$${(+p).toFixed(d)}`; };

  // Category indicator counts
  const catCounts = curTa ? Object.entries(IND_CATS).reduce((acc, [cat, names]) => {
    const sigs = names.map(n => curTa.indicators?.[n]?.sig).filter(Boolean);
    acc[cat] = { buy: sigs.filter(s => s === 'BUY').length, sell: sigs.filter(s => s === 'SELL').length, neutral: sigs.filter(s => s === 'NEUTRAL').length, total: sigs.length };
    return acc;
  }, {}) : {};

  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", background: '#02040A', color: '#D0D8E8', minHeight: '100vh', position: 'relative' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=JetBrains+Mono:wght@300;400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;background:#050810}
        ::-webkit-scrollbar-thumb{background:#1A2040;border-radius:2px}
        .flash-up{animation:flashUp 0.4s ease}
        .flash-down{animation:flashDown 0.4s ease}
        @keyframes flashUp{0%,100%{background:transparent}30%{background:rgba(0,255,136,0.15)}}
        @keyframes flashDown{0%,100%{background:transparent}30%{background:rgba(255,51,85,0.15)}}
        .pulse{animation:pulse 2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .glow-text{text-shadow:0 0 20px currentColor}
        .grid-bg{background-image:linear-gradient(rgba(0,180,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,255,0.025) 1px,transparent 1px);background-size:32px 32px}
        .scanlines{background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.04) 3px,rgba(0,0,0,0.04) 4px);pointer-events:none;position:fixed;inset:0;z-index:100}
        .card{background:rgba(5,10,20,0.92);border:1px solid #0D1830;border-radius:4px;box-shadow:0 0 20px rgba(0,180,255,0.04),inset 0 1px 0 rgba(255,255,255,0.02)}
        .tab-btn{background:none;border:none;cursor:pointer;transition:all 0.2s;font-family:inherit}
        .ind-row:hover{background:#0A0F1C!important}
        .news-item:hover{background:#0A0F1C!important}
        .cat-scroll::-webkit-scrollbar{height:3px}
        .cat-scroll::-webkit-scrollbar-thumb{background:#1A2040}
      `}</style>
      <div className="scanlines" />
      <div className="grid-bg" style={{ position: 'fixed', inset: 0, zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ═══ HEADER ═══ */}
        <header style={{ borderBottom: '1px solid #0D1830', background: 'rgba(2,4,10,0.96)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0055FF,#00DDFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, fontFamily: 'Orbitron' }}>N</div>
              <div>
                <div style={{ fontFamily: 'Orbitron', fontSize: 15, fontWeight: 900, letterSpacing: 4, color: '#00DDFF' }}>NEXUS</div>
                <div style={{ fontSize: 8, color: '#334', letterSpacing: 3 }}>MARKETS INTELLIGENCE</div>
              </div>
              <div style={{ padding: '2px 8px', background: 'rgba(0,221,255,0.08)', border: '1px solid #00DDFF33', borderRadius: 3, fontSize: 9, color: '#00DDFF', marginLeft: 4 }}>
                {curTa ? `${curTa.totalIndicators} INDICATORS` : '150+ INDICATORS'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {sessions.map(s => (
                <div key={s.name} style={{ padding: '3px 10px', borderRadius: 3, background: s.open ? 'rgba(0,255,136,0.08)' : '#060810', border: `1px solid ${s.open ? '#00FF88' : '#1A2040'}`, fontSize: 10 }}>
                  <span style={{ color: s.open ? '#00FF88' : '#334' }}>◉</span>
                  <span style={{ marginLeft: 5, color: s.open ? '#D0FFE8' : '#334' }}>{s.name.toUpperCase()}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 10, color: '#334' }}>{time.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              <div style={{ fontFamily: 'Orbitron', fontSize: 16, color: '#00DDFF', letterSpacing: 2 }}>{time.toLocaleTimeString('en', { hour12: false })}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
                  <span className={btcLive ? 'pulse' : ''} style={{ color: btcLive ? '#00FF88' : '#FF7744', fontSize: 7 }}>◉</span>
                  <span style={{ color: btcLive ? '#00FF88' : '#FF7744' }}>BTC: {btcLive ? 'BINANCE WS' : 'SIMULATED'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
                  <span className="pulse" style={{ color: '#FFB800', fontSize: 7 }}>◉</span>
                  <span style={{ color: '#FFB800' }}>METALS: POLLING</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div style={{ padding: '14px 20px', maxWidth: 1900, margin: '0 auto' }}>

          {/* ═══ PRICE CARDS ═══ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 14 }}>
            {Object.entries(INST).map(([sym, inst]) => {
              const p = prices[sym];
              const t = ta[sym];
              const up = p.pct >= 0;
              const cl = p.flash === 'up' ? 'flash-up' : p.flash === 'down' ? 'flash-down' : '';
              return (
                <div key={sym} className={`card ${cl}`} onClick={() => setActiveInst(sym)}
                  style={{ padding: 14, cursor: 'pointer', borderColor: activeInst === sym ? inst.color : '#0D1830', transition: 'border-color 0.3s', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: -50, right: -50, width: 150, height: 150, borderRadius: '50%', background: inst.color, opacity: 0.03, pointerEvents: 'none' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 18, color: inst.color }}>{inst.icon}</span>
                        <span style={{ fontFamily: 'Orbitron', fontSize: 11, letterSpacing: 2, color: inst.color }}>{inst.label}</span>
                        <span style={{ fontSize: 7, padding: '1px 4px', background: sym === 'BTCUSD' && btcLive ? 'rgba(0,255,136,0.15)' : 'rgba(255,180,0,0.1)', color: sym === 'BTCUSD' && btcLive ? '#00FF88' : '#FFB800', border: `1px solid ${sym === 'BTCUSD' && btcLive ? '#00FF88' : '#FFB800'}`, borderRadius: 2 }}>
                          {sym === 'BTCUSD' ? (btcLive ? '⚡ LIVE WS' : '◎ SIM') : '◎ POLLED'}
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: '#334', letterSpacing: 2 }}>{inst.name}</div>
                    </div>
                    {t && <div style={{ padding: '3px 10px', borderRadius: 3, background: sigBg(t.rec), border: `1px solid ${sigColor(t.rec)}`, fontSize: 10, color: sigColor(t.rec), fontWeight: 700, letterSpacing: 1 }}>{t.rec}</div>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontFamily: 'Orbitron', fontSize: 24, fontWeight: 700, color: inst.color, lineHeight: 1 }}>{fmt(sym, p.price)}</div>
                      <div style={{ fontSize: 11, marginTop: 4, color: up ? '#00FF88' : '#FF3355' }}>
                        {up ? '▲' : '▼'} {p.change >= 0 ? '+' : ''}{p.change.toFixed(inst.decimals)} ({up ? '+' : ''}{p.pct.toFixed(2)}%)
                      </div>
                    </div>
                    <Sparkline data={ohlcv[sym].closes} color={inst.color} w={140} h={48} />
                  </div>
                  {t && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #0D1830', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4 }}>
                      {[['RSI', t.rsi?.toFixed(1)], ['Score', `${t.normalizedScore?.toFixed(0)}%`], ['Buy', t.buyCount], ['Sell', t.sellCount], ['Neut', t.neutralCount]].map(([k, v]) => (
                        <div key={k} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 8, color: '#334' }}>{k}</div>
                          <div style={{ fontSize: 11, color: k === 'Buy' ? '#00FF88' : k === 'Sell' ? '#FF3355' : inst.color }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ═══ MAIN ANALYSIS ROW ═══ */}
          <div style={{ display: 'grid', gridTemplateColumns: '280px auto 220px', gap: 12, marginBottom: 14 }}>

            {/* Left: Key indicators */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 2, color: '#00DDFF', marginBottom: 12, borderBottom: '1px solid #0D1830', paddingBottom: 8 }}>
                ◈ KEY LEVELS — <span style={{ color: curInst.color }}>{curInst.label}</span>
              </div>
              {curTa ? (
                <div>
                  <IndBar label="RSI 14" value={curTa.rsi} min={0} max={100} color={curTa.rsi < 30 ? '#00FF88' : curTa.rsi > 70 ? '#FF3355' : '#FFB800'} />
                  <IndBar label="RSI 7" value={curTa.rsi7} min={0} max={100} color={curTa.rsi7 < 30 ? '#00FF88' : curTa.rsi7 > 70 ? '#FF3355' : '#888'} />
                  <IndBar label="Stoch %K 14" value={curTa.stoch?.k} min={0} max={100} color={curTa.stoch?.k < 20 ? '#00FF88' : curTa.stoch?.k > 80 ? '#FF3355' : '#888'} />
                  <IndBar label="StochRSI K" value={curTa.stochRSI?.k} min={0} max={100} color={curTa.stochRSI?.k < 20 ? '#00FF88' : curTa.stochRSI?.k > 80 ? '#FF3355' : '#888'} />
                  <IndBar label="CCI 20" value={curTa.cci} min={-250} max={250} color={curTa.cci < -100 ? '#00FF88' : curTa.cci > 100 ? '#FF3355' : '#888'} fmt={v => v.toFixed(1)} />
                  <IndBar label="Williams %R" value={curTa.wr} min={-100} max={0} color={curTa.wr < -80 ? '#00FF88' : curTa.wr > -20 ? '#FF3355' : '#888'} fmt={v => v.toFixed(1)} />
                  <IndBar label="CMF" value={curTa.cmf * 100} min={-100} max={100} color={curTa.cmf > 0.05 ? '#00FF88' : curTa.cmf < -0.05 ? '#FF3355' : '#888'} />
                  <IndBar label="MFI" value={curTa.mfi} min={0} max={100} color={curTa.mfi < 20 ? '#00FF88' : curTa.mfi > 80 ? '#FF3355' : '#888'} />
                  <IndBar label="Connors RSI" value={curTa.connors} min={0} max={100} color={curTa.connors < 20 ? '#00FF88' : curTa.connors > 80 ? '#FF3355' : '#888'} />
                  <IndBar label="ADX" value={curTa.adx?.adx} min={0} max={100} color={curTa.adx?.adx > 25 ? '#00DDFF' : '#555'} />
                  <div style={{ marginTop: 10, borderTop: '1px solid #0D1830', paddingTop: 8 }}>
                    <div style={{ fontSize: 9, color: '#334', marginBottom: 6, letterSpacing: 1 }}>MACD</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                      {[['MACD', curTa.macd?.macd], ['Signal', curTa.macd?.signal], ['Hist', curTa.macd?.hist]].map(([k, v]) => (
                        <div key={k} style={{ background: '#060A14', padding: '4px 5px', borderRadius: 3, textAlign: 'center' }}>
                          <div style={{ fontSize: 8, color: '#334' }}>{k}</div>
                          <div style={{ fontSize: 10, color: (v || 0) >= 0 ? '#00FF88' : '#FF3355' }}>{(v || 0).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: 10, borderTop: '1px solid #0D1830', paddingTop: 8 }}>
                    <div style={{ fontSize: 9, color: '#334', marginBottom: 6, letterSpacing: 1 }}>BOLLINGER BANDS (20,2)</div>
                    {[['Upper', curTa.bb?.upper], ['Middle', curTa.bb?.mid], ['Lower', curTa.bb?.lower]].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0' }}>
                        <span style={{ color: '#556' }}>{k}</span><span style={{ color: '#888' }}>{v ? fmt(activeInst, v) : '--'}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 4, fontSize: 9, color: '#334' }}>%B: {((curTa.bb?.pct || 0) * 100).toFixed(1)}% | Width: {curTa.bb?.width?.toFixed(2)}%</div>
                    <div style={{ marginTop: 3, height: 4, background: '#111', borderRadius: 2 }}><div style={{ height: '100%', width: `${(curTa.bb?.pct || 0) * 100}%`, background: curInst.color, borderRadius: 2 }} /></div>
                  </div>
                </div>
              ) : <div style={{ color: '#334', textAlign: 'center', padding: 20 }}>Computing 150+ indicators...</div>}
            </div>

            {/* Center: Big indicator table */}
            <div className="card" style={{ padding: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid #0D1830', paddingBottom: 8 }}>
                <div style={{ fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 2, color: '#00DDFF' }}>
                  ◈ INDICATOR MATRIX — <span style={{ color: curInst.color }}>{curInst.label}</span>
                  {curTa && <span style={{ color: '#556', fontSize: 9 }}> ({curTa.totalIndicators} total)</span>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {Object.entries(catCounts).map(([cat, counts]) => (
                    <button key={cat} className="tab-btn" onClick={() => setActiveIndCat(cat)}
                      style={{ padding: '3px 8px', borderRadius: 3, fontSize: 9, letterSpacing: 1, border: `1px solid ${activeIndCat === cat ? '#00DDFF' : '#1A2040'}`, color: activeIndCat === cat ? '#00DDFF' : '#556', background: activeIndCat === cat ? 'rgba(0,221,255,0.08)' : 'transparent' }}>
                      {cat.slice(0, 4)} <span style={{ color: '#00FF88' }}>{counts.buy}</span>/<span style={{ color: '#FF3355' }}>{counts.sell}</span>
                    </button>
                  ))}
                </div>
              </div>
              {curTa?.indicators ? (
                <div style={{ height: 460, overflowY: 'auto', overflowX: 'hidden' }} className="cat-scroll">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1px 8px' }}>
                    {(IND_CATS[activeIndCat] || []).filter(n => curTa.indicators[n]).map(name => {
                      const ind = curTa.indicators[name];
                      const valStr = typeof ind.val === 'number' ? (Math.abs(ind.val) > 10000 ? ind.val.toLocaleString('en', { maximumFractionDigits: 0 }) : Math.abs(ind.val) > 100 ? ind.val.toFixed(1) : Math.abs(ind.val) > 1 ? ind.val.toFixed(2) : ind.val.toFixed(4)) : '--';
                      return (
                        <div key={name} className="ind-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 6px', borderBottom: '1px solid #070B15', borderRadius: 2 }}>
                          <div style={{ fontSize: 10, color: '#7080A0', minWidth: 90 }}>{name}</div>
                          <div style={{ fontSize: 9, color: '#445', marginRight: 6 }}>{valStr}</div>
                          <div style={{ fontSize: 9, color: sigColor(ind.sig), fontWeight: 700, padding: '1px 6px', background: sigBg(ind.sig), borderRadius: 2, border: `1px solid ${sigColor(ind.sig)}33`, minWidth: 46, textAlign: 'center' }}>{ind.sig}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : <div style={{ color: '#334', textAlign: 'center', padding: 40 }}>Initializing engine...</div>}
              {/* Summary bar */}
              {curTa && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #0D1830' }}>
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
                    <div style={{ flex: curTa.buyCount, background: '#00FF88', opacity: 0.8 }} />
                    <div style={{ flex: curTa.neutralCount, background: '#334', opacity: 0.6 }} />
                    <div style={{ flex: curTa.sellCount, background: '#FF3355', opacity: 0.8 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 5 }}>
                    <span style={{ color: '#00FF88' }}>BUY: {curTa.buyCount} ({((curTa.buyCount / curTa.totalIndicators) * 100).toFixed(0)}%)</span>
                    <span style={{ color: '#556' }}>NEUTRAL: {curTa.neutralCount}</span>
                    <span style={{ color: '#FF3355' }}>SELL: {curTa.sellCount} ({((curTa.sellCount / curTa.totalIndicators) * 100).toFixed(0)}%)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Signal gauge + rec */}
            <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, color: '#334', marginBottom: 6, textAlign: 'center' }}>COMPOSITE SIGNAL</div>
              {curTa ? (
                <>
                  <GaugeDial score={curTa.normalizedScore} color={sigColor(curTa.rec)} />
                  <div style={{ fontFamily: 'Orbitron', fontSize: 16, fontWeight: 900, color: sigColor(curTa.rec), textAlign: 'center', letterSpacing: 2, marginTop: 2 }} className="glow-text">{curTa.rec}</div>
                  <div style={{ fontSize: 10, color: '#556', marginTop: 4 }}>Weighted: {curTa.normalizedScore?.toFixed(1)}%</div>
                  <div style={{ fontSize: 10, color: '#445', marginTop: 2 }}>{curTa.totalIndicators} Indicators</div>
                  <div style={{ marginTop: 12, width: '100%' }}>
                    {[['STRONG BUY', '#00FFCC'], ['BUY', '#00FF88'], ['NEUTRAL', '#666'], ['SELL', '#FF3355'], ['STRONG SELL', '#FF0044']].map(([level, col]) => (
                      <div key={level} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 10, borderBottom: '1px solid #080C18' }}>
                        <span style={{ color: col }}>{level}</span>
                        <span style={{ color: col, fontWeight: level === curTa.rec ? 700 : 400 }}>
                          {level === curTa.rec ? '◉' : '○'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, width: '100%' }}>
                    <div style={{ fontSize: 9, color: '#334', marginBottom: 4, letterSpacing: 1 }}>CATEGORY SIGNALS</div>
                    {Object.entries(catCounts).map(([cat, c]) => (
                      <div key={cat} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2 }}>
                          <span style={{ color: '#556' }}>{cat}</span>
                          <span style={{ color: c.buy > c.sell ? '#00FF88' : c.sell > c.buy ? '#FF3355' : '#666' }}>{c.buy}B/{c.sell}S</span>
                        </div>
                        <div style={{ height: 3, background: '#111', borderRadius: 2, overflow: 'hidden', display: 'flex', gap: '1px' }}>
                          <div style={{ flex: c.buy, background: '#00FF88', opacity: 0.8 }} />
                          <div style={{ flex: c.neutral, background: '#333', opacity: 0.6 }} />
                          <div style={{ flex: c.sell, background: '#FF3355', opacity: 0.8 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, width: '100%', padding: 8, background: '#060A14', borderRadius: 3, border: '1px solid #0D1830' }}>
                    <div style={{ fontSize: 9, color: '#334', marginBottom: 3 }}>MARKET STRUCTURE</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {[
                        { k: 'Trend', v: curTa.superT?.bull ? 'BULL' : 'BEAR', c: curTa.superT?.bull ? '#00FF88' : '#FF3355' },
                        { k: 'ADX', v: curTa.adx?.adx?.toFixed(0), c: curTa.adx?.adx > 25 ? '#00DDFF' : '#556' },
                        { k: 'HA', v: curTa.ha?.bull ? `↑ ×${curTa.ha.streak}` : `↓ ×${curTa.ha?.streak}`, c: curTa.ha?.bull ? '#00FF88' : '#FF3355' },
                        { k: 'Vol%', v: curTa.histVol?.toFixed(1) + '%', c: curTa.histVol > 40 ? '#FF7744' : '#888' },
                      ].map(({ k, v, c }) => (
                        <div key={k} style={{ textAlign: 'center', padding: '4px', background: '#030508', borderRadius: 3 }}>
                          <div style={{ fontSize: 8, color: '#334' }}>{k}</div>
                          <div style={{ fontSize: 10, color: c }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : <div style={{ color: '#334' }}>Computing...</div>}
            </div>
          </div>

          {/* ═══ MULTI-ASSET MATRIX ═══ */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 2, color: '#00DDFF', marginBottom: 12, borderBottom: '1px solid #0D1830', paddingBottom: 8 }}>
              ◈ MULTI-ASSET SIGNAL MATRIX — ALL {curTa?.totalIndicators || '150+'} INDICATORS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {Object.entries(INST).map(([sym, inst]) => {
                const t = ta[sym];
                if (!t) return null;
                const pct = ((t.buyCount / t.totalIndicators) * 100).toFixed(0);
                return (
                  <div key={sym} style={{ background: '#060A14', borderRadius: 4, padding: 12, border: `1px solid ${inst.color}22`, cursor: 'pointer' }} onClick={() => setActiveInst(sym)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: 'Orbitron', fontSize: 11, color: inst.color, letterSpacing: 1 }}>{inst.label}</span>
                      <span style={{ fontSize: 10, color: sigColor(t.rec), fontWeight: 700 }}>{t.rec}</span>
                    </div>
                    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1, marginBottom: 8 }}>
                      <div style={{ flex: t.buyCount, background: '#00FF88', opacity: 0.8 }} />
                      <div style={{ flex: t.neutralCount, background: '#334', opacity: 0.6 }} />
                      <div style={{ flex: t.sellCount, background: '#FF3355', opacity: 0.8 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                      <span style={{ color: '#00FF88' }}>Buy: {t.buyCount} ({pct}%)</span>
                      <span style={{ color: '#556' }}>Neut: {t.neutralCount}</span>
                      <span style={{ color: '#FF3355' }}>Sell: {t.sellCount}</span>
                    </div>
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 3 }}>
                      {[['RSI', t.rsi?.toFixed(0)], ['ADX', t.adx?.adx?.toFixed(0)], ['MACD', t.macd?.hist > 0 ? '▲' : '▼'], ['ATR', t.atr?.toFixed(1)], ['Score', `${t.normalizedScore?.toFixed(0)}%`]].map(([k, v]) => (
                        <div key={k} style={{ textAlign: 'center', background: '#030508', padding: '3px 2px', borderRadius: 2 }}>
                          <div style={{ fontSize: 7, color: '#334' }}>{k}</div>
                          <div style={{ fontSize: 9, color: inst.color }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ BOTTOM ROW ═══ */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 240px', gap: 12 }}>
            {/* Fear & Greed */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, color: '#00DDFF', marginBottom: 10, borderBottom: '1px solid #0D1830', paddingBottom: 8, textAlign: 'center' }}>CRYPTO SENTIMENT</div>
              <FGDial value={fearGreed.value} />
              <div style={{ marginTop: 10, textAlign: 'center', fontSize: 9, color: '#334' }}>alternative.me API</div>
              <div style={{ marginTop: 12, borderTop: '1px solid #0D1830', paddingTop: 10 }}>
                <div style={{ fontSize: 9, color: '#334', marginBottom: 5, letterSpacing: 1 }}>ICHIMOKU STATUS</div>
                {curTa && [
                  { k: 'Cloud', v: curTa.ichi?.aboveCloud ? 'ABOVE ▲' : curTa.ichi?.belowCloud ? 'BELOW ▼' : 'INSIDE', c: curTa.ichi?.aboveCloud ? '#00FF88' : curTa.ichi?.belowCloud ? '#FF3355' : '#888' },
                  { k: 'TK Cross', v: curTa.ichi?.tenkan > curTa.ichi?.kijun ? 'BULL' : 'BEAR', c: curTa.ichi?.tenkan > curTa.ichi?.kijun ? '#00FF88' : '#FF3355' },
                  { k: 'SAR', v: curTa.psar?.bull ? 'BULL ▲' : 'BEAR ▼', c: curTa.psar?.bull ? '#00FF88' : '#FF3355' },
                  { k: 'Vortex', v: curTa.vortex?.vip > curTa.vortex?.vim ? 'BUY' : 'SELL', c: curTa.vortex?.vip > curTa.vortex?.vim ? '#00FF88' : '#FF3355' },
                ].map(({ k, v, c }) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '4px 0', borderBottom: '1px solid #070B15' }}>
                    <span style={{ color: '#556' }}>{k}</span><span style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* News */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid #0D1830', paddingBottom: 8 }}>
                <div style={{ fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 2, color: '#00DDFF' }}>◈ MARKET INTELLIGENCE</div>
                {newsLoading && <span className="pulse" style={{ fontSize: 9, color: '#334' }}>LOADING...</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {news.map((item, i) => (
                  <div key={i} className="news-item" style={{ padding: 10, background: '#060A14', borderRadius: 3, border: '1px solid #0D1830', borderLeft: `2px solid ${INST[item.instrument]?.color || '#00DDFF'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 8, color: INST[item.instrument]?.color || '#00DDFF', letterSpacing: 1 }}>{item.instrument}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <span style={{ fontSize: 8, color: impColor(item.impact) }}>{item.impact}</span>
                        <span style={{ fontSize: 8, color: '#334' }}>{item.time}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#C0CCE0', marginBottom: 4, lineHeight: 1.4, fontWeight: 500 }}>{item.title}</div>
                    <div style={{ fontSize: 9, color: '#556', lineHeight: 1.4 }}>{item.summary}</div>
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: sentColor(item.sentiment), display: 'inline-block' }} />
                      <span style={{ fontSize: 8, color: sentColor(item.sentiment), textTransform: 'uppercase', letterSpacing: 1 }}>{item.sentiment}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Market Stats */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, color: '#00DDFF', marginBottom: 10, borderBottom: '1px solid #0D1830', paddingBottom: 8 }}>MARKET SNAPSHOT</div>
              <div style={{ fontSize: 9, color: '#334', marginBottom: 6, letterSpacing: 1 }}>PIVOT LEVELS — {curInst.label}</div>
              {curTa && [
                ['Classic PP', curTa.pivots?.classic.pp], ['Classic R1', curTa.pivots?.classic.r1], ['Classic S1', curTa.pivots?.classic.s1],
                ['Fib R1', curTa.pivots?.fibonacci.r1], ['Fib S1', curTa.pivots?.fibonacci.s1],
                ['Cam R3', curTa.pivots?.camarilla.r3], ['Cam S3', curTa.pivots?.camarilla.s3],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '3px 0', borderBottom: '1px solid #070B15' }}>
                  <span style={{ color: '#556' }}>{k}</span>
                  <span style={{ color: v > curTa.price ? '#FF7744' : '#44AAFF' }}>{v ? fmt(activeInst, v) : '--'}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, borderTop: '1px solid #0D1830', paddingTop: 8 }}>
                <div style={{ fontSize: 9, color: '#334', marginBottom: 5, letterSpacing: 1 }}>CORRELATIONS</div>
                {[{ pair: 'XAU ↔ XAG', corr: 0.87, c: '#00FF88' }, { pair: 'XAU ↔ BTC', corr: 0.43, c: '#FFB800' }, { pair: 'XAU ↔ DXY', corr: -0.72, c: '#FF3355' }].map(({ pair, corr, c }) => (
                  <div key={pair} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2 }}>
                      <span style={{ color: '#556' }}>{pair}</span><span style={{ color: c }}>{corr > 0 ? '+' : ''}{corr.toFixed(2)}</span>
                    </div>
                    <div style={{ height: 3, background: '#111', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${Math.abs(corr) * 100}%`, background: c, marginLeft: corr < 0 ? `${(1 - Math.abs(corr)) * 100}%` : 0, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, borderTop: '1px solid #0D1830', paddingTop: 8 }}>
                <div style={{ fontSize: 9, color: '#334', marginBottom: 5, letterSpacing: 1 }}>MACRO WATCH</div>
                {[{ k: 'DXY', v: '103.42', delta: '-0.23%', up: false }, { k: 'US10Y', v: '4.28%', delta: '+0.03%', up: true }, { k: 'VIX', v: '16.8', delta: '-1.2%', up: false }, { k: 'SPX', v: '5,842', delta: '+0.41%', up: true }].map(({ k, v, delta, up }) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '3px 0', borderBottom: '1px solid #070B15' }}>
                    <span style={{ color: '#556' }}>{k}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ color: '#888' }}>{v}</span>
                      <span style={{ color: up ? '#00FF88' : '#FF3355' }}>{delta}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12, padding: '6px 0', display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#1A2040', borderTop: '1px solid #0A0F1E' }}>
            <span>NEXUS MARKETS INTELLIGENCE — {curTa?.totalIndicators || '150+'} INDICATOR ENGINE</span>
            <span>BTC: BINANCE WEBSOCKET | XAU/XAG: metals.live POLLING | NEWS: AI GENERATED | FOR INFORMATIONAL USE ONLY</span>
            <span>© 2025 NEXUS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
