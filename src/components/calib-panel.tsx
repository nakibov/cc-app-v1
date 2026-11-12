import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { SciChart } from "@/components/sci-chart";
import { evalPoly, invertPoly, polyLabel } from "@/lib/fit";
import { fmtExp, parseSci } from "@/lib/signal";
import type { CalibPoint, Fit } from "@/lib/types";

export function CalibPanel({
  molecule,
  units,
  points,
  fit,
  order,
  onOrder,
  band,
  bandNote,
  onSave,
  busy,
  onAdd,
  onRemove,
}: {
  molecule: string;
  units: string;
  points: CalibPoint[];
  fit: Fit | null;
  order: number;
  onOrder: (n: number) => void;
  band: number | null;
  bandNote: string;
  onSave: () => void;
  busy: boolean;
  onAdd: (meanI: number, rate: number) => void;
  onRemove: (id: string) => void;
}) {
  const [currentText, setCurrentText] = useState("");
  const [rateText, setRateText] = useState("");
  const [addI, setAddI] = useState("");
  const [addV, setAddV] = useState("");
  const [hint, setHint] = useState("");

  const curve = useMemo(() => {
    if (!fit) return [] as { x: number; y: number }[];
    const maxI = Math.max(0, ...points.map((p) => p.meanI));
    const minI = Math.min(0, ...points.map((p) => p.meanI));
    const x0 = minI;
    const x1 = maxI === 0 ? 1 : maxI * 1.15;
    return Array.from({ length: 120 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / 119;
      return { x, y: evalPoly(fit.coeffs, x) };
    });
  }, [fit, points]);

  const knots = useMemo(
    () => [
      { id: "origin", x: 0, y: 0, label: "0" },
      ...points.map((p, i) => ({ id: `p${i}`, x: p.meanI, y: p.rate, label: String(i + 1) })),
    ],
    [points],
  );

  const home = useMemo<[number, number]>(() => {
    const xs = [0, ...points.map((p) => p.meanI)];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const span = hi - lo || Math.max(Math.abs(hi), 1e-12);
    return [lo - span * 0.06, hi + span * 0.12];
  }, [points]);

  function commitCurrent() {
    const x = parseSci(currentText);
    if (x == null) {
      setHint("Введите число, например 6e-7");
      return;
    }
    if (!fit) {
      setHint("Недостаточно точек для аппроксимации");
      return;
    }
    const y = evalPoly(fit.coeffs, x);
    setRateText(y.toExponential(4));
    setHint("");
  }

  function commitRate() {
    const y = parseSci(rateText);
    if (y == null) {
      setHint("Введите число");
      return;
    }
    if (!fit) {
      setHint("Недостаточно точек для аппроксимации");
      return;
    }
    const x = invertPoly(fit, y);
    if (x == null) {
      setHint("Кривая не принимает такое значение при I ≥ 0");
      return;
    }
    setCurrentText(x.toExponential(4));
    setHint("");
  }

  function addPoint() {
    const x = parseSci(addI);
    const y = parseSci(addV);
    if (x == null || y == null) {
      setHint("Для новой точки нужны ток и скорость");
      return;
    }
    onAdd(x, y);
    setAddI("");
    setAddV("");
    setHint("");
  }

  const bandValue = band != null && Number.isFinite(band) ? fmtExp(band) : "—";
  const bandLine = bandNote.trim() ? `сила полосы: ${bandValue}, ${bandNote.trim()}` : `сила полосы: ${bandValue}`;

  return (
    <section className="card calib" id="calib">
      <header className="pair-head">
        <div>
          <p className="eyebrow">Калибровка</p>
          <h2>{molecule || "X"} cc</h2>
          <p className="formula">
            v = A · ln(10) · k / (Δt · S)
            {band != null ? ` · S = ${fmtExp(band)}` : ""}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>
          <Save aria-hidden="true" />
          Сохранить кк
        </button>
      </header>

      {points.length === 0 ? (
        <p className="empty-note">
          Точки появятся, когда для каждой пары заданы окно площади и сила полосы. На график добавляется (0, 0), свободный член полинома равен нулю.
        </p>
      ) : (
        <SciChart
          seriesX={curve.map((c) => c.x)}
          seriesY={curve.map((c) => c.y)}
          home={home}
          xLabel={`средний ионный ток, ${units}`}
          yLabel="скорость осаждения"
          knots={knots}
          resetToken={points.length}
        />
      )}

      <p className="band-line">{bandLine}</p>

      <fieldset className="orders">
        <legend>Порядок полинома</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input type="radio" name="order" checked={order === n} onChange={() => onOrder(n)} />
            {n}
          </label>
        ))}
      </fieldset>
      {fit ? (
        <p className="eq">
          {polyLabel(fit)}
          <span> R² = {fit.r2.toFixed(4)}{fit.order !== order ? ` · порядок снижен до ${fit.order}` : ""}</span>
        </p>
      ) : (
        <p className="hint-inline">Полином строится по точкам с ненулевым током. (0, 0) удерживается свободным членом.</p>
      )}

      <div className="predict">
        <label>
          Ток, {units}
          <input
            value={currentText}
            placeholder="6e-7"
            inputMode="decimal"
            onChange={(e) => setCurrentText(e.target.value)}
            onBlur={commitCurrent}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCurrent();
            }}
          />
        </label>
        <label>
          Скорость
          <input
            value={rateText}
            placeholder="значение с кривой"
            inputMode="decimal"
            onChange={(e) => setRateText(e.target.value)}
            onBlur={commitRate}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRate();
            }}
          />
        </label>
      </div>
      {hint ? <p className="warn">{hint}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>спектр</th>
              <th>⟨I⟩</th>
              <th>скорость</th>
              <th>Δt, с</th>
              <th>k</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={p.id || p.spectrum + i}>
                <td>{i + 1}</td>
                <td>{p.spectrum}</td>
                <td>{fmtExp(p.meanI)}</td>
                <td>{fmtExp(p.rate)}</td>
                <td>{p.manual || !p.time ? "—" : fmtExp(p.time, 3)}</td>
                <td>{p.manual ? "—" : fmtExp(p.k, 3)}</td>
                <td>
                  <button type="button" className="btn btn-quiet btn-tiny" onClick={() => onRemove(p.id || String(i))}>
                    Убрать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="predict">
        <label>
          Новая точка, ток
          <input
            value={addI}
            placeholder="6e-7"
            inputMode="decimal"
            onChange={(e) => setAddI(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPoint();
            }}
          />
        </label>
        <label>
          Новая точка, скорость
          <input
            value={addV}
            placeholder="скорость"
            inputMode="decimal"
            onChange={(e) => setAddV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPoint();
            }}
          />
        </label>
        <button type="button" className="btn" onClick={addPoint}>
          Добавить
        </button>
      </div>
    </section>
  );
}
