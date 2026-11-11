import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { computePair } from "./compute.ts";
import { evalPoly, fitOrigin, invertPoly } from "./fit.ts";
import { guessMolecule, parseQms, parseSpectrum, suggestWindow } from "./parse.ts";
import { integrate, meanWindow } from "./signal.ts";
import { createSpline } from "./spline.ts";
import type { Pair } from "./types.ts";

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
