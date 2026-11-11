import type { QmsData, Spectrum } from "./types";

function euro(s: string): number {
  return Number(s.trim().replace(",", "."));
}

export function parseSpectrum(filename: string, text: string): Spectrum {
  const wn: number[] = [];
  const abs: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.includes(";") ? ";" : ",";
    const bits = trimmed.split(sep);
    if (bits.length < 2) continue;
    const x = euro(bits[0]);
    const y = euro(bits[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    wn.push(x);
    abs.push(y);
  }
  if (wn.length > 1 && wn[0] > wn[wn.length - 1]) {
    wn.reverse();
    abs.reverse();
  }
  const m = filename.match(/(\d+)/);
  const index = m ? Number(m[1]) : 0;
  return { filename, index, wn, abs };
}

function parseNums(line: string): number[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parts: string[];
  if (trimmed.includes(";")) {
    parts = trimmed.split(";").map((s) => s.trim().replace(",", "."));
  } else {
    parts = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (parts.length < 2) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

export function parseQms(filename: string, text: string): QmsData {
  const lines = text.split(/\r?\n/);
  let units = "Torr";
  const channels: QmsData["channels"] = [];
  const chRe =
    /^\s*(\d+)\s+([+-]?\d+(?:\.\d+)?)\s+(\S+)\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+\S+\s+(ON|OFF)\s*$/;
  let timeAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Units\s*,/i.test(line)) {
      const u = line.split(",")[1];
      if (u) units = u.trim();
    }
    const m = line.match(chRe);
    if (m && m[5] === "ON") {
      channels.push({ id: Number(m[1]), mass: Number(m[2]), name: m[3] });
    }
    if (/^Time\s*\(s\)/i.test(line)) {
      timeAt = i;
      break;
    }
  }
  if (timeAt < 0) throw new Error("В файле QMS нет колонки Time(s).");
  if (!channels.length) throw new Error("В файле QMS не найдены каналы.");

  const time: number[] = [];
  const signals = channels.map(() => [] as number[]);
  for (let i = timeAt + 1; i < lines.length; i++) {
    const nums = parseNums(lines[i]);
    if (!nums || nums.length < channels.length + 1) continue;
    time.push(nums[0]);
    for (let c = 0; c < channels.length; c++) signals[c].push(nums[c + 1]);
  }
  if (time.length < 2) throw new Error("В файле QMS слишком мало точек.");
  return { filename, units, channels, time, signals };
}

export function guessMolecule(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const stripped = base.replace(/\s*cc\s*$/i, "").trim();
  return stripped || base || "X";
}

export function spectrumOrder(a: Spectrum, b: Spectrum): number {
  if (a.index !== b.index) return a.index - b.index;
  return a.filename.localeCompare(b.filename, "ru");
}

/** Suggest an IR window around the strongest absorbance peak. */
export function suggestWindow(spectra: Spectrum[]): { min: number; max: number } {
  let bestY = -Infinity;
  let bestX = 2350;
  for (const s of spectra) {
    for (let i = 0; i < s.abs.length; i++) {
      if (s.abs[i] > bestY) {
        bestY = s.abs[i];
        bestX = s.wn[i];
      }
    }
  }
  const span = 160;
  return { min: Math.round(bestX - span), max: Math.round(bestX + span) };
}
