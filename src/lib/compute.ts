import { integrate, lowerBound, meanWindow } from "./signal";
import { createSpline } from "./spline";
import type { Pair, PairResult, Spectrum } from "./types";

const QMS_HALF = 7.5;
const IR_HALF = 2;

export function baselineLine(
  time: number[],
  signal: number[],
  a: number,
  b: number,
): { x1: number; y1: number; x2: number; y2: number; at: (x: number) => number } {
  const x1 = Math.min(a, b);
  const x2 = Math.max(a, b);
  const y1 = meanWindow(time, signal, x1, QMS_HALF);
  const y2 = meanWindow(time, signal, x2, QMS_HALF);
  const span = x2 - x1 || 1;
  const at = (x: number) => y1 + ((y2 - y1) * (x - x1)) / span;
  return { x1, y1, x2, y2, at };
}

export function irBaseline(
  spec: Spectrum,
  pair: Pair,
): { fn: (w: number) => number; y1: number; y2: number } {
  const w1 = Math.min(pair.ir1, pair.ir2);
  const w2 = Math.max(pair.ir1, pair.ir2);
  const y1 = meanWindow(spec.wn, spec.abs, w1, IR_HALF);
  const y2 = meanWindow(spec.wn, spec.abs, w2, IR_HALF);
  const xs = [w1];
  const ys = [y1];
  const knots = [...pair.knots].sort((a, b) => a.wn - b.wn);
  for (const k of knots) {
    if (k.wn > w1 + 0.05 && k.wn < w2 - 0.05) {
      xs.push(k.wn);
      ys.push(k.abs);
    }
  }
  xs.push(w2);
  ys.push(y2);
  return { fn: createSpline(xs, ys), y1, y2 };
}

export function computePair(
  time: number[],
  signal: number[],
  spec: Spectrum | undefined,
  pair: Pair,
  bandStrength: number | null,
): PairResult {
  const warnings: string[] = [];
  const base = baselineLine(time, signal, pair.base1, pair.base2);
  const sub = pair.subtract ? base.at : null;
  const sGood = integrate(time, signal, pair.span1, pair.span2, sub);
  const timeSpan = Math.abs(pair.span2 - pair.span1);
  const meanI = timeSpan > 0 ? sGood / timeSpan : 0;
  const fullA = pair.fullMode === "manual" ? pair.corr1 : pair.base1;
  const fullB = pair.fullMode === "manual" ? pair.corr2 : pair.base2;
  const sFull = integrate(time, signal, fullA, fullB, sub);
  let k = 1;
  if (Math.abs(sFull) < Math.max(1e-30, Math.abs(sGood) * 1e-9)) {
    warnings.push("S_full ≈ 0, коэффициент принят равным 1");
  } else {
    k = sGood / sFull;
  }
  if (!(timeSpan > 0)) warnings.push("Нулевая длительность окна площади");

  let irArea = 0;
  if (spec) {
    const w1 = Math.min(pair.ir1, pair.ir2);
    const w2 = Math.max(pair.ir1, pair.ir2);
    const baseFn = pair.irCorrect ? irBaseline(spec, pair).fn : null;
    irArea = integrate(spec.wn, spec.abs, w1, w2, baseFn);
  } else {
    warnings.push("Нет спектра для этой пары");
  }
  const optical = irArea * Math.LN10;
  let rate: number | null = null;
  if (!(bandStrength && bandStrength !== 0)) {
    warnings.push("Не задана сила полосы");
  } else if (timeSpan > 0) {
    rate = (optical * k) / (timeSpan * bandStrength);
  }
  return {
    time: timeSpan,
    sGood,
    sFull,
    k,
    meanI,
    irArea,
    optical,
    rate,
    baseY1: base.y1,
    baseY2: base.y2,
    warnings,
  };
}

/**
 * Area window inside an already chosen QMS rectangle.
 * The edges sit on the flat pulse, with at least `margin` seconds of that
 * same stable current on both the left and the right. Returns null when the
 * plateau is too short to keep those shoulders.
 */
export function stableAreaWindow(
  time: number[],
  signal: number[],
  a: number,
  b: number,
  margin = 10,
): { span1: number; span2: number } | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!(hi > lo) || hi - lo < margin * 2 + 1) return null;
  const i0 = lowerBound(time, lo);
  let i1 = i0;
  while (i1 < time.length && time[i1] <= hi) i1++;
  const n = i1 - i0;
  if (n < 8) return null;

  const ys = signal.slice(i0, i1);
  const sorted = [...ys].sort((p, q) => p - q);
  const pick = (f: number) => sorted[Math.min(n - 1, Math.max(0, Math.floor((n - 1) * f)))];
  const p10 = pick(0.1);
  const p90 = pick(0.9);
  const amp = p90 - p10;
  if (!(amp >= 0) || !Number.isFinite(amp)) return null;

  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(Math.abs(ys[i] - ys[i - 1]));
  diffs.sort((p, q) => p - q);
  const mad = diffs[Math.floor(diffs.length / 2)] || 0;
  const tol = Math.max(15 * mad, 0.035 * Math.max(amp, Math.abs(p90), 1e-30));
  const oneLevel = amp <= 0.12 * Math.max(Math.abs(p90), Math.abs(p10), 1e-30);
  const highCut = p90 - Math.max(0.08 * amp, 20 * mad);

  const ok = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    const t = time[i0 + k];
    const j0 = Math.max(i0, lowerBound(time, t - 2));
    let j1 = j0;
    while (j1 < i1 && time[j1] <= t + 2) j1++;
    let mn = Infinity;
    let mx = -Infinity;
    for (let j = j0; j < j1; j++) {
      const v = signal[j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const flat = mx - mn <= tol;
    const high = oneLevel || signal[i0 + k] >= highCut;
    ok[k] = flat && high;
  }

  for (let k = 0; k < n; ) {
    if (ok[k]) {
      k++;
      continue;
    }
    let g = k;
    while (g < n && !ok[g]) g++;
    if (k > 0 && g < n && g - k <= 3 && time[i0 + g] - time[i0 + k - 1] <= 4) {
      for (let j = k; j < g; j++) ok[j] = true;
    }
    k = Math.max(g, k + 1);
  }

  let bestL = -1;
  let bestR = -1;
  let run = -1;
  for (let k = 0; k <= n; k++) {
    if (k < n && ok[k]) {
      if (run < 0) run = k;
    } else if (run >= 0) {
      if (k - run > bestR - bestL) {
        bestL = run;
        bestR = k;
      }
      run = -1;
    }
  }
  if (bestL < 0) return null;
  const tStart = time[i0 + bestL];
  const tEnd = time[i0 + bestR - 1];
  if (tEnd - tStart < margin * 2 + 1) return null;
  const span1 = Math.max(lo, tStart + margin);
  const span2 = Math.min(hi, tEnd - margin);
  if (!(span2 - span1 > 1) || span1 - tStart < margin - 0.6 || tEnd - span2 < margin - 0.6) return null;
  return { span1, span2 };
}
