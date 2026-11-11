import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, RotateCcw, Save, Undo2 } from "lucide-react";
import { CalibPanel } from "@/components/calib-panel";
import { PairCard } from "@/components/pair-card";
import { SciChart, type ChartLine } from "@/components/sci-chart";
import { computePair } from "@/lib/compute";
import { fitOrigin } from "@/lib/fit";
import { decimate, newId, parseSci } from "@/lib/signal";
import { guessMolecule, parseQms, parseSpectrum, spectrumOrder, suggestWindow } from "@/lib/parse";
import {
  calibrationHtml,
  downloadBlob,
  pointsCsv,
  PROJECT_VERSION,
  renderCalibrationPng,
  unzipStore,
  zipStore,
  type ProjectFile,
} from "@/lib/project";
import type { CalibPoint, Fit, Pair, QmsData, Spectrum } from "@/lib/types";

type Bundle = { qms: QmsData; spectra: Spectrum[] };

const SAMPLES = [
  "CO2 cc.txt",
  "spectrum1.CSV",
  "spectrum2.CSV",
  "spectrum3.CSV",
  "spectrum4.CSV",
  "spectrum5.CSV",
  "spectrum6.CSV",
];

function withFrame(p: Pair): Pair {
  const xs = [p.base1, p.base2, p.span1, p.span2];
  if (p.fullMode === "manual") xs.push(p.corr1, p.corr2);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  let frame1 = p.frame1;
  let frame2 = p.frame2;
  const span = Math.max(40, frame2 - frame1);
  if (lo < frame1 + span * 0.05) frame1 = lo - span * 0.18;
  if (hi > frame2 - span * 0.05) frame2 = hi + span * 0.18;
  if (frame1 === p.frame1 && frame2 === p.frame2) return p;
  return { ...p, frame1, frame2 };
}

function makePair(specName: string, a: number, b: number, wnMin: number, wnMax: number, shared?: Pair): Pair {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const width = Math.max(hi - lo, 1);
  const inset = width * 0.15;
  const pad = Math.max(45, width * 0.4);
  const irLo = Math.min(wnMin, wnMax);
  const irHi = Math.max(wnMin, wnMax);
  const margin = (irHi - irLo) * 0.12;
  return {
    id: newId(),
    spectrum: specName,
    base1: lo,
    base2: hi,
    span1: lo + inset,
    span2: hi - inset,
    corr1: lo,
    corr2: hi,
    frame1: lo - pad,
    frame2: hi + pad,
    subtract: true,
    fullMode: "auto",
    tool: "baseline",
    ir1: shared ? shared.ir1 : irLo + margin,
    ir2: shared ? shared.ir2 : irHi - margin,
    irCorrect: false,
    place: false,
    knots: shared ? shared.knots.map((k) => ({ ...k, id: newId() })) : [],
    locked: false,
  };
}

export function CcApp() {
  const dataRef = useRef<HTMLInputElement>(null);
  const curveRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pending, setPending] = useState<number | null>(null);
  const [molecule, setMolecule] = useState("CO2");
  const [channel, setChannel] = useState(0);
  const [wnMin, setWnMin] = useState(2160);
  const [wnMax, setWnMax] = useState(2500);
  const [wnMinText, setWnMinText] = useState("2160");
  const [wnMaxText, setWnMaxText] = useState("2500");
  const [band, setBand] = useState<number | null>(null);
  const [bandText, setBandText] = useState("");
  const [share, setShare] = useState(false);
  const [order, setOrder] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [curveOnly, setCurveOnly] = useState<{
    points: CalibPoint[];
    fit: Fit | null;
    units: string;
    band: number | null;
  } | null>(null);

  const signal = bundle?.qms.signals[channel] ?? [];
  const time = bundle?.qms.time ?? [];
  const units = bundle?.qms.units ?? curveOnly?.units ?? "Торр";

  const overview = useMemo(() => {
    if (!bundle) return { x: [] as number[], y: [] as number[] };
    return decimate(time, signal, 2000);
  }, [bundle, time, signal]);

  useEffect(() => {
    const lo = Math.min(wnMin, wnMax);
    const hi = Math.max(wnMin, wnMax);
    setPairs((ps) =>
      ps.map((p) => {
        if (p.locked) return p;
        const ir1 = Math.min(hi, Math.max(lo, p.ir1));
        const ir2 = Math.min(hi, Math.max(lo, p.ir2));
        if (ir1 === p.ir1 && ir2 === p.ir2) return p;
        return { ...p, ir1, ir2 };
      }),
    );
  }, [wnMin, wnMax]);

  const undo = useCallback(() => {
    if (pending != null) {
      setPending(null);
      return;
    }
    setPairs((ps) => ps.slice(0, -1));
  }, [pending]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Backspace" || (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  function adoptBundle(next: Bundle, moleculeName?: string) {
    const win = suggestWindow(next.spectra);
    let best = 0;
    let bestSpan = -1;
    next.qms.signals.forEach((column, i) => {
      let mn = Infinity;
      let mx = -Infinity;
      for (const v of column) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx - mn > bestSpan) {
        bestSpan = mx - mn;
        best = i;
      }
    });
    setBundle(next);
    setChannel(best);
    setWnMin(win.min);
    setWnMax(win.max);
    setWnMinText(String(win.min));
    setWnMaxText(String(win.max));
    setMolecule(moleculeName || guessMolecule(next.qms.filename));
    setPairs([]);
    setPending(null);
    setCurveOnly(null);
  }

  function restore(project: ProjectFile) {
    if (project.molecule) setMolecule(project.molecule);
    setOrder(project.polyOrder || 1);
    setShare(Boolean(project.shareBaseline));
    if (project.bandStrength != null) {
      setBand(project.bandStrength);
      setBandText(project.bandStrength.toExponential(4));
    }
    if (project.qms && project.spectra?.length) {
      const spectra = [...project.spectra].sort(spectrumOrder);
      setBundle({ qms: project.qms, spectra });
      const idx = project.qms.channels.findIndex((c) => c.mass === project.channelMass);
      setChannel(idx >= 0 ? idx : 0);
      setWnMin(project.wnMin);
      setWnMax(project.wnMax);
      setWnMinText(String(project.wnMin));
      setWnMaxText(String(project.wnMax));
      setPairs(project.pairs ?? []);
      setPending(null);
      setCurveOnly(null);
      return;
    }
    setBundle(null);
    setPairs([]);
    setPending(null);
    setCurveOnly({
      points: project.points ?? [],
      fit: project.polynomial,
      units: project.units || "Торр",
      band: project.bandStrength,
    });
  }

  async function ingest(files: { name: string; text: string }[]) {
    let project: ProjectFile | null = null;
    let qms: QmsData | null = null;
    const spectra: Spectrum[] = [];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".json")) {
        const parsed = JSON.parse(file.text) as ProjectFile;
        if (parsed?.type === "cc-calibration") project = parsed;
      } else if (lower.endsWith(".txt")) {
        qms = parseQms(file.name, file.text);
      } else if (lower.endsWith(".csv")) {
        spectra.push(parseSpectrum(file.name, file.text));
      }
    }
    spectra.sort(spectrumOrder);
    if (project?.qms && project.spectra?.length) {
      restore(project);
      return;
    }
    if (!qms || !spectra.length) {
      if (project) {
        restore(project);
        return;
      }
      throw new Error("Нужен файл QMS (.txt) и хотя бы один ИК-спектр (.csv).");
    }
    adoptBundle({ qms, spectra });
    if (project?.pairs?.length) {
      setPairs(project.pairs);
      if (project.molecule) setMolecule(project.molecule);
      if (project.wnMin != null) {
        setWnMin(project.wnMin);
        setWnMax(project.wnMax);
        setWnMinText(String(project.wnMin));
        setWnMaxText(String(project.wnMax));
      }
      setShare(Boolean(project.shareBaseline));
      setOrder(project.polyOrder || 1);
      if (project.bandStrength != null) {
        setBand(project.bandStrength);
        setBandText(project.bandStrength.toExponential(4));
      }
      const idx = qms.channels.findIndex((c) => c.mass === project.channelMass);
      if (idx >= 0) setChannel(idx);
    }
  }

  async function onDataFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy("Читаю файлы…");
    setError(null);
    try {
      const files = await Promise.all(
        [...list].map(async (file) => ({ name: file.name, text: await file.text() })),
      );
      await ingest(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файлы");
    } finally {
      setBusy(null);
      if (dataRef.current) dataRef.current.value = "";
    }
  }

  async function loadExample() {
    setBusy("Открываю пример CO₂…");
    setError(null);
    try {
      const files = await Promise.all(
        SAMPLES.map(async (name) => {
          const res = await fetch(`/samples/${encodeURIComponent(name)}`);
          if (!res.ok) throw new Error(`Нет файла ${name}`);
          return { name, text: await res.text() };
        }),
      );
      await ingest(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Пример не открылся");
    } finally {
      setBusy(null);
    }
  }

  async function onCurveFile(file: File | undefined) {
    if (!file) return;
    setBusy("Открываю кривую…");
    setError(null);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".zip")) {
        const packed = await unzipStore(await file.arrayBuffer());
        const json = packed.find((item) => item.name.toLowerCase().endsWith(".json"));
        if (!json) throw new Error("В архиве нет calibration.json");
        restore(JSON.parse(new TextDecoder().decode(json.data)) as ProjectFile);
      } else if (lower.endsWith(".htm") || lower.endsWith(".html")) {
        const text = await file.text();
        const match = text.match(/<script id="cc-data"[^>]*>([\s\S]*?)<\/script>/);
        if (!match) throw new Error("В HTML нет данных кривой");
        const data = JSON.parse(match[1]) as {
          molecule?: string;
          units?: string;
          points?: { spectrum: string; meanI: number; rate: number }[];
          coeffs?: number[];
          bandStrength?: number | null;
        };
        if (data.molecule) setMolecule(data.molecule);
        const pts: CalibPoint[] = (data.points ?? []).map((p) => ({
          spectrum: p.spectrum,
          meanI: p.meanI,
          rate: p.rate,
          time: 0,
          sGood: 0,
          sFull: 0,
          k: 1,
          irArea: 0,
        }));
        const fit = data.coeffs?.length
          ? { order: data.coeffs.length, coeffs: data.coeffs, scale: 1, r2: 1 }
          : fitOrigin(
              pts.map((p) => p.meanI),
              pts.map((p) => p.rate),
              order,
            );
        setBundle(null);
        setPairs([]);
        setCurveOnly({ points: pts, fit, units: data.units || "Торр", band: data.bandStrength ?? null });
      } else {
        restore(JSON.parse(await file.text()) as ProjectFile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть кривую");
    } finally {
      setBusy(null);
      if (curveRef.current) curveRef.current.value = "";
    }
  }

  function toggleShare(on: boolean) {
    setShare(on);
    if (!on) return;
    setPairs((ps) => {
      const src = ps.find((p) => !p.locked) ?? ps[0];
      if (!src) return ps;
      return ps.map((p) =>
        p.locked ? p : { ...p, ir1: src.ir1, ir2: src.ir2, knots: src.knots.map((k) => ({ ...k })) },
      );
    });
  }

  const patch = useCallback(
    (id: string, partial: Partial<Pair>, ir = false) => {
      setPairs((ps) => {
        const next = ps.map((p) => {
          if (p.id !== id) return p;
          if (p.locked && !("locked" in partial)) return p;
          let merged: Pair = { ...p, ...partial };
          const lockOnly = "locked" in partial && Object.keys(partial).length === 1;
          if (!ir && !lockOnly) merged = withFrame(merged);
          return merged;
        });
        if (!ir || !share) return next;
        const src = next.find((p) => p.id === id);
        if (!src || src.locked) return next;
        return next.map((p) => {
          if (p.locked || p.id === src.id) return p;
          return { ...p, ir1: src.ir1, ir2: src.ir2, knots: src.knots.map((k) => ({ ...k })) };
        });
      });
    },
    [share],
  );

  function onOverviewClick(t: number) {
    if (!bundle) return;
    if (pairs.length >= bundle.spectra.length && pending == null) return;
    if (pending == null) {
      setPending(t);
      return;
    }
    const spec = bundle.spectra[pairs.length];
    if (!spec) return;
    const shared = share ? (pairs.find((p) => !p.locked) ?? pairs[0]) : undefined;
    setPairs((ps) => [...ps, makePair(spec.filename, pending, t, wnMin, wnMax, shared)]);
    setPending(null);
  }

  function onOverviewLine(id: string, x: number) {
    const [pid, which] = id.split(":");
    setPairs((ps) =>
      ps.map((p) => {
        if (p.id !== pid || p.locked) return p;
        const next = which === "b1" ? { ...p, base1: x } : { ...p, base2: x };
        return withFrame(next);
      }),
    );
  }

  const livePoints: CalibPoint[] = [];
  if (bundle) {
    pairs.forEach((pair, i) => {
      const result = computePair(time, signal, bundle.spectra[i], pair, band);
      if (result.rate == null || !Number.isFinite(result.rate)) return;
      livePoints.push({
        spectrum: pair.spectrum,
        meanI: result.meanI,
        rate: result.rate,
        time: result.time,
        sGood: result.sGood,
        sFull: result.sFull,
        k: result.k,
        irArea: result.irArea,
      });
    });
  }
  const liveFit = fitOrigin(
    livePoints.map((p) => p.meanI),
    livePoints.map((p) => p.rate),
    order,
  );
  const shownPoints = bundle ? livePoints : (curveOnly?.points ?? []);
  const shownFit = bundle ? liveFit : (curveOnly?.fit ?? null);
  const shownBand = bundle ? band : (curveOnly?.band ?? band);

  async function save() {
    setBusy("Сохраняю архив…");
    setError(null);
    try {
      const mass = bundle?.qms.channels[channel]?.mass ?? 0;
      const project: ProjectFile = {
        type: "cc-calibration",
        version: PROJECT_VERSION,
        molecule: molecule || "X",
        bandStrength: shownBand,
        units,
        channelMass: mass,
        wnMin,
        wnMax,
        shareBaseline: share,
        polyOrder: order,
        polynomial: shownFit,
        points: shownPoints,
        pairs,
        qms: bundle?.qms,
        spectra: bundle?.spectra,
      };
      const enc = new TextEncoder();
      const png = renderCalibrationPng({
        molecule: project.molecule,
        units,
        points: shownPoints,
        fit: shownFit,
        bandStrength: shownBand,
      });
      const html = calibrationHtml({
        molecule: project.molecule,
        units,
        points: shownPoints,
        fit: shownFit,
        bandStrength: shownBand,
      });
      const zip = zipStore([
        { name: "calibration.json", data: enc.encode(JSON.stringify(project)) },
        { name: "points.csv", data: enc.encode(pointsCsv(shownPoints, units)) },
        { name: "calibration.html", data: enc.encode(html) },
        { name: "calibration.png", data: new Uint8Array(await png.arrayBuffer()) },
      ]);
      downloadBlob(zip, `${(molecule || "x").replace(/\s+/g, "_")}-cc.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  }

  const overviewLines: ChartLine[] = pairs.flatMap((p, i) => [
    { id: `${p.id}:b1`, x: p.base1, tone: "baseline", label: String(i + 1) },
    { id: `${p.id}:b2`, x: p.base2, tone: "baseline" },
  ]);
  const t0 = time[0] ?? 0;
  const t1 = time[time.length - 1] ?? 1;
  const need = bundle?.spectra.length ?? 0;

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">ИК · масс-спектрометрия</p>
          <h1>{molecule || "X"} cc</h1>
          <p className="lede">
            Скорость роста лучевой концентрации от среднего ионного тока. Прямоугольники QMS слева, спектры справа, кривая внизу.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={save} disabled={Boolean(busy)}>
          <Save aria-hidden="true" />
          Сохранить
        </button>
      </header>

      <section className="card setup">
        <div className="setup-actions">
          <button type="button" className="btn btn-primary" onClick={() => dataRef.current?.click()}>
            <FolderOpen aria-hidden="true" />
            Загрузить данные для калибровочной кривой
          </button>
          <button type="button" className="btn" onClick={() => curveRef.current?.click()}>
            Загрузить калибровочную кривую
          </button>
          <button type="button" className="btn btn-quiet" onClick={loadExample}>
            Пример CO₂
          </button>
          <input
            ref={dataRef}
            type="file"
            multiple
            accept=".txt,.csv,.json,text/plain,application/json"
            hidden
            onChange={(e) => onDataFiles(e.target.files)}
          />
          <input
            ref={curveRef}
            type="file"
            accept=".json,.zip,.html,.htm,application/json"
            hidden
            onChange={(e) => onCurveFile(e.target.files?.[0])}
          />
        </div>
        <div className="setup-grid">
          <label>
            Молекула
            <input value={molecule} onChange={(e) => setMolecule(e.target.value)} />
          </label>
          <label>
            Сила полосы S
            <input
              value={bandText}
              placeholder="1.6e-17"
              inputMode="decimal"
              onChange={(e) => setBandText(e.target.value)}
              onBlur={() => setBand(parseSci(bandText))}
              onKeyDown={(e) => {
                if (e.key === "Enter") setBand(parseSci(bandText));
              }}
            />
          </label>
          <label>
            Ионный ток
            <select
              value={channel}
              disabled={!bundle}
              onChange={(e) => setChannel(Number(e.target.value))}
            >
              {(bundle?.qms.channels ?? []).map((ch, i) => (
                <option key={ch.id} value={i}>
                  m/z {ch.mass} · {ch.name}
                </option>
              ))}
              {!bundle ? <option value={0}>сначала загрузите QMS</option> : null}
            </select>
          </label>
          <label>
            ν min, см⁻¹
            <input
              value={wnMinText}
              inputMode="decimal"
              onChange={(e) => setWnMinText(e.target.value)}
              onBlur={() => {
                const v = parseSci(wnMinText);
                if (v == null) setWnMinText(String(wnMin));
                else setWnMin(v);
              }}
            />
          </label>
          <label>
            ν max, см⁻¹
            <input
              value={wnMaxText}
              inputMode="decimal"
              onChange={(e) => setWnMaxText(e.target.value)}
              onBlur={() => {
                const v = parseSci(wnMaxText);
                if (v == null) setWnMaxText(String(wnMax));
                else setWnMax(v);
              }}
            />
          </label>
          <label className="check share">
            <input type="checkbox" checked={share} onChange={(e) => toggleShare(e.target.checked)} />
            Расшарить базовую линию
          </label>
        </div>
        <p className="hint-inline">
          К двум кликам на каждый спектр — левая и правая граница прямоугольника, по порядку файлов. Колёсико масштабирует ось, Shift+перетаскивание сдвигает её, «1:1» сбрасывает масштаб.
        </p>
        {busy ? <p className="busy">{busy}</p> : null}
        {error ? <p className="warn">{error}</p> : null}
      </section>

      {bundle ? (
        <section className="card">
          <header className="pair-head">
            <div>
              <p className="eyebrow">Обзор QMS</p>
              <h2>
                m/z {bundle.qms.channels[channel]?.mass} · {bundle.qms.filename}
              </h2>
            </div>
            <div className="overview-actions">
              <p className="status">
                {pending != null
                  ? `Вторая граница прямоугольника ${pairs.length + 1} из ${need}`
                  : pairs.length < need
                    ? `Прямоугольник ${pairs.length + 1} из ${need}: два клика`
                    : "Все спектры размечены"}
              </p>
              <button type="button" className="btn btn-quiet" onClick={undo}>
                <Undo2 aria-hidden="true" />
                Шаг назад
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setPairs([]);
                  setPending(null);
                }}
              >
                <RotateCcw aria-hidden="true" />
                Сбросить
              </button>
            </div>
          </header>
          <SciChart
            seriesX={overview.x}
            seriesY={overview.y}
            home={[t0, t1]}
            xLabel="t, с"
            yLabel={`I, ${units}`}
            lines={overviewLines}
            onLine={onOverviewLine}
            onClickX={onOverviewClick}
            guideX={pending}
            regions={pairs.map((p, i) => ({
              x1: Math.min(p.base1, p.base2),
              x2: Math.max(p.base1, p.base2),
              label: String(i + 1),
            }))}
          />
        </section>
      ) : null}

      {bundle
        ? pairs.map((pair, i) => (
            <PairCard
              key={pair.id}
              index={i}
              pair={pair}
              time={time}
              signal={signal}
              units={units}
              mass={bundle.qms.channels[channel]?.mass ?? 0}
              spectrum={bundle.spectra[i]}
              wnMin={wnMin}
              wnMax={wnMax}
              band={band}
              onPatch={(partial, ir) => patch(pair.id, partial, ir)}
            />
          ))
        : null}

      <CalibPanel
        molecule={molecule}
        units={units}
        points={shownPoints}
        fit={shownFit}
        order={order}
        onOrder={setOrder}
        band={shownBand}
      />
    </main>
  );
}
