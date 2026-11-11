import type { Fit } from "./types";

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    if (piv !== col) {
      const tmp = M[col];
      M[col] = M[piv];
      M[piv] = tmp;
    }
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/** y = a1 x + a2 x^2 + … + an x^n. Scaled internally. Includes no intercept. */
export function fitOrigin(xs: number[], ys: number[], order: number): Fit | null {
  const pts = xs
    .map((x, i) => ({ x, y: ys[i] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x !== 0);
  if (pts.length === 0) return null;
  let n = Math.max(1, Math.min(5, Math.floor(order), pts.length));
  const scale =
    pts.reduce((s, p) => s + Math.abs(p.x), 0) / pts.length || 1;

  const build = (ord: number) => {
    const G: number[][] = [];
    const rhs: number[] = [];
    for (let r = 0; r < ord; r++) {
      const row: number[] = [];
      let b = 0;
      for (let c = 0; c < ord; c++) {
        let s = 0;
        const pow = r + c + 2;
        for (const p of pts) {
          const u = p.x / scale;
          s += Math.pow(u, pow);
        }
        row.push(s);
      }
      const pb = r + 1;
      for (const p of pts) b += p.y * Math.pow(p.x / scale, pb);
      G.push(row);
      rhs.push(b);
    }
    return solve(G, rhs);
  };

  let scaled: number[] | null = null;
  while (n >= 1) {
    scaled = build(n);
    if (scaled && scaled.every((v) => Number.isFinite(v))) break;
    n -= 1;
    scaled = null;
  }
  if (!scaled) return null;
  const coeffs = scaled.map((bk, i) => bk / Math.pow(scale, i + 1));
  const predict = (x: number) => evalPoly(coeffs, x);
  let ssTot = 0;
  let ssRes = 0;
  const mean = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  for (const p of pts) {
    const e = p.y - predict(p.x);
    ssRes += e * e;
    const d = p.y - mean;
    ssTot += d * d;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { order: n, coeffs, scale, r2 };
}

export function evalPoly(coeffs: number[], x: number): number {
  let s = 0;
  let xp = x;
  for (let i = 0; i < coeffs.length; i++) {
    s += coeffs[i] * xp;
    xp *= x;
  }
  return s;
}

/** Smallest non-negative x such that p(x) ≈ y. Null if the curve never reaches it. */
export function invertPoly(fit: Fit, yTarget: number): number | null {
  if (!Number.isFinite(yTarget)) return null;
  if (Math.abs(yTarget) < 1e-18) return 0;
  const { coeffs, scale } = fit;
  const b = coeffs.map((a, i) => a * Math.pow(scale, i + 1));
  const f = (u: number) => {
    let s = 0;
    for (let k = b.length - 1; k >= 0; k--) s = (s + b[k]) * u;
    return s;
  };
  if (coeffs.length === 1) {
    if (coeffs[0] === 0) return null;
    const x = yTarget / coeffs[0];
    return x >= 0 ? x : null;
  }
  const uMax = 8;
  const steps = 800;
  const roots: number[] = [];
  let prevU = 0;
  let prev = f(0) - yTarget;
  for (let i = 1; i <= steps; i++) {
    const u = (uMax * i) / steps;
    const val = f(u) - yTarget;
    if (prev === 0) roots.push(prevU * scale);
    else if (prev * val < 0) {
      let a = prevU;
      let b2 = u;
      let fa = prev;
      for (let k = 0; k < 50; k++) {
        const m = (a + b2) / 2;
        const fm = f(m) - yTarget;
        if (fa * fm <= 0) b2 = m;
        else {
          a = m;
          fa = fm;
        }
      }
      roots.push(((a + b2) / 2) * scale);
    }
    prevU = u;
    prev = val;
  }
  const positive = roots.filter((r) => r >= 0 && Number.isFinite(r));
  if (!positive.length) return null;
  positive.sort((a, c) => a - c);
  return positive[0];
}

export function polyLabel(fit: Fit): string {
  const parts = fit.coeffs.map((a, i) => {
    const pow = i + 1;
    const coef = a.toExponential(3);
    return pow === 1 ? `${coef}·I` : `${coef}·I^${pow}`;
  });
  return `v = ${parts.join(" + ")}`;
}
