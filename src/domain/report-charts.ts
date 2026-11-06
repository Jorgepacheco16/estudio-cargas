/**
 * Geometría de las gráficas del informe (D-105): funciones puras que convierten las cifras en posiciones dentro de un lienzo SVG. El componente (ReportCharts.tsx) solo las dibuja,
 * así la escala, los ejes y las líneas de referencia se prueban sin navegador. Las posiciones están en unidades del lienzo (viewBox), no en píxeles de pantalla.
 */
import type { AlertLevel } from "./summary";
import type { WeekFact } from "./report";

/** Paso «redondo» (1, 2, 5, 10, 20, 50…) para que el eje tenga como máximo `maxTicks` marcas. */
export function niceStep(max: number, maxTicks = 5): number {
  if (!(max > 0)) return 1;
  const raw = max / maxTicks, pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw - 1e-12) return m * pow;
  return 10 * pow;
}
/** Marcas del eje desde 0 hasta la primera que cubre `max`. */
export function axisTicks(max: number, maxTicks = 5): number[] {
  const step = niceStep(max, maxTicks), top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
}
export const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, Math.max(1, n - 1)).trimEnd() + "…");

/* ───────── 1. Personas que hay y necesarias, por área (barras agrupadas) ───────── */
export interface AreaBars { label: string; hay: number; necesarias: number }
export interface GroupedChart {
  width: number; height: number; baseline: number; top: number; left: number;
  ticks: { value: number; y: number }[];
  groups: { label: string; cx: number; bars: { series: "hay" | "necesarias"; value: number; x: number; y: number; w: number; h: number }[] }[];
}
export function peopleByAreaChart(rows: readonly AreaBars[]): GroupedChart {
  const left = 44, right = 16, top = 28, plotH = 196, groupW = 96, barW = 34, gap = 4;
  const width = Math.max(440, left + right + Math.max(rows.length, 1) * groupW), height = top + plotH + 40, baseline = top + plotH;
  const ticks = axisTicks(Math.max(1, ...rows.flatMap((r) => [r.hay, r.necesarias]))), topValue = ticks[ticks.length - 1];
  const y = (v: number) => baseline - (v / topValue) * plotH;
  return {
    width, height, baseline, top, left,
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    groups: rows.map((r, i) => {
      const cx = left + groupW * i + groupW / 2;
      const bar = (series: "hay" | "necesarias", value: number, x: number) => ({ series, value, x, y: y(value), w: barW, h: baseline - y(value) });
      return { label: r.label, cx, bars: [bar("hay", r.hay, cx - barW - gap / 2), bar("necesarias", r.necesarias, cx + gap / 2)] };
    }),
  };
}

/* ───────── 2. Uso de la capacidad actual, por cargo (barras horizontales con umbral) ───────── */
export interface UseRow { label: string; pct: number; level: AlertLevel }
export interface UseChart {
  width: number; height: number; plotLeft: number; plotRight: number; top: number; bottom: number;
  /** Máximo del eje, en % (por ejemplo 140). */ axisMax: number;
  x100: number; xThreshold: number; thresholdPct: number;
  rows: { label: string; short: string; pct: number; level: AlertLevel; y: number; w: number; labelY: number }[];
  ticks: { pct: number; x: number }[];
}
export function useByPositionChart(rows: readonly UseRow[], overload: number, maxRows = 10): UseChart {
  const plotLeft = 190, plotW = 250, rowH = 46, top = 30, barH = 22, width = plotLeft + plotW + 56;
  const shown = rows.slice(0, maxRows), maxPct = Math.max(...shown.map((r) => r.pct * 100), overload * 100, 100);
  const axisMax = Math.max(140, Math.ceil(maxPct / 20) * 20), px = (pct: number) => plotLeft + (pct / axisMax) * plotW;
  const height = top + Math.max(shown.length, 1) * rowH + 30;
  return {
    width, height, plotLeft, plotRight: plotLeft + plotW, top, bottom: height - 30, axisMax,
    x100: px(100), xThreshold: px(overload * 100), thresholdPct: overload * 100,
    rows: shown.map((r, i) => ({ label: r.label, short: truncate(r.label, 26), pct: r.pct, level: r.level, y: top + i * rowH, w: (r.pct * 100 / axisMax) * plotW, labelY: top + i * rowH + barH / 2 })),
    ticks: [0, 50, 100, ...(axisMax > 100 ? [axisMax] : [])].filter((v, i, a) => a.indexOf(v) === i).map((pct) => ({ pct, x: px(pct) })),
  };
}

/* ───────── 3. Trabajo de la semana común y de la semana con periódicas ───────── */
export interface WeeksChart {
  width: number; height: number; plotLeft: number; top: number; bottom: number; axisMax: number;
  xCapacity: number | null; xThreshold: number | null; capacityHours: number; thresholdHours: number;
  bars: { id: "common" | "periodic"; label: string; hours: number; utilization: number; y: number; w: number }[];
  ticks: { value: number; x: number }[];
}
export function weeksChart(common: WeekFact | null, periodic: WeekFact | null, overload: number): WeeksChart {
  const plotLeft = 150, plotW = 270, top = 34, rowH = 56, barH = 30, width = plotLeft + plotW + 24;
  const present: { id: "common" | "periodic"; label: string; week: WeekFact }[] = [];
  if (common) present.push({ id: "common", label: "Semana común", week: common });
  if (periodic) present.push({ id: "periodic", label: "Con periódicas", week: periodic });
  const capacity = Math.max(0, ...present.map((p) => p.week.capacityHours)), threshold = capacity * overload;
  const ticks = axisTicks(Math.max(1, ...present.map((p) => p.week.workHours), threshold) * 1.05), axisMax = ticks[ticks.length - 1], px = (v: number) => plotLeft + (v / axisMax) * plotW;
  const height = top + Math.max(present.length, 1) * rowH + 44;
  return {
    width, height, plotLeft, top, bottom: top + Math.max(present.length, 1) * rowH, axisMax,
    xCapacity: present.length ? px(capacity) : null, xThreshold: present.length ? px(threshold) : null, capacityHours: capacity, thresholdHours: threshold,
    bars: present.map((p, k) => ({ id: p.id, label: p.label, hours: p.week.workHours, utilization: p.week.utilization, y: top + k * rowH + (rowH - barH) / 2 - 4, w: (p.week.workHours / axisMax) * plotW })),
    ticks: ticks.map((value) => ({ value, x: px(value) })),
  };
}
