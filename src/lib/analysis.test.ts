import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { computePair, stableAreaWindow } from "./compute.ts";
import { evalPoly, fitOrigin, invertPoly } from "./fit.ts";
import { guessMolecule, parseQms, parseSpectrum, suggestWindow } from "./parse.ts";
import { integrate, meanWindow, parseSci } from "./signal.ts";
import { createSpline } from "./spline.ts";
import type { Pair } from "./types.ts";

test("parseSci accepts cyrillic ye in the exponent", () => {
  assert.equal(parseSci("1.6e-17"), 1.6e-17);
  assert.equal(parseSci("1,6е-17"), 1.6e-17);
  assert.equal(parseSci("6Е-7"), 6e-7);
  assert.equal(parseSci("2.5е−3"), 2.5e-3);
});

test("stable area keeps 10 s of plateau outside the window", () => {
  const text = fs.readFileSync("/workspace/public/samples/CO2 cc.txt", "utf8");
  const qms = parseQms("CO2 cc.txt", text);
  const idx = qms.channels.findIndex((c) => c.mass === 44);
  const wide = stableAreaWindow(qms.time, qms.signals[idx], 3900, 5600, 10);
  assert.ok(wide);
  assert.ok(wide.span1 > 4265 && wide.span1 < 4325, `span1 ${wide.span1}`);
  assert.ok(wide.span2 > 5425 && wide.span2 < 5465, `span2 ${wide.span2}`);
  const tight = stableAreaWindow(qms.time, qms.signals[idx], 4400, 5300, 10);
  assert.ok(tight);
  assert.ok(Math.abs(tight.span1 - 4410) < 3, `tight1 ${tight.span1}`);
  assert.ok(Math.abs(tight.span2 - 5290) < 3, `tight2 ${tight.span2}`);
  assert.equal(stableAreaWindow(qms.time, qms.signals[idx], 100, 118, 10), null);
});

test("trapezoid of a unit rectangle is the width", () => {
  const x = [0, 1, 2, 3, 4];
  const y = [1, 1, 1, 1, 1];
  assert.equal(integrate(x, y, 0, 4, null), 4);
  assert.equal(integrate(x, y, 0.5, 2.5, null), 2);
});

test("baseline subtraction removes a constant", () => {
  const x = [0, 1, 2, 3];
  const y = [2, 2, 2, 2];
  const area = integrate(x, y, 0, 3, () => 2);
  assert.ok(Math.abs(area) < 1e-12);
});

test("mean window", () => {
  const x = [0, 1, 2, 3, 4];
  const y = [0, 10, 10, 0, 0];
  const m = meanWindow(x, y, 1.5, 0.6);
  assert.ok(Math.abs(m - 10) < 1e-9);
});

test("spline is exact on a line", () => {
  const fn = createSpline([0, 1, 2, 3], [1, 3, 5, 7]);
  assert.ok(Math.abs(fn(1.5) - 4) < 1e-9);
  assert.ok(Math.abs(fn(2.5) - 6) < 1e-6);
});

test("zero-intercept fit recovers a line", () => {
  const fit = fitOrigin([1e-8, 2e-8, 3e-8], [2, 4, 6], 1);
  assert.ok(fit);
  assert.ok(Math.abs(evalPoly(fit.coeffs, 1.5e-8) - 3) < 1e-6);
  const back = invertPoly(fit, 4);
  assert.ok(back != null && Math.abs(back - 2e-8) / 2e-8 < 1e-3);
});

test("parses the CO2 bundle", () => {
  const qms = parseQms(
    "CO2 cc.txt",
    fs.readFileSync("/workspace/attachments/CO2 cc.txt", "utf8"),
  );
  assert.equal(qms.channels.length, 10);
  assert.equal(qms.channels[7].mass, 44);
  assert.equal(qms.units, "Torr");
  assert.ok(qms.time.length > 10000);
  assert.equal(guessMolecule(qms.filename), "CO2");
  const spec = parseSpectrum(
    "spectrum1.CSV",
    fs.readFileSync("/workspace/attachments/spectrum1.CSV", "utf8"),
  );
  assert.ok(spec.wn[0] < 500);
  assert.ok(spec.wn.at(-1)! > 3900);
  const win = suggestWindow([spec]);
  assert.ok(win.min < 2350 && win.max > 2300);
  const pair: Pair = {
    id: "p",
    spectrum: spec.filename,
    base1: 5000,
    base2: 5300,
    span1: 5050,
    span2: 5250,
    corr1: 5000,
    corr2: 5300,
    frame1: 4900,
    frame2: 5400,
    subtract: true,
    fullMode: "auto",
    tool: "area",
    ir1: win.min,
    ir2: win.max,
    irCorrect: false,
    place: false,
    knots: [],
    locked: false,
  };
  const result = computePair(qms.time, qms.signals[7], spec, pair, 1e-17);
  assert.ok(result.time > 100);
  assert.ok(Number.isFinite(result.meanI));
  assert.ok(result.irArea > 0);
  assert.ok(result.rate != null && result.rate > 0);
});
