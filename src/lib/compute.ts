import { integrate, meanWindow } from "./signal";
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
