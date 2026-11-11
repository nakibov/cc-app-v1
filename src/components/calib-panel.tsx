import { useMemo, useState } from "react";
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
}: {
  molecule: string;
  units: string;
  points: CalibPoint[];
  fit: Fit | null;
  order: number;
  onOrder: (n: number) => void;
  band: number | null;
}) {
  const [currentText, setCurrentText] = useState("");
  const [rateText, setRateText] = useState("");
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

  return (
    <section className="card calib" id="calib">
      <header className="pair-head">
        <div>
          <p className="eyebrow">Калибровка</p>
          <h2>
            {molecule || "X"} cc
          </h2>
        </div>
        <p className="formula">
          v = A · ln(10) · k / (Δt · S)
          {band != null ? ` · S = ${fmtExp(band)}` : ""}
        </p>
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

      {points.length ? (
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
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.spectrum + i}>
                  <td>{i + 1}</td>
                  <td>{p.spectrum}</td>
                  <td>{fmtExp(p.meanI)}</td>
                  <td>{fmtExp(p.rate)}</td>
                  <td>{fmtExp(p.time, 3)}</td>
                  <td>{fmtExp(p.k, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
