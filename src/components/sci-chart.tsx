import { useEffect, useId, useRef, useState } from "react";
import { fmtTick, lowerBound, ticks } from "@/lib/signal";

export type ChartLine = {
  id: string;
  x: number;
  tone: "baseline" | "correct";
  label?: string;
};

export type ChartKnot = { id: string; x: number; y: number; label?: string };

export type ChartRegion = { x1: number; x2: number; label: string };

type Drag =
  | { kind: "line"; id: string }
  | { kind: "span-edge"; edge: "l" | "r" }
  | { kind: "span-move"; grab: number; a: number; b: number }
  | { kind: "span-new"; x0: number; prev: [number, number] | null }
  | { kind: "knot"; id: string }
  | { kind: "pan"; px: number; x0: number; x1: number }
  | { kind: "click"; x: number; y: number };

const M = { l: 68, r: 14, t: 18, b: 36 };

export function SciChart({
  seriesX,
  seriesY,
  home,
  xLabel,
  yLabel,
  lines = [],
  ghostLines = [],
  onLine,
  span = null,
  onSpan,
  baseline = null,
  knots = [],
  onKnot,
  onKnotAdd,
  onKnotRemove,
  placeKnots = false,
  curve = null,
  shadeCurve = false,
  regions = [],
  onClickX,
  guideX = null,
  locked = false,
  resetToken = 0,
  clickMovesNearest = false,
}: {
  seriesX: number[];
  seriesY: number[];
  home: [number, number];
  xLabel: string;
  yLabel: string;
  lines?: ChartLine[];
  ghostLines?: ChartLine[];
  onLine?: (id: string, x: number) => void;
  span?: [number, number] | null;
  onSpan?: (a: number, b: number) => void;
  baseline?: { x1: number; y1: number; x2: number; y2: number } | null;
  knots?: ChartKnot[];
  onKnot?: (id: string, x: number, y: number) => void;
  onKnotAdd?: (x: number, y: number) => void;
  onKnotRemove?: (id: string) => void;
  placeKnots?: boolean;
  curve?: { x: number; y: number }[] | null;
  shadeCurve?: boolean;
  regions?: ChartRegion[];
  onClickX?: (x: number) => void;
  guideX?: number | null;
  locked?: boolean;
  resetToken?: string | number;
  clickMovesNearest?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId().replace(/:/g, "");
  const [size, setSize] = useState({ w: 640, h: 280 });
  const [view, setView] = useState<{ x0: number; x1: number } | null>(null);
  const [cursor, setCursor] = useState<string>("crosshair");
  const [readout, setReadout] = useState<string>("");
  const drag = useRef<Drag | null>(null);
  const moved = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(280, Math.round(r.width));
      const h = Math.max(200, Math.round(r.height));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setView(null);
  }, [resetToken]);

  const x0 = view?.x0 ?? home[0];
  const x1 = view?.x1 ?? home[1];
  const plotW = Math.max(10, size.w - M.l - M.r);
  const plotH = Math.max(10, size.h - M.t - M.b);

  let yLo = Infinity;
  let yHi = -Infinity;
  const i0 = lowerBound(seriesX, Math.min(x0, x1));
  const i1 = lowerBound(seriesX, Math.max(x0, x1));
  for (let i = i0; i < i1; i++) {
    const v = seriesY[i];
    if (v < yLo) yLo = v;
    if (v > yHi) yHi = v;
  }
  const extras: { x: number; y: number }[] = [];
  if (baseline) {
    extras.push({ x: baseline.x1, y: baseline.y1 }, { x: baseline.x2, y: baseline.y2 });
  }
  if (curve) extras.push(...curve);
  for (const k of knots) extras.push(k);
  for (const e of extras) {
    if (e.x < Math.min(x0, x1) || e.x > Math.max(x0, x1)) continue;
    if (e.y < yLo) yLo = e.y;
    if (e.y > yHi) yHi = e.y;
  }
  if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) {
    yLo = -1;
    yHi = 1;
  }
  if (yHi - yLo < Math.max(Math.abs(yHi), Math.abs(yLo), 1) * 1e-9) {
    const c = (yHi + yLo) / 2;
    const pad = Math.max(Math.abs(c) * 0.2, 1e-12);
    yLo = c - pad;
    yHi = c + pad;
  } else {
    const pad = (yHi - yLo) * 0.12;
    yLo -= pad;
    yHi += pad;
  }
  if (yLo < 0 && yHi > 0) {
    /* keep zero inside when the data crosses it */
  }

  const X = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * plotW;
  const Y = (y: number) => M.t + ((yHi - y) / (yHi - yLo || 1)) * plotH;

  const geom = useRef({ x0, x1, yLo, yHi, plotW, plotH, sizeW: size.w, sizeH: size.h });
  geom.current = { x0, x1, yLo, yHi, plotW, plotH, sizeW: size.w, sizeH: size.h };

  const cb = useRef({ onLine, onSpan, onKnot, onKnotAdd, onKnotRemove, onClickX, locked, placeKnots });
  cb.current = { onLine, onSpan, onKnot, onKnotAdd, onKnotRemove, onClickX, locked, placeKnots };

  const linesRef = useRef(lines);
  linesRef.current = lines;
  const knotsRef = useRef(knots);
  knotsRef.current = knots;
  const spanRef = useRef(span);
  spanRef.current = span;

  function locate(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const g = geom.current;
    if (!svg) return { px: 0, py: 0, x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * g.sizeW;
    const py = ((clientY - rect.top) / rect.height) * g.sizeH;
    const x = g.x0 + ((px - M.l) / g.plotW) * (g.x1 - g.x0);
    const y = g.yHi - ((py - M.t) / g.plotH) * (g.yHi - g.yLo);
    return { px, py, x, y };
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = locate(e.clientX, e.clientY);
      const g = geom.current;
      const t = (p.x - g.x0) / (g.x1 - g.x0 || 1);
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      let spanW = (g.x1 - g.x0) * factor;
      const full = Math.abs(home[1] - home[0]) || 1;
      spanW = Math.min(full * 4, Math.max(full * 0.002, spanW));
      const nx0 = p.x - t * spanW;
      setView({ x0: nx0, x1: nx0 + spanW });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [home[0], home[1]]);

  function hitLine(px: number): ChartLine | null {
    let best: ChartLine | null = null;
    let bestD = 9;
    for (const line of linesRef.current) {
      const d = Math.abs(px - X(line.x));
      if (d < bestD) {
        best = line;
        bestD = d;
      }
    }
    return best;
  }

  function hitKnot(px: number, py: number): ChartKnot | null {
    let best: ChartKnot | null = null;
    let bestD = 12;
    for (const k of knotsRef.current) {
      const d = Math.hypot(px - X(k.x), py - Y(k.y));
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    return best;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 2) return;
    const p = locate(e.clientX, e.clientY);
    moved.current = 0;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      drag.current = { kind: "pan", px: p.px, x0, x1 };
      return;
    }
    if (cb.current.locked) {
      drag.current = null;
      return;
    }
    const knot = cb.current.onKnot ? hitKnot(p.px, p.py) : null;
    if (knot) {
      drag.current = { kind: "knot", id: knot.id };
      return;
    }
    const line = cb.current.onLine ? hitLine(p.px) : null;
    if (line) {
      drag.current = { kind: "line", id: line.id };
      return;
    }
    const sp = spanRef.current;
    if (cb.current.onSpan && sp) {
      const edge = 8;
      if (Math.abs(p.px - X(sp[0])) < edge) {
        drag.current = { kind: "span-edge", edge: "l" };
        return;
      }
      if (Math.abs(p.px - X(sp[1])) < edge) {
        drag.current = { kind: "span-edge", edge: "r" };
        return;
      }
      const inside = p.x > Math.min(sp[0], sp[1]) && p.x < Math.max(sp[0], sp[1]);
      if (inside) {
        drag.current = { kind: "span-move", grab: p.x, a: sp[0], b: sp[1] };
        return;
      }
    }
    if (cb.current.onSpan) {
      drag.current = { kind: "span-new", x0: p.x, prev: sp };
      return;
    }
    if (clickMovesNearest && cb.current.onLine && linesRef.current.length) {
      let nearest = linesRef.current[0];
      let best = Math.abs(nearest.x - p.x);
      for (const item of linesRef.current) {
        const dist = Math.abs(item.x - p.x);
        if (dist < best) {
          nearest = item;
          best = dist;
        }
      }
      cb.current.onLine(nearest.id, p.x);
      drag.current = { kind: "line", id: nearest.id };
      return;
    }
    drag.current = { kind: "click", x: p.x, y: p.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = locate(e.clientX, e.clientY);
    setReadout(`${fmtTick(p.x)} , ${fmtTick(p.y)}`);
    if (!drag.current) {
      const nearLine = hitLine(p.px);
      const nearKnot = hitKnot(p.px, p.py);
      setCursor(nearLine || nearKnot ? "ew-resize" : e.shiftKey ? "grab" : "crosshair");
      return;
    }
    moved.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    const d = drag.current;
    if (d.kind === "pan") {
      const dx = ((p.px - d.px) / geom.current.plotW) * (d.x1 - d.x0);
      setView({ x0: d.x0 - dx, x1: d.x1 - dx });
      return;
    }
    if (d.kind === "click" || cb.current.locked) return;
    if (d.kind === "line") cb.current.onLine?.(d.id, p.x);
    else if (d.kind === "knot") cb.current.onKnot?.(d.id, p.x, p.y);
    else if (d.kind === "span-edge") {
      const sp = spanRef.current;
      if (!sp) return;
      if (d.edge === "l") cb.current.onSpan?.(p.x, sp[1]);
      else cb.current.onSpan?.(sp[0], p.x);
    } else if (d.kind === "span-move") {
      const dx = p.x - d.grab;
      cb.current.onSpan?.(d.a + dx, d.b + dx);
    } else if (d.kind === "span-new") {
      if (moved.current >= 4) cb.current.onSpan?.(d.x0, p.x);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const p = locate(e.clientX, e.clientY);
    const d = drag.current;
    drag.current = null;
    if (!d || cb.current.locked) return;
    if (d.kind === "span-new" && moved.current < 4 && d.prev) {
      cb.current.onSpan?.(d.prev[0], d.prev[1]);
      return;
    }
    if (d.kind === "click" && moved.current < 4) {
      if (cb.current.placeKnots && cb.current.onKnotAdd) cb.current.onKnotAdd(p.x, p.y);
      else cb.current.onClickX?.(p.x);
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (cb.current.locked || !cb.current.placeKnots || !cb.current.onKnotRemove) return;
    const p = locate(e.clientX, e.clientY);
    const knot = hitKnot(p.px, p.py);
    if (knot) cb.current.onKnotRemove(knot.id);
  }

  const xTicks = ticks(Math.min(x0, x1), Math.max(x0, x1), 5);
  const yTicks = ticks(yLo, yHi, 4);

  const seriesPath = pathOf(seriesX, seriesY, i0, i1, X, Y);
  const curvePath = curve ? pathOf(curve.map((c) => c.x), curve.map((c) => c.y), 0, curve.length, X, Y) : "";

  let shade = "";
  if (shadeCurve && curve && curve.length > 1) {
    const fwd: string[] = [];
    const back: string[] = [];
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    for (let i = i0; i < i1; i++) {
      if (seriesX[i] < a || seriesX[i] > b) continue;
      fwd.push(`${X(seriesX[i]).toFixed(1)} ${Y(seriesY[i]).toFixed(1)}`);
    }
    for (let i = curve.length - 1; i >= 0; i--) {
      if (curve[i].x < a || curve[i].x > b) continue;
      back.push(`${X(curve[i].x).toFixed(1)} ${Y(curve[i].y).toFixed(1)}`);
    }
    if (fwd.length && back.length) shade = `M${fwd.join(" L")} L${back.join(" L")} Z`;
  }

  const toneStroke = (tone: ChartLine["tone"]) =>
    tone === "correct" ? "var(--color-ink)" : "var(--color-primary)";

  return (
    <div ref={wrapRef} className="plot-wrap">
      <svg
        ref={svgRef}
        className="plot"
        width={size.w}
        height={size.h}
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        style={{ cursor }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.l} y={M.t} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={size.w} height={size.h} fill="var(--color-surface)" />
        <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="var(--color-bg)" />
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={M.l + plotW} y1={Y(t)} y2={Y(t)} stroke="var(--color-line)" />
            <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" className="tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line y1={M.t} y2={M.t + plotH} x1={X(t)} x2={X(t)} stroke="var(--color-line)" />
            <text x={X(t)} y={M.t + plotH + 16} textAnchor="middle" className="tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {yLo < 0 && yHi > 0 ? (
          <line
            x1={M.l}
            x2={M.l + plotW}
            y1={Y(0)}
            y2={Y(0)}
            stroke="var(--color-muted)"
            strokeDasharray="3 4"
          />
        ) : null}
        <g clipPath={`url(#${clipId})`}>
          {regions.map((r) => {
            const xa = X(Math.min(r.x1, r.x2));
            const xb = X(Math.max(r.x1, r.x2));
            return (
              <g key={r.label + r.x1}>
                <rect
                  x={xa}
                  y={M.t}
                  width={Math.max(1, xb - xa)}
                  height={plotH}
                  fill="var(--color-copper)"
                  opacity={0.13}
                />
                <text x={(xa + xb) / 2} y={M.t + 14} textAnchor="middle" className="region-label">
                  {r.label}
                </text>
              </g>
            );
          })}
          {span ? (
            <rect
              x={X(Math.min(span[0], span[1]))}
              y={M.t}
              width={Math.max(1, Math.abs(X(span[1]) - X(span[0])))}
              height={plotH}
              fill="var(--color-copper)"
              opacity={0.18}
            />
          ) : null}
          {shade ? <path d={shade} fill="var(--color-primary)" opacity={0.18} /> : null}
          {baseline ? (
            <line
              x1={X(baseline.x1)}
              y1={Y(baseline.y1)}
              x2={X(baseline.x2)}
              y2={Y(baseline.y2)}
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          ) : null}
          {curvePath ? (
            <path d={curvePath} fill="none" stroke="var(--color-copper)" strokeWidth={1.75} />
          ) : null}
          {seriesPath ? (
            <path d={seriesPath} fill="none" stroke="var(--color-ink)" strokeWidth={1.4} />
          ) : null}
          {ghostLines.map((line) => (
            <line
              key={line.id}
              x1={X(line.x)}
              x2={X(line.x)}
              y1={M.t}
              y2={M.t + plotH}
              stroke={toneStroke(line.tone)}
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.7}
            />
          ))}
          {lines.map((line) => (
            <g key={line.id}>
              <line
                x1={X(line.x)}
                x2={X(line.x)}
                y1={M.t}
                y2={M.t + plotH}
                stroke={toneStroke(line.tone)}
                strokeWidth={1.6}
                strokeDasharray={line.tone === "correct" ? "6 3" : undefined}
              />
              {line.label ? (
                <text x={X(line.x) + 4} y={M.t + 12} className="region-label">
                  {line.label}
                </text>
              ) : null}
            </g>
          ))}
          {guideX != null ? (
            <line
              x1={X(guideX)}
              x2={X(guideX)}
              y1={M.t}
              y2={M.t + plotH}
              stroke="var(--color-copper)"
              strokeDasharray="4 3"
            />
          ) : null}
          {knots.map((k) => (
            <g key={k.id}>
              <circle cx={X(k.x)} cy={Y(k.y)} r={5} fill="var(--color-surface)" stroke="var(--color-copper)" strokeWidth={2} />
              {k.label ? (
                <text x={X(k.x) + 7} y={Y(k.y) - 7} className="region-label">
                  {k.label}
                </text>
              ) : null}
            </g>
          ))}
        </g>
        <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="none" stroke="var(--color-line)" />
        <text x={M.l + plotW / 2} y={size.h - 6} textAnchor="middle" className="axis-label">
          {xLabel}
        </text>
        <text
          transform={`translate(14 ${M.t + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          className="axis-label"
        >
          {yLabel}
        </text>
      </svg>
      {readout ? <div className="plot-readout">{readout}</div> : null}
      <button
        type="button"
        className="plot-reset"
        onClick={() => setView(null)}
        title="Сбросить масштаб"
      >
        1:1
      </button>
    </div>
  );
}

function pathOf(
  x: number[],
  y: number[],
  i0: number,
  i1: number,
  X: (v: number) => number,
  Y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  const a = Math.max(0, i0);
  const b = Math.min(x.length, i1);
  for (let i = a; i < b; i++) {
    const px = X(x[i]);
    const py = Y(y[i]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
    pen = true;
  }
  return d;
}
