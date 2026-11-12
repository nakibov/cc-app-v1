import { evalPoly, polyLabel } from "./fit";
import type { CalibPoint, Fit, Pair, QmsData, Spectrum } from "./types";

export const PROJECT_VERSION = 2;

export type ProjectFile = {
  type: "cc-calibration";
  version: number;
  molecule: string;
  bandStrength: number | null;
  bandNote?: string;
  units: string;
  channelMass: number;
  wnMin: number;
  wnMax: number;
  shareBaseline: boolean;
  polyOrder: number;
  polynomial: Fit | null;
  points: CalibPoint[];
  manualPoints?: CalibPoint[];
  omittedPairIds?: string[];
  pairs: Pair[];
  qms?: QmsData;
  spectra?: Spectrum[];
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const now = dosTime(new Date());
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, file.data);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const blobParts = [...locals, ...centrals, end] as unknown as BlobPart[];
  return new Blob(blobParts, { type: "application/zip" });
}

export async function unzipStore(buf: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const files: { name: string; data: Uint8Array }[] = [];
  let p = 0;
  while (p + 4 <= bytes.length) {
    const sig = view.getUint32(p, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(p + 8, true);
    const compSize = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    const data = bytes.slice(start, start + compSize);
    if (method !== 0) throw new Error("Архив сжат, откройте calibration.json");
    files.push({ name, data });
    p = start + compSize;
  }
  return files;
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(2);
  return String(Math.round(v * 1000) / 1000);
}

export function renderCalibrationPng(opts: {
  molecule: string;
  units: string;
  points: CalibPoint[];
  fit: Fit | null;
  bandStrength: number | null;
  bandNote?: string;
}): Blob {
  const w = 1400;
  const h = 900;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return new Blob();
  g.fillStyle = "#f6f8f8";
  g.fillRect(0, 0, w, h);
  const m = { l: 120, r: 48, t: 90, b: 90 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const xs = [0, ...opts.points.map((p) => p.meanI)];
  const ys = [0, ...opts.points.map((p) => p.rate)];
  let xMax = Math.max(...xs, 0);
  let yMax = Math.max(...ys, 0);
  let yMin = Math.min(...ys, 0);
  if (opts.fit) {
    for (let i = 0; i <= 80; i++) {
      const x = (xMax * i) / 80;
      const y = evalPoly(opts.fit.coeffs, x);
      if (y > yMax) yMax = y;
      if (y < yMin) yMin = y;
    }
  }
  if (xMax === 0) xMax = 1;
  if (yMax === yMin) {
    yMax += 1;
    yMin -= 1;
  }
  const xPad = xMax * 0.08;
  const yPad = (yMax - yMin) * 0.12;
  const X0 = 0;
  const X1 = xMax + xPad;
  const Y0 = yMin - yPad;
  const Y1 = yMax + yPad;
  const X = (x: number) => m.l + ((x - X0) / (X1 - X0)) * pw;
  const Y = (y: number) => m.t + ((Y1 - y) / (Y1 - Y0)) * ph;

  g.strokeStyle = "#d2dcde";
  g.lineWidth = 1;
  g.font = "16px 'IBM Plex Sans', sans-serif";
  g.fillStyle = "#5c6c73";
  for (let i = 0; i <= 5; i++) {
    const x = X0 + ((X1 - X0) * i) / 5;
    const y = Y0 + ((Y1 - Y0) * i) / 5;
    g.beginPath();
    g.moveTo(X(x), m.t);
    g.lineTo(X(x), m.t + ph);
    g.stroke();
    g.beginPath();
    g.moveTo(m.l, Y(y));
    g.lineTo(m.l + pw, Y(y));
    g.stroke();
    g.fillStyle = "#5c6c73";
    g.textAlign = "center";
    g.fillText(fmt(x), X(x), m.t + ph + 28);
    g.textAlign = "right";
    g.fillText(fmt(y), m.l - 12, Y(y) + 5);
  }
  g.strokeStyle = "#1b2428";
  g.lineWidth = 1.5;
  g.strokeRect(m.l, m.t, pw, ph);

  if (opts.fit) {
    g.beginPath();
    g.strokeStyle = "#0f5f5c";
    g.lineWidth = 2.5;
    for (let i = 0; i <= 200; i++) {
      const x = (X1 * i) / 200;
      const y = evalPoly(opts.fit.coeffs, x);
      const px = X(x);
      const py = Y(y);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }

  opts.points.forEach((p, i) => {
    g.beginPath();
    g.fillStyle = "#b85a32";
    g.arc(X(p.meanI), Y(p.rate), 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1b2428";
    g.font = "15px 'IBM Plex Sans', sans-serif";
    g.textAlign = "left";
    g.fillText(String(i + 1), X(p.meanI) + 10, Y(p.rate) - 10);
  });
  g.beginPath();
  g.fillStyle = "#0f5f5c";
  g.arc(X(0), Y(0), 6, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = "#1b2428";
  g.font = "32px 'IBM Plex Sans', sans-serif";
  g.textAlign = "left";
  g.fillText(`${opts.molecule} cc`, m.l, 48);
  g.font = "18px 'IBM Plex Sans', sans-serif";
  g.fillStyle = "#5c6c73";
  g.textAlign = "center";
  g.fillText(`средний ионный ток, ${opts.units}`, m.l + pw / 2, h - 28);
  g.save();
  g.translate(36, m.t + ph / 2);
  g.rotate(-Math.PI / 2);
  g.fillText("скорость осаждения", 0, 0);
  g.restore();
  if (opts.fit) {
    g.textAlign = "left";
    g.font = "16px 'IBM Plex Mono', monospace";
    g.fillStyle = "#0f5f5c";
    const eq = polyLabel(opts.fit);
    g.fillText(eq.length > 90 ? eq.slice(0, 90) + "…" : eq, m.l, 78);
  }
  if (opts.bandStrength || opts.bandNote) {
    g.textAlign = "right";
    g.font = "16px 'IBM Plex Sans', sans-serif";
    g.fillStyle = "#5c6c73";
    const note = opts.bandNote?.trim();
    const s = opts.bandStrength ? opts.bandStrength.toExponential(3) : "—";
    const label = note ? `S = ${s}, ${note}` : `S = ${s}`;
    g.fillText(label.length > 64 ? label.slice(0, 64) + "…" : label, w - m.r, 48);
  }

  const bin = atob(canvas.toDataURL("image/png").split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: "image/png" });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;")
    .replace(/'/g, "&#39;");
}

export function calibrationHtml(opts: {
  molecule: string;
  units: string;
  points: CalibPoint[];
  fit: Fit | null;
  bandStrength: number | null;
  bandNote?: string;
  bandText?: string;
  order?: number;
}): string {
  const payload = {
    molecule: opts.molecule,
    units: opts.units,
    points: opts.points.map((p, i) => ({
      id: p.id || `p${i}`,
      spectrum: p.spectrum,
      meanI: p.meanI,
      rate: p.rate,
      time: p.time,
      k: p.k,
      irArea: p.irArea,
    })),
    order: opts.order || opts.fit?.order || 1,
    coeffs: opts.fit?.coeffs ?? [],
    bandStrength: opts.bandStrength,
    bandNote: opts.bandNote ?? "",
    bandText: opts.bandText || (opts.bandStrength != null ? String(opts.bandStrength) : ""),
  };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const molecule = escHtml(opts.molecule || "X");
  const units = escHtml(opts.units || "");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>cc app — ${molecule}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; background: #e6ecee; color: #1b2428; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-weight: 560; font-size: 28px; margin: 0 0 4px; }
  p.sub { margin: 0 0 16px; color: #5c6c73; }
  canvas { width: 100%; height: auto; background: #f6f8f8; border: 1px solid #d2dcde; border-radius: 12px; touch-action: none; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; align-items: end; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #5c6c73; flex: 1; min-width: 160px; }
  input, button { font: 15px/1.4 "IBM Plex Mono", ui-monospace, monospace; }
  input { padding: 10px 12px; border-radius: 8px; border: 1px solid #d2dcde; background: #f6f8f8; color: #1b2428; min-width: 0; }
  button { cursor: pointer; border: 1px solid #d2dcde; background: #f6f8f8; color: #1b2428; border-radius: 999px; padding: 8px 14px; }
  button.primary { background: #0f5f5c; color: #f4fbfa; border-color: #0f5f5c; }
  .eq { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; color: #0f5f5c; word-break: break-all; }
  .hint { color: #8f2d2d; min-height: 1.2em; font-size: 13px; }
  .band { margin: 18px 0 0; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d2dcde; white-space: nowrap; }
  th { color: #5c6c73; font-weight: 500; }
  td { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
  .wrap { overflow-x: auto; }
</style>
</head>
<body>
<main>
  <h1>cc app</h1>
  <p class="sub">Калибровочная кривая. Колёсико меняет масштаб, двойной щелчок сбрасывает его. Точки можно добавить и убрать — полином перестроится. <span id="bandUsed"></span></p>
  <canvas id="c" width="1200" height="720"></canvas>
  <p class="eq" id="eq"></p>
  <div class="row">
    <label>Ток, ${units}<input id="i" placeholder="6e-7" inputmode="decimal"/></label>
    <label>Скорость<input id="v" placeholder="скорость осаждения" inputmode="decimal"/></label>
  </div>
  <p class="hint" id="hint"></p>
  <div class="wrap">
    <table>
      <thead><tr><th>#</th><th>спектр</th><th>⟨I⟩</th><th>скорость</th><th>Δt, с</th><th>k</th><th>S_IR</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <div class="row">
    <label>Новая точка, ток<input id="addI" placeholder="6e-7" inputmode="decimal"/></label>
    <label>Новая точка, скорость<input id="addV" placeholder="скорость" inputmode="decimal"/></label>
    <button type="button" class="primary" id="add">Добавить</button>
  </div>
  <div class="band-edit" style="margin-top:18px">
    <button type="button" id="editBand">Изменить силу полосы</button>
    <div id="bandForm" style="display:none; margin-top:8px">
      <label>Сила полосы A <input id="bandInput" /></label>
      <button type="button" id="saveBand">Сохранить</button>
      <button type="button" id="resetBand">Сбросить</button>
      <p class="hint" id="bandHint">Изменения не сохранены</p>
    </div>
  </div>
</main>
<script id="cc-data" type="application/json">${json}</script>
<script>
const data = JSON.parse(document.getElementById("cc-data").textContent);
data.points.forEach((p, i) => { if (!p.id) p.id = "p" + i; });
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const eq = document.getElementById("eq");
const hint = document.getElementById("hint");
const iEl = document.getElementById("i");
const vEl = document.getElementById("v");
const rows = document.getElementById("rows");
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    if (piv !== col) { const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp; }
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}
function fitOrigin(order) {
  const pts = data.points.filter((p) => Number.isFinite(p.meanI) && Number.isFinite(p.rate) && p.meanI !== 0);
  if (!pts.length) { data.coeffs = []; return; }
  let n = Math.max(1, Math.min(5, order | 0, pts.length));
  const scale = pts.reduce((s, p) => s + Math.abs(p.meanI), 0) / pts.length || 1;
  const build = (ord) => {
    const G = [], rhs = [];
    for (let r = 0; r < ord; r++) {
      const row = [];
      let bb = 0;
      for (let c = 0; c < ord; c++) {
        let s = 0;
        const pow = r + c + 2;
        for (const p of pts) s += Math.pow(p.meanI / scale, pow);
        row.push(s);
      }
      for (const p of pts) bb += p.rate * Math.pow(p.meanI / scale, r + 1);
      G.push(row);
      rhs.push(bb);
    }
    return solve(G, rhs);
  };
  let scaled = null;
  while (n >= 1) {
    scaled = build(n);
    if (scaled && scaled.every((v) => Number.isFinite(v))) break;
    n -= 1;
    scaled = null;
  }
  data.coeffs = scaled ? scaled.map((bk, i) => bk / Math.pow(scale, i + 1)) : [];
}
function ev(x) {
  const coeffs = data.coeffs || [];
  let s = 0, p = x;
  for (const a of coeffs) { s += a * p; p *= x; }
  return s;
}
function invert(y) {
  const coeffs = data.coeffs || [];
  if (!coeffs.length || !Number.isFinite(y)) return null;
  if (Math.abs(y) < 1e-18) return 0;
  if (coeffs.length === 1) return coeffs[0] === 0 ? null : (y / coeffs[0] >= 0 ? y / coeffs[0] : null);
  const xs = data.points.map((p) => Math.abs(p.meanI));
  const xMax = Math.max(1e-30, ...xs, 1e-30) * 6;
  let prevU = 0, prev = ev(0) - y, best = null;
  for (let i = 1; i <= 600; i++) {
    const u = xMax * i / 600;
    const val = ev(u) - y;
    if (prev * val < 0) {
      let a = prevU, b = u, fa = prev;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2, fm = ev(m) - y;
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      const r = (a + b) / 2;
      if (r >= 0 && (best === null || r < best)) best = r;
    }
    prevU = u; prev = val;
  }
  return best;
}
let view = null;
function home() {
  const xs = [0, ...data.points.map((p) => p.meanI)];
  const ys = [0, ...data.points.map((p) => p.rate)];
  let x1 = Math.max(...xs, 1e-30) * 1.12;
  let y1 = Math.max(...ys, 0);
  const coeffs = data.coeffs || [];
  if (coeffs.length) {
    for (let i = 0; i <= 60; i++) { const y = ev(x1 * i / 60); if (y > y1) y1 = y; }
  }
  if (y1 <= 0) y1 = 1;
  const pad = y1 * 0.12;
  return { x0: 0, x1, y0: 0, y1: y1 + pad };
}
function fmt(v) {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a < 0.01 || a >= 10000) return v.toExponential(2);
  return String(Math.round(v * 1000) / 1000);
}
function draw() {
  const V = view || home();
  const W = canvas.width, H = canvas.height;
  const m = { l: 96, r: 28, t: 36, b: 64 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = (x) => m.l + (x - V.x0) / (V.x1 - V.x0) * pw;
  const Y = (y) => m.t + (V.y1 - y) / (V.y1 - V.y0) * ph;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#f6f8f8";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#d2dcde";
  ctx.lineWidth = 1;
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#5c6c73";
  for (let i = 0; i <= 5; i++) {
    const x = V.x0 + (V.x1 - V.x0) * i / 5;
    const y = V.y0 + (V.y1 - V.y0) * i / 5;
    ctx.beginPath(); ctx.moveTo(X(x), m.t); ctx.lineTo(X(x), m.t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(m.l, Y(y)); ctx.lineTo(m.l + pw, Y(y)); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillText(fmt(x), X(x), m.t + ph + 22);
    ctx.textAlign = "right"; ctx.fillText(fmt(y), m.l - 8, Y(y) + 4);
  }
  ctx.strokeStyle = "#1b2428"; ctx.strokeRect(m.l, m.t, pw, ph);
  const coeffs = data.coeffs || [];
  if (coeffs.length) {
    ctx.beginPath(); ctx.strokeStyle = "#0f5f5c"; ctx.lineWidth = 2;
    for (let i = 0; i <= 200; i++) {
      const x = V.x0 + (V.x1 - V.x0) * i / 200;
      const y = ev(x);
      if (i === 0) ctx.moveTo(X(x), Y(y)); else ctx.lineTo(X(x), Y(y));
    }
    ctx.stroke();
  }
  data.points.forEach((p, i) => {
    ctx.beginPath(); ctx.fillStyle = "#b85a32"; ctx.arc(X(p.meanI), Y(p.rate), 6, 0, 6.3); ctx.fill();
    ctx.fillStyle = "#1b2428"; ctx.textAlign = "left"; ctx.fillText(String(i + 1), X(p.meanI) + 8, Y(p.rate) - 8);
  });
  ctx.beginPath(); ctx.fillStyle = "#0f5f5c"; ctx.arc(X(0), Y(0), 5, 0, 6.3); ctx.fill();
  ctx.fillStyle = "#5c6c73"; ctx.textAlign = "center";
  ctx.fillText("средний ионный ток, " + (data.units || ""), m.l + pw / 2, H - 16);
  ctx.save();
  ctx.translate(18, m.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("скорость", 0, 0);
  ctx.restore();
}
function refreshText() {
  const coeffs = data.coeffs || [];
  const parts = coeffs.map((a, i) => a.toExponential(3) + (i === 0 ? "·I" : "·I^" + (i + 1)));
  eq.textContent = coeffs.length ? ("v = " + parts.join(" + ")) : "Нет полинома";
  const raw = String(data.bandText || data.bandStrength || "").trim();
  const note = String(data.bandNote || "").trim();
  const used = raw ? ("Использована следующая сила полосы: " + raw + (note ? ", " + note : "")) : "";
  const bandUsed = document.getElementById("bandUsed");
  if (bandUsed) bandUsed.textContent = used;
  rows.innerHTML = "";
  data.points.forEach((p, i) => {
    const tr = document.createElement("tr");
    const tStr = Number.isFinite(p.time) && p.time ? p.time.toFixed(1) : "—";
    const kStr = Number.isFinite(p.k) ? Number(p.k).toPrecision(3).replace(/\.0+$/, "") : "—";
    const sStr = Number.isFinite(p.irArea) ? Number(p.irArea).toPrecision(3).replace(/\.0+$/, "") : "—";
    const cells = [String(i + 1), p.spectrum || "", fmt(p.meanI), fmt(p.rate), tStr, kStr, sStr];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Убрать";
    btn.addEventListener("click", () => {
      data.points.splice(i, 1);
      fitOrigin(data.order || 1);
      view = null;
      refreshText();
      draw();
    });
    td.appendChild(btn);
    tr.appendChild(td);
    rows.appendChild(tr);
  });
}
function parse(s) {
  const t = String(s).trim().replace(/\\s/g, "").replace(/,/g, ".").replace(/[еЕ]/g, "e").replace(/[−–—]/g, "-");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
iEl.addEventListener("change", () => {
  const x = parse(iEl.value); hint.textContent = "";
  if (x === null) { hint.textContent = "Не число"; return; }
  if (!(data.coeffs || []).length) { hint.textContent = "Нет аппроксимации"; return; }
  vEl.value = ev(x).toExponential(4);
});
vEl.addEventListener("change", () => {
  const y = parse(vEl.value); hint.textContent = "";
  if (y === null) { hint.textContent = "Не число"; return; }
  const x = invert(y);
  if (x === null) { hint.textContent = "Кривая не принимает такое значение"; return; }
  iEl.value = x.toExponential(4);
});
document.getElementById("add").addEventListener("click", () => {
  const x = parse(document.getElementById("addI").value);
  const y = parse(document.getElementById("addV").value);
  hint.textContent = "";
  if (x === null || y === null) { hint.textContent = "Нужны ток и скорость"; return; }
  data.points.push({ id: "m" + Date.now(), spectrum: "вручную", meanI: x, rate: y, time: 0, k: 1 });
  document.getElementById("addI").value = "";
  document.getElementById("addV").value = "";
  fitOrigin(data.order || 1);
  view = null;
  refreshText();
  draw();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const V = view || home();
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width * canvas.width;
  const m = { l: 96, r: 28 };
  const pw = canvas.width - m.l - m.r;
  const t = Math.min(1, Math.max(0, (px - m.l) / pw));
  const x = V.x0 + t * (V.x1 - V.x0);
  const f = e.deltaY > 0 ? 1.25 : 0.8;
  const span = (V.x1 - V.x0) * f;
  view = { x0: x - t * span, x1: x - t * span + span, y0: V.y0, y1: V.y1 };
  draw();
}, { passive: false });
canvas.addEventListener("dblclick", () => { view = null; draw(); });
const editBand = document.getElementById("editBand");
const bandForm = document.getElementById("bandForm");
const bandInput = document.getElementById("bandInput");
const saveBand = document.getElementById("saveBand");
const resetBand = document.getElementById("resetBand");
const bandHint = document.getElementById("bandHint");
if (editBand) editBand.addEventListener("click", () => {
  bandForm.style.display = "block";
  bandInput.value = data.bandText || "";
  bandHint.style.display = "block";
});
if (saveBand) saveBand.addEventListener("click", () => {
  const raw = bandInput.value.trim();
  const v = parse(raw);
  data.bandText = raw;
  data.bandStrength = v;
  // Recompute rates for non-manual points if possible
  if (v && v !== 0) {
    data.points.forEach((p) => {
      if (p.irArea && p.time && p.k && p.spectrum !== "вручную") {
        p.rate = (p.irArea * Math.LN10 * p.k) / (p.time * v);
      }
    });
  }
  fitOrigin(data.order || 1);
  view = null;
  bandForm.style.display = "none";
  refreshText();
  draw();
});
if (resetBand) resetBand.addEventListener("click", () => {
  bandForm.style.display = "none";
});
refreshText();
draw();
</script>
</body>
</html>`;
}

export function pointsCsv(points: CalibPoint[], units: string): string {
  const head = `spectrum,time_s,mean_current_${units},S_good,S_full,k,ir_area,rate`;
  const rows = points.map((p) =>
    [p.spectrum, p.time, p.meanI, p.sGood, p.sFull, p.k, p.irArea, p.rate]
      .map((v) => (typeof v === "number" ? v.toExponential(8) : v))
      .join(","),
  );
  return [head, ...rows].join("\n");
}
