/** Natural cubic spline. Fewer than 3 points fall back to linear / constant. */
export function createSpline(xsIn: number[], ysIn: number[]): (x: number) => number {
  const pairs = xsIn
    .map((x, i) => ({ x, y: ysIn[i] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of pairs) {
    if (xs.length && Math.abs(p.x - xs[xs.length - 1]) < 1e-9) {
      ys[ys.length - 1] = (ys[ys.length - 1] + p.y) / 2;
    } else {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const n = xs.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0];
  if (n === 2) {
    const d = xs[1] - xs[0] || 1;
    const k = (ys[1] - ys[0]) / d;
    return (x) => ys[0] + k * (x - xs[0]);
  }

  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) h.push(xs[i + 1] - xs[i] || 1e-12);
  const m = new Array<number>(n).fill(0);
  const len = n - 2;
  const B = new Array<number>(len);
  const C = new Array<number>(len);
  const D = new Array<number>(len);
  const A = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const k = i + 1;
    A[i] = h[k - 1];
    B[i] = 2 * (h[k - 1] + h[k]);
    C[i] = h[k];
    D[i] = 6 * ((ys[k + 1] - ys[k]) / h[k] - (ys[k] - ys[k - 1]) / h[k - 1]);
  }
  for (let i = 1; i < len; i++) {
    const w = A[i] / B[i - 1];
    B[i] -= w * C[i - 1];
    D[i] -= w * D[i - 1];
  }
  const mm = new Array<number>(len);
  mm[len - 1] = D[len - 1] / B[len - 1];
  for (let i = len - 2; i >= 0; i--) mm[i] = (D[i] - C[i] * mm[i + 1]) / B[i];
  for (let i = 0; i < len; i++) m[i + 1] = mm[i];

  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h0 = xs[hi] - xs[lo] || 1e-12;
    const aa = (xs[hi] - x) / h0;
    const bb = (x - xs[lo]) / h0;
    return (
      aa * ys[lo] +
      bb * ys[hi] +
      ((aa * aa * aa - aa) * m[lo] + (bb * bb * bb - bb) * m[hi]) * ((h0 * h0) / 6)
    );
  };
}

export function splineSamples(
  fn: (x: number) => number,
  a: number,
  b: number,
  n = 80,
): { x: number; y: number }[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: { x: number; y: number }[] = [];
  const steps = Math.max(2, n);
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    out.push({ x, y: fn(x) });
  }
  return out;
}
