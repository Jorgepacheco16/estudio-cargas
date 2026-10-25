/**
 * Drill-down configurable (brief §7.6 y §15.2): Estudio → Área → Cargo → Actividad. Cada nivel agrupa, mide y apunta al siguiente.
 * Las métricas son las que ya calcula el motor: hours, capacity, pct, incomplete, unplanned, rework, wait, seasonVariation.
 * seasonVariation = horas con temporada alta − horas con temporada baja (h/sem). Función pura sobre el análisis.
 */
import { drillConfig, type DrillConfig } from "./contracts";
import { norm } from "./engine";
import type { ActivityRow, Analysis, AlertLevel } from "./summary";

export type Metric = DrillConfig["levels"][number]["metrics"][number];
export type LevelKey = "study" | "area" | "position" | "activity";
export const METRIC_ES: Record<Metric, string> = { hours: "Horas/sem", capacity: "Capacidad (h/sem)", pct: "% de capacidad", incomplete: "Incompletas", unplanned: "No planificadas (h/sem)", rework: "Reprocesos (h/sem)", wait: "Esperas (h/sem)", seasonVariation: "Variación de temporada (h/sem)" };
export const LEVEL_ES: Record<LevelKey, string> = { study: "Estudio", area: "Área", position: "Cargo y sede", activity: "Actividad" };

/** Configuraciones predefinidas (validadas con el contrato drillConfig al cargar el módulo). */
export const PRESETS: Record<string, DrillConfig> = {
  "carga-por-area": drillConfig.parse({
    id: "carga-por-area",
    levels: [
      { key: "study", groupBy: "area", metrics: ["hours", "capacity", "pct"], next: "area" },
      { key: "area", groupBy: "position", metrics: ["hours", "pct", "incomplete"], next: "position" },
      { key: "position", groupBy: "activity", metrics: ["hours", "unplanned", "rework"], next: "activity" },
      { key: "activity", groupBy: null, metrics: ["hours", "seasonVariation"], next: null },
    ],
    filters: { kind: "real" },
  }),
  "calidad-de-datos": drillConfig.parse({
    id: "calidad-de-datos",
    levels: [
      { key: "study", groupBy: "area", metrics: ["incomplete"], next: "area" },
      { key: "area", groupBy: "position", metrics: ["incomplete"], next: "position" },
      { key: "position", groupBy: "activity", metrics: ["incomplete", "hours"], next: "activity" },
      { key: "activity", groupBy: null, metrics: ["incomplete", "hours"], next: null },
    ],
    filters: { kind: "real", alertOnly: "incomplete" },
  }),
};
export const PRESET_ES: Record<string, string> = { "carga-por-area": "Carga por área", "calidad-de-datos": "Calidad de datos" };

export interface DrillFilters { area?: string; site?: string; position?: string; kind?: string; alertOnly?: "overload" | "lowLoad" | "incomplete" | "" }
export interface DrillRow { key: string; label: string; detail?: string; metrics: Partial<Record<Metric, number | null>>; status?: string; level?: AlertLevel; next: { level: LevelKey; filters: DrillFilters } | null }

const sum = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
function actMetrics(acts: ActivityRow[]): Partial<Record<Metric, number | null>> {
  const ok = acts.filter((x) => x.complete);
  return {
    hours: sum(ok.map((x) => x.result.hTotal)), incomplete: acts.length - ok.length, unplanned: sum(ok.map((x) => x.result.hUnplanned)), rework: sum(ok.map((x) => x.result.hRework)),
    wait: sum(ok.map((x) => x.result.hWait)), seasonVariation: sum(ok.map((x) => (x.result.hHighTotal ?? 0) - (x.result.hLowTotal ?? 0))),
  };
}
const same = (a: { area: string; site?: string; position?: string }, f: DrillFilters) =>
  (!f.area || norm(a.area) === norm(f.area)) && (!f.site || norm(a.site) === norm(f.site)) && (!f.position || norm(a.position) === norm(f.position));

/** Filas de un nivel del drill-down con los filtros heredados. */
/** El análisis ya viene filtrado por modo (REAL / DEMO / TODOS): aquí no se vuelve a filtrar. */
export function drillRows(a: Analysis, cfg: DrillConfig, level: LevelKey, f: DrillFilters = {}): DrillRow[] {
  const acts = a.activities;
  const poss = a.positions;
  const metricsOf = new Set(cfg.levels.find((l) => l.key === level)?.metrics ?? []);
  const pick = (m: Partial<Record<Metric, number | null>>) => Object.fromEntries(Object.entries(m).filter(([k]) => metricsOf.has(k as Metric))) as Partial<Record<Metric, number | null>>;
  let rows: DrillRow[] = [];

  if (level === "study") {
    rows = a.areas.map((ar) => {
      const mine = acts.filter((x) => norm(x.area) === norm(ar.area));
      return { key: ar.area, label: ar.area, detail: `${ar.activities} actividad(es)`, metrics: pick({ ...actMetrics(mine), hours: ar.hours, capacity: ar.capacity, pct: ar.pct }), next: { level: "area" as const, filters: { area: ar.area } } };
    }).filter((r) => acts.some((x) => norm(x.area) === norm(r.key)) || (r.metrics.capacity ?? 0) > 0);
  } else if (level === "area") {
    rows = poss.filter((p) => same(p, f)).map((p) => {
      const mine = acts.filter((x) => norm(x.area) === norm(p.area) && norm(x.site) === norm(p.site) && norm(x.position) === norm(p.position) && x.dataKind === p.dataKind);
      return { key: `${p.site}|${p.position}|${p.dataKind}`, label: p.position, detail: `${p.site}${p.dataKind === "demo" ? " · DEMO" : ""}`, level: p.level, status: p.reading, metrics: pick({ ...actMetrics(mine), hours: p.hours, capacity: p.capacity, pct: p.pct, incomplete: p.activities - p.complete }), next: { level: "position" as const, filters: { area: p.area, site: p.site, position: p.position } } };
    });
  } else if (level === "position") {
    // Horas del cargo = parte que asume como responsable (hPrimary) + parte que asume como cargo secundario de otras actividades (hSecondary): suma lo mismo que la hoja 4b.
    const as = (x: ActivityRow, role: "primary" | "secondary"): DrillRow => ({
      key: `${x.code}|${role}`, label: x.code, detail: role === "secondary" ? "Parte que asume como cargo secundario" : x.status === "OK" ? undefined : x.status, status: x.status,
      metrics: pick({ ...actMetrics([x]), hours: !x.complete ? null : role === "primary" ? (x.result.hPrimary ?? 0) : (x.result.hSecondary ?? 0) }),
      next: { level: "activity" as const, filters: { area: x.area, site: x.site, position: x.position, ...{ code: x.code } as object } },
    });
    rows = [
      ...acts.filter((x) => same(x, f)).map((x) => as(x, "primary")),
      ...acts.filter((x) => x.secondaryPosition && norm(x.secondaryArea ?? x.area) === norm(f.area) && norm(x.secondarySite ?? x.site) === norm(f.site) && norm(x.secondaryPosition) === norm(f.position)).map((x) => as(x, "secondary")),
    ];
  } else {
    const code = (f as DrillFilters & { code?: string }).code;
    rows = acts.filter((x) => (!code || norm(x.code) === norm(code)) && same(x, f)).map((x) => ({ key: x.code, label: x.code, detail: `${x.area} · ${x.site} · ${x.position}`, status: x.status, metrics: pick({ ...actMetrics([x]), hours: x.complete ? x.hoursWeek : null }), next: null }));
  }

  const alert = f.alertOnly ?? cfg.filters.alertOnly ?? "";
  if (alert === "incomplete") rows = rows.filter((r) => (r.metrics.incomplete ?? 0) > 0 || (r.status !== undefined && r.status !== "OK" && level !== "area"));
  if (alert === "overload") rows = rows.filter((r) => r.level === "overload" || (level === "study" && (r.metrics.pct ?? 0) > 1));
  if (alert === "lowLoad") rows = rows.filter((r) => r.level === "low");
  return rows.sort((x, y) => (y.metrics.hours ?? 0) - (x.metrics.hours ?? 0) || x.label.localeCompare(y.label, "es"));
}
