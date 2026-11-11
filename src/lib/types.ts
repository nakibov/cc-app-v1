export type Channel = {
  id: number;
  mass: number;
  name: string;
};

export type QmsData = {
  filename: string;
  units: string;
  channels: Channel[];
  time: number[];
  signals: number[][];
};

export type Spectrum = {
  filename: string;
  index: number;
  wn: number[];
  abs: number[];
};

export type Tool = "baseline" | "area";
export type FullMode = "auto" | "manual";

export type Knot = {
  id: string;
  wn: number;
  abs: number;
};

export type Pair = {
  id: string;
  spectrum: string;
  base1: number;
  base2: number;
  span1: number;
  span2: number;
  corr1: number;
  corr2: number;
  frame1: number;
  frame2: number;
  subtract: boolean;
  fullMode: FullMode;
  tool: Tool;
  ir1: number;
  ir2: number;
  irCorrect: boolean;
  place: boolean;
  knots: Knot[];
  locked: boolean;
};

export type PairResult = {
  time: number;
  sGood: number;
  sFull: number;
  k: number;
  meanI: number;
  irArea: number;
  optical: number;
  rate: number | null;
  baseY1: number;
  baseY2: number;
  warnings: string[];
};

export type CalibPoint = {
  spectrum: string;
  meanI: number;
  rate: number;
  time: number;
  sGood: number;
  sFull: number;
  k: number;
  irArea: number;
};

export type Fit = {
  order: number;
  /** a1…an for y = a1 x + … + an x^n */
  coeffs: number[];
  scale: number;
  r2: number;
};
