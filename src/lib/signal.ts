export function lowerBound(x: number[], v: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function meanWindow(x: number[], y: number[], x0: number, half: number): number {
  if (x.length === 0) return 0;
  const lo = lowerBound(x, x0 - half);
  const hi = lowerBound(x, x0 + half);
  let s = 0;
  let n = 0;
  for (let i = lo; i < hi; i++) {
    s += y[i];
    n++;
  }
  if (n > 0) return s / n;
  const i = Math.min(x.length - 1, Math.max(0, lo));
  return y[i] ?? 0;
}

export function sampleAt(x: number[], y: number[], xq: number): number {
  const n = x.length;
  if (n === 0) return 0;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xq) lo = mid;
    else hi = mid;
  }
  const span = x[hi] - x[lo] || 1;
  const t = (xq - x[lo]) / span;
  return y[lo] * (1 - t) + y[hi] * t;
}

/** Trapezoid ∫ y dx from a to b. `base` is subtracted when provided. */
export function integrate(
  x: number[],
  y: number[],
  a: number,
  b: number,
  base: ((x: number) => number) | null,
): number {
  const n = x.length;
  if (n < 2) return 0;
  const x1 = Math.min(a, b);
  const x2 = Math.max(a, b);
  if (!(x2 > x1)) return 0;

  const at = (xq: number) => {
    const v = sampleAt(x, y, xq);
    return base ? v - base(xq) : v;
  };

  let sum = 0;
  let px = x1;
  let py = at(x1);
  const i0 = lowerBound(x, x1);
  for (let i = i0; i < n && x[i] < x2; i++) {
    if (x[i] <= x1) continue;
    const cy = base ? y[i] - base(x[i]) : y[i];
    sum += ((cy + py) * 0.5) * (x[i] - px);
    px = x[i];
    py = cy;
  }
  const ey = at(x2);
  sum += ((ey + py) * 0.5) * (x2 - px);
  return sum;
}

export function decimate(
  x: number[],
  y: number[],
  maxPts: number,
): { x: number[]; y: number[] } {
  const n = x.length;
  if (n <= maxPts) return { x, y };
  const pairs = Math.max(1, Math.floor(maxPts / 2));
  const bucket = Math.ceil(n / pairs);
  const xo: number[] = [];
  const yo: number[] = [];
  for (let i = 0; i < n; i += bucket) {
    const end = Math.min(n, i + bucket);
    let iMin = i;
    let iMax = i;
    for (let j = i + 1; j < end; j++) {
      if (y[j] < y[iMin]) iMin = j;
      if (y[j] > y[iMax]) iMax = j;
    }
    const first = Math.min(iMin, iMax);
    const second = Math.max(iMin, iMax);
    xo.push(x[first]);
    yo.push(y[first]);
    if (second !== first) {
      xo.push(x[second]);
      yo.push(y[second]);
    }
  }
  return { x: xo, y: yo };
}

export function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const err = raw / mag;
  const nice = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return nice * mag;
}

export function ticks(a: number, b: number, count = 5): number[] {
  if (!(b > a)) return [a];
  const step = niceStep(b - a, count);
  const start = Math.ceil((a - step * 1e-8) / step) * step;
  const out: number[] = [];
  for (let v = start; v <= b + step * 1e-6 && out.length < 12; v += step) {
    if (v >= a - step * 1e-6) out.push(Number(v.toPrecision(12)));
  }
  return out;
}

export function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) {
    return v.toExponential(1).replace("e+", "e");
  }
  if (a >= 100) return String(Math.round(v));
  const digits = a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toFixed(digits).replace(/\.0+$/, "").replace(/\.$/, "");
}

/** Three significant digits, decimal (no trailing zeros stripped from integer part). */
export function fmtSig(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const s = v.toPrecision(sig);
  if (s.includes("e") || s.includes("E")) return s;
  return s.replace(/\.0+$/, "").replace(/\.$/, "");
}

/** One digit after decimal. */
export function fmtT(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(1);
}

export function fmtExp(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return v.toExponential(digits);
}

export function parseSci(raw: string): number | null {
  const t = raw
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[еЕ]/g, "e")
    .replace(/[−–—]/g, "-");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
