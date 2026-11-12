import { useMemo } from "react";
import { Magnet } from "lucide-react";
import { SciChart, type ChartLine } from "@/components/sci-chart";
import { baselineLine, computePair, irBaseline } from "@/lib/compute";
import { decimate, fmtExp, fmtSig, fmtT, lowerBound, meanWindow, newId, parseSci } from "@/lib/signal";
import { splineSamples } from "@/lib/spline";
import type { Pair, Spectrum } from "@/lib/types";

function sliceDecimate(x: number[], y: number[], a: number, b: number, n: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const i0 = lowerBound(x, lo);
  const i1 = Math.min(x.length, lowerBound(x, hi) + 1);
  return decimate(x.slice(i0, i1), y.slice(i0, i1), n);
}

export function PairCard({
  index,
  pair,
  time,
  signal,
  units,
  mass,
  spectrum,
  wnMin,
  wnMax,
  band,
  onPatch,
}: {
  index: number;
  pair: Pair;
  time: number[];
  signal: number[];
  units: string;
  mass: number;
  spectrum: Spectrum | undefined;
  wnMin: number;
  wnMax: number;
  band: number | null;
  onPatch: (patch: Partial<Pair>, ir?: boolean) => void;
}) {
  const qmsSeries = useMemo(
    () => sliceDecimate(time, signal, pair.frame1, pair.frame2, 1600),
    [time, signal, pair.frame1, pair.frame2],
  );
  const irSeries = useMemo(() => {
    if (!spectrum) return { x: [] as number[], y: [] as number[] };
    return sliceDecimate(spectrum.wn, spectrum.abs, wnMin, wnMax, 1800);
  }, [spectrum, wnMin, wnMax]);

  const result = useMemo(
    () => computePair(time, signal, spectrum, pair, band),
    [time, signal, spectrum, pair, band],
  );
  const chord = useMemo(
    () => baselineLine(time, signal, pair.base1, pair.base2),
    [time, signal, pair.base1, pair.base2],
  );
  const spline = useMemo(() => {
    if (!spectrum || !pair.irCorrect) return null;
    return splineSamples(
      irBaseline(spectrum, pair).fn,
      Math.min(pair.ir1, pair.ir2),
      Math.max(pair.ir1, pair.ir2),
      100,
    );
  }, [spectrum, pair]);

  const qmsLines: ChartLine[] = [];
  const qmsGhost: ChartLine[] = [];
  const baseLines: ChartLine[] = [
    { id: "base1", x: pair.base1, tone: "baseline", label: "база" },
    { id: "base2", x: pair.base2, tone: "baseline" },
  ];
  const corrLines: ChartLine[] = [
    { id: "corr1", x: pair.corr1, tone: "correct", label: "корр." },
    { id: "corr2", x: pair.corr2, tone: "correct" },
  ];
  if (pair.tool === "baseline") qmsLines.push(...baseLines);
  else qmsGhost.push(...baseLines);
  if (pair.fullMode === "manual") qmsLines.push(...corrLines);

  const disabled = pair.locked;

  function setTool(tool: Pair["tool"]) {
    onPatch({ tool });
  }

  function magnet() {
    if (!spectrum) return;
    onPatch(
      {
        knots: pair.knots.map((k) => ({
          ...k,
          abs: meanWindow(spectrum.wn, spectrum.abs, k.wn, 2),
        })),
      },
      true,
    );
  }

  return (
    <section className={pair.locked ? "card pair locked" : "card pair"} aria-label={`Пара ${index + 1}`}>
      <header className="pair-head">
        <div>
          <p className="eyebrow">Пара {index + 1}</p>
          <h3>{pair.spectrum}</h3>
        </div>
        <div className="lock">
          <span>Зафиксировать</span>
          <button
            type="button"
            role="switch"
            aria-checked={pair.locked}
            className={pair.locked ? "switch on" : "switch"}
            onClick={() => onPatch({ locked: !pair.locked })}
          >
            <i />
          </button>
        </div>
      </header>

      <div className="pair-split">
        <div className="pair-col">
          <div className="toolbar">
            <Segment
              label="Режим QMS"
              value={pair.tool}
              disabled={disabled}
              options={[
                { id: "baseline", label: "Базовая линия" },
                { id: "area", label: "Площадь" },
              ]}
              onChange={setTool}
            />
            <Segment
              label="Отношение площадей (k)"
              value={pair.fullMode}
              disabled={disabled}
              options={[
                { id: "manual", label: "Коррекция" },
                { id: "auto", label: "Автокоррекция" },
              ]}
              onChange={(fullMode) => onPatch({ fullMode })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={pair.subtract}
                disabled={disabled}
                onChange={(e) => onPatch({ subtract: e.target.checked })}
              />
              Вычесть базовую линию
            </label>
          </div>

          <SciChart
            seriesX={qmsSeries.x}
            seriesY={qmsSeries.y}
            home={[pair.frame1, pair.frame2]}
            xLabel="t, с"
            yLabel={`I (m/z ${mass}), ${units}`}
            lines={qmsLines}
            ghostLines={qmsGhost}
            onLine={
              disabled
                ? undefined
                : (id, x) => {
                    if (id === "base1") onPatch({ base1: x });
                    else if (id === "base2") onPatch({ base2: x });
                    else if (id === "corr1") onPatch({ corr1: x });
                    else if (id === "corr2") onPatch({ corr2: x });
                  }
            }
            span={[pair.span1, pair.span2]}
            onSpan={disabled || pair.tool !== "area" ? undefined : (a, b) => onPatch({ span1: a, span2: b })}
            baseline={{ x1: chord.x1, y1: chord.y1, x2: chord.x2, y2: chord.y2 }}
            clickMovesNearest={!disabled && pair.tool === "baseline"}
            locked={disabled}
            resetToken={pair.id}
          />
          <div className="num-row">
            <Num
              label="База, с"
              a={pair.base1}
              b={pair.base2}
              disabled={disabled}
              onChange={(a, b) => onPatch({ base1: a, base2: b })}
            />
            <Num
              label="Площадь, с"
              a={pair.span1}
              b={pair.span2}
              disabled={disabled}
              onChange={(a, b) => onPatch({ span1: a, span2: b })}
            />
            {pair.fullMode === "manual" ? (
              <Num
                label="Коррекция, с"
                a={pair.corr1}
                b={pair.corr2}
                disabled={disabled}
                onChange={(a, b) => onPatch({ corr1: a, corr2: b })}
              />
            ) : (
              <p className="hint-inline">Автокоррекция: S_full между границами базы. Усреднение границ — 15 с.</p>
            )}
          </div>
        </div>

        <div className="pair-col">
          <div className="toolbar ir-tools">
            <label className="check">
              <input
                type="checkbox"
                checked={pair.irCorrect}
                disabled={disabled}
                onChange={(e) => onPatch({ irCorrect: e.target.checked })}
              />
              Коррекция базовой линии
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={pair.place}
                disabled={disabled || !pair.irCorrect}
                onChange={(e) => onPatch({ place: e.target.checked })}
              />
              Ставить / убирать точки
            </label>
            <button type="button" className="btn btn-quiet" disabled={disabled || !pair.irCorrect} onClick={magnet}>
              <Magnet aria-hidden="true" />
              Магнит
            </button>
          </div>
          <SciChart
            seriesX={irSeries.x}
            seriesY={irSeries.y}
            home={[Math.min(wnMin, wnMax), Math.max(wnMin, wnMax)]}
            xLabel="ν, см⁻¹"
            yLabel="Absorbance"
            lines={[
              { id: "ir1", x: pair.ir1, tone: "baseline", label: "ν₁" },
              { id: "ir2", x: pair.ir2, tone: "baseline", label: "ν₂" },
            ]}
            onLine={
              disabled
                ? undefined
                : (id, x) => {
                    const clamped = Math.min(Math.max(wnMin, wnMax), Math.max(Math.min(wnMin, wnMax), x));
                    onPatch(id === "ir1" ? { ir1: clamped } : { ir2: clamped }, true);
                  }
            }
            curve={spline}
            shadeCurve={pair.irCorrect}
            knots={pair.irCorrect ? pair.knots.map((k) => ({ id: k.id, x: k.wn, y: k.abs })) : []}
            onKnot={
              disabled || !pair.irCorrect
                ? undefined
                : (id, x, y) => {
                    const lo = Math.min(pair.ir1, pair.ir2);
                    const hi = Math.max(pair.ir1, pair.ir2);
                    const wn = Math.min(hi - 0.05, Math.max(lo + 0.05, x));
                    onPatch({ knots: pair.knots.map((k) => (k.id === id ? { ...k, wn, abs: y } : k)) }, true);
                  }
            }
            placeKnots={!disabled && pair.irCorrect && pair.place}
            onKnotAdd={
              disabled
                ? undefined
                : (x, y) => {
                    const lo = Math.min(pair.ir1, pair.ir2);
                    const hi = Math.max(pair.ir1, pair.ir2);
                    if (x <= lo || x >= hi) return;
                    onPatch({ knots: [...pair.knots, { id: newId(), wn: x, abs: y }] }, true);
                  }
            }
            onKnotRemove={
              disabled ? undefined : (id) => onPatch({ knots: pair.knots.filter((k) => k.id !== id) }, true)
            }
            locked={disabled}
            resetToken={pair.id + "-ir"}
          />
          <p className="hint-inline">
            Вертикальные границы ν — края окна интегрирования. Левый щелчок ставит точку, правый снимает ближайшую.
            Магнит усредняет ординату в ±2 см⁻¹.
          </p>
        </div>
      </div>

      <dl className="stats">
        <Stat label="Δt, с" value={fmtT(result.time)} />
        <Stat label={`⟨I⟩, ${units}`} value={fmtExp(result.meanI)} />
        <Stat label="S_good" value={fmtExp(result.sGood)} />
        <Stat label="S_full" value={fmtExp(result.sFull)} />
        <Stat label="k = S_good/S_full" value={fmtSig(result.k)} />
        <Stat label="S_IR" value={fmtSig(result.irArea)} />
        <Stat label="S_IR·ln(10)" value={fmtExp(result.optical)} />
        <Stat label="скорость" value={result.rate == null ? "—" : fmtExp(result.rate)} />
      </dl>
      {result.warnings.length ? <p className="warn">{result.warnings.join(" · ")}</p> : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg-wrap">
      <span>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={value === o.id ? "seg-btn on" : "seg-btn"}
            aria-pressed={value === o.id}
            disabled={disabled}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Num({
  label,
  a,
  b,
  disabled,
  onChange,
}: {
  label: string;
  a: number;
  b: number;
  disabled?: boolean;
  onChange: (a: number, b: number) => void;
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <span className="num-fields">
        <input
          disabled={disabled}
          defaultValue={a.toFixed(1)}
          key={`${label}-a-${a.toFixed(2)}`}
          onBlur={(e) => {
            const v = parseSci(e.target.value);
            if (v != null) onChange(v, b);
          }}
        />
        <input
          disabled={disabled}
          defaultValue={b.toFixed(1)}
          key={`${label}-b-${b.toFixed(2)}`}
          onBlur={(e) => {
            const v = parseSci(e.target.value);
            if (v != null) onChange(a, v);
          }}
        />
      </span>
    </label>
  );
}
