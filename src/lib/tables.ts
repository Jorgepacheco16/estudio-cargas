import type { Analysis } from "@/domain/summary";
import type { Dashboard } from "@/domain/dashboard";
import type { Table } from "./export";
import { compareSites } from "@/domain/sites";
import { CALC_4A, calcValue } from "@/domain/calc4a";
import { PRESETS, PRESET_ES, LEVEL_ES, METRIC_ES, drillRows, type DrillFilters, type LevelKey } from "@/domain/drill";
import type { Mode } from "@/domain/summary";

export const VIEWS = ["tablero", "cargos", "actividades", "calculo", "areas", "sedes", "drill", "agente"] as const;
export type View = (typeof VIEWS)[number];
export const isView = (v: string): v is View => (VIEWS as readonly string[]).includes(v);

const KIND = (k: string) => (k === "real" ? "REAL" : "DEMO");
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const pctOf = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

export function cargosTable(a: Analysis): Table {
  return {
    name: "Cargos",
    columns: [
      { key: "kind", header: "Tipo de dato", width: 12 }, { key: "area", header: "Área", width: 28 }, { key: "site", header: "Centro de operaciones", width: 18 }, { key: "position", header: "Cargo", width: 30 },
      { key: "occupants", header: "Ocupantes", fmt: "0" }, { key: "capacity", header: "Capacidad (h/sem)", fmt: "#,##0.00" }, { key: "hours", header: "Horas (h/sem)", fmt: "#,##0.00" },
      { key: "pct", header: "% de capacidad", fmt: "0.0%" }, { key: "acts", header: "Actividades", fmt: "0" }, { key: "complete", header: "Completas", fmt: "0" }, { key: "reading", header: "Lectura", width: 70 },
    ],
    rows: a.positions.map((p) => ({ kind: KIND(p.dataKind), area: p.area, site: p.site, position: p.position, occupants: p.occupants, capacity: r2(p.capacity), hours: r2(p.hours), pct: pctOf(p.pct), acts: p.activities, complete: p.complete, reading: p.reading })),
  };
}

export function areasTable(a: Analysis): Table {
  return {
    name: "Áreas",
    columns: [
      { key: "area", header: "Área", width: 32 }, { key: "acts", header: "Actividades", fmt: "0" }, { key: "complete", header: "Completas", fmt: "0" },
      { key: "hours", header: "Horas (h/sem)", fmt: "#,##0.00" }, { key: "capacity", header: "Capacidad (h/sem)", fmt: "#,##0.00" }, { key: "pct", header: "% comprometida", fmt: "0.0%" },
    ],
    rows: a.areas.map((r) => ({ area: r.area, acts: r.activities, complete: r.complete, hours: r2(r.hours), capacity: r2(r.capacity), pct: pctOf(r.pct) })),
  };
}

export function actividadesTable(a: Analysis): Table {
  return {
    name: "Actividades",
    columns: [
      { key: "code", header: "Código", width: 14 }, { key: "kind", header: "Tipo de dato", width: 12 }, { key: "area", header: "Área", width: 28 }, { key: "site", header: "Centro de operaciones", width: 18 },
      { key: "position", header: "Cargo", width: 30 }, { key: "status", header: "Estado de captura", width: 44 },
      { key: "hw", header: "Horas por semana", fmt: "#,##0.00" }, { key: "hm", header: "Horas por mes", fmt: "#,##0.00" },
    ],
    rows: a.activities.map((x) => ({ code: x.code, kind: KIND(x.dataKind), area: x.area, site: x.site, position: x.position, status: x.status, hw: r2(x.hoursWeek), hm: r2(x.hoursMonth) })),
  };
}

const pct4 = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

/** Tablero completo (hoja 11): 12 indicadores, carga por área, distribución, top 10, cobertura, oportunidades y conclusiones. */
export function dashboardTables(d: Dashboard): Table[] {
  const k = d.indicators;
  const kpi: Table = {
    name: "Indicadores", columns: [{ key: "ind", header: "Indicador", width: 44 }, { key: "val", header: "Valor", width: 18 }],
    rows: [
      { ind: "Áreas con información", val: k.areasWithInfo }, { ind: "Actividades registradas", val: k.activities }, { ind: "Con datos completos (%)", val: pct4(k.completePct) },
      { ind: "Horas/semana inventariadas", val: r2(k.hours) }, { ind: "Capacidad disponible (h/sem)", val: r2(k.capacity) }, { ind: "% de capacidad comprometida", val: pct4(k.capacityPct) },
      { ind: "Cargos con carga > capacidad", val: k.overload }, { ind: "Cargos con carga baja (validar)", val: k.lowLoad }, { ind: "Actividades con fuente verificable (%)", val: pct4(k.verifiablePct) },
      { ind: "Oportunidades registradas", val: k.opportunities }, { ind: "Tiempo recuperable (h/sem)", val: r2(k.recoverableHours) }, { ind: "Críticas sin respaldo", val: k.criticalNoBackup },
    ],
  };
  const areas: Table = {
    name: "Carga por área",
    columns: [{ key: "area", header: "Área", width: 36 }, { key: "acts", header: "Actividades", fmt: "0" }, { key: "complete", header: "Con datos completos", fmt: "0" }, { key: "hours", header: "Horas/sem", fmt: "#,##0.00" },
      { key: "capacity", header: "Capacidad (h/sem)", fmt: "#,##0.00" }, { key: "pct", header: "% capacidad", fmt: "0.0%" }, { key: "reading", header: "Alerta o lectura", width: 80 }],
    rows: d.areas.map((r) => ({ area: r.area, acts: r.activities, complete: r.complete, hours: r2(r.hours), capacity: r2(r.capacity), pct: pct4(r.pct), reading: r.reading })),
  };
  const dist: Table = {
    name: "Distribución de horas",
    columns: [{ key: "grupo", header: "Grupo", width: 26 }, { key: "cat", header: "Categoría", width: 40 }, { key: "hours", header: "Horas/sem", fmt: "#,##0.00" }, { key: "pct", header: "% del total", fmt: "0.0%" }],
    rows: [...d.byValue.map((s) => ({ grupo: "Aporte de valor", s })), ...d.byType.map((s) => ({ grupo: "Tipo de actividad", s })), ...d.byPotential.map((s) => ({ grupo: "Potencial ALTO de…", s }))]
      .map(({ grupo, s }) => ({ grupo, cat: s.label, hours: r2(s.hours), pct: pct4(s.pct) })),
  };
  const top: Table = {
    name: "Top 10 actividades",
    columns: [{ key: "n", header: "#", fmt: "0" }, { key: "name", header: "Actividad", width: 60 }, { key: "code", header: "Código", width: 14 }, { key: "area", header: "Área", width: 30 }, { key: "pos", header: "Cargo", width: 30 }, { key: "site", header: "Centro de operaciones", width: 18 }, { key: "hours", header: "Horas/sem", fmt: "#,##0.00" }, { key: "pct", header: "% del total", fmt: "0.0%" }],
    rows: d.top10.map((t, i) => ({ n: i + 1, name: t.name, code: t.code, area: t.area, pos: t.position, site: t.site, hours: r2(t.hours), pct: pct4(t.pct) })),
  };
  const cov: Table = { name: "Cobertura y calidad", columns: [{ key: "i", header: "Indicador", width: 70 }, { key: "v", header: "Valor", width: 16 }, { key: "n", header: "Nota", width: 80 }], rows: d.coverage.map((c) => ({ i: c.label, v: c.value, n: c.note })) };
  const opp: Table = { name: "Oportunidades y plan", columns: [{ key: "i", header: "Indicador", width: 50 }, { key: "v", header: "Valor", width: 24 }], rows: d.opportunities.map((c) => ({ i: c.label, v: c.value })) };
  const concl: Table = { name: "Conclusiones", columns: [{ key: "c", header: "Conclusión preliminar", width: 140 }], rows: d.conclusions.map((c) => ({ c })) };
  return [kpi, areas, dist, top, cov, opp, concl];
}
/** Propuestas del agente: sin ejecuciones aún (requiere ANTHROPIC_API_KEY, Fase 9). */
export interface ProposalRow { id: string; kind: string; summary: string; status: string; reviewedBy: string | null; at: string }
export function agenteTable(rows: ProposalRow[] = []): Table {
  return {
    name: "Propuestas",
    columns: [{ key: "id", header: "ID" }, { key: "tipo", header: "Tipo" }, { key: "resumen", header: "Resumen", width: 60 }, { key: "estado", header: "Estado" }, { key: "decidio", header: "Decidida por" }, { key: "fecha", header: "Fecha" }],
    rows: rows.map((r) => ({ id: r.id, tipo: r.kind, resumen: r.summary, estado: r.status, decidio: r.reviewedBy, fecha: r.at })),
  };
}

/** Hoja 4a: cálculo de tiempos de cada actividad, con los encabezados del libro. */
export function calculoTable(a: Analysis): Table {
  const occ = (x: Analysis["activities"][number]) => a.positions.find((p) => p.dataKind === x.dataKind && p.area === x.area && p.site === x.site && p.position === x.position)?.occupants ?? 0;
  return {
    name: "Cálculo de tiempos",
    columns: [{ key: "kind", header: "Tipo de dato", width: 12 }, { key: "code", header: "Código", width: 14 }, { key: "area", header: "Área", width: 26 }, { key: "site", header: "Centro de operaciones", width: 18 }, { key: "position", header: "Cargo", width: 28 }, { key: "status", header: "Estado de captura", width: 44 },
      ...CALC_4A.map((c) => ({ key: c.col, header: c.header, fmt: c.fmt, width: 18 }))],
    rows: a.activities.map((x) => ({ kind: KIND(x.dataKind), code: x.code, area: x.area, site: x.site, position: x.position, status: x.status, ...Object.fromEntries(CALC_4A.map((c) => [c.col, r2x(calcValue(x, c.key, occ(x)))])) })),
  };
}
const r2x = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);

/** Comparador de sedes (hoja 2b) del cargo elegido. */
export function sedesTable(a: Analysis, area: string, position: string, mode: Mode, reservePct: number, undocumented?: Map<string, number>): Table {
  const c = compareSites(a, area, position, mode, reservePct, undocumented);
  return {
    name: "Comparador de sedes",
    columns: [{ key: "site", header: "Centro de operaciones", width: 26 }, { key: "occ", header: "Ocupantes", fmt: "0" }, { key: "wh", header: "Jornada semanal (h)", fmt: "#,##0.0" }, { key: "cap", header: "Capacidad (h/sem)", fmt: "#,##0.00" }, { key: "hours", header: "Horas/sem asignadas", fmt: "#,##0.00" },
      { key: "pct", header: "% de capacidad", fmt: "0.0%" }, { key: "per", header: "Horas/sem por ocupante", fmt: "#,##0.00" }, { key: "acts", header: "Actividades registradas", fmt: "0" }, { key: "und", header: "No documentadas formalmente", fmt: "0" }, { key: "read", header: "Alerta o lectura de la sede", width: 70 }],
    rows: [...c.rows.map((r) => ({ site: r.site, occ: r.occupants, wh: r2(r.weeklyHours), cap: r2(r.capacity), hours: r2(r.hours), pct: pctOf(r.pct), per: r2(r.perOccupant), acts: r.activities, und: r.undocumented, read: r.reading })),
      { site: "Dispersión (máx − mín) ÷ promedio", occ: null, wh: null, cap: null, hours: null, pct: pctOf(c.dispersion), per: r2(c.average), acts: null, und: null, read: c.reading }],
  };
}

/** Un nivel del drill-down como tabla. */
export function drillTable(a: Analysis, config: string, level: LevelKey, filters: DrillFilters): Table {
  const cfg = PRESETS[config] ?? PRESETS["carga-por-area"];
  const metrics = cfg.levels.find((l) => l.key === level)?.metrics ?? [];
  const pct = new Set(["pct"]);
  return {
    name: `${PRESET_ES[cfg.id] ?? cfg.id} · ${LEVEL_ES[level]}`.slice(0, 31),
    columns: [{ key: "label", header: LEVEL_ES[level], width: 32 }, { key: "detail", header: "Detalle", width: 40 }, ...metrics.map((m) => ({ key: m, header: METRIC_ES[m], fmt: pct.has(m) ? "0.0%" : m === "incomplete" ? "0" : "#,##0.00" })), { key: "status", header: "Lectura o estado de captura", width: 60 }],
    rows: drillRows(a, cfg, level, filters).map((r) => ({ label: r.label, detail: r.detail ?? null, ...Object.fromEntries(metrics.map((m) => [m, m === "pct" ? pctOf(r.metrics.pct ?? null) : r2(r.metrics[m] ?? null)])), status: r.status ?? null })),
  };
}

export interface ViewQuery { area?: string; position?: string; config?: string; level?: string; site?: string; code?: string; alert?: string }
export function tablesFor(view: View, a: Analysis, d: Dashboard, proposals: ProposalRow[] = [], q: ViewQuery = {}, mode: Mode = "all", reservePct = 0.1): { title: string; tables: Table[] } {
  switch (view) {
    case "tablero": return { title: "Inicio", tables: [...dashboardTables(d).slice(0, 1), cargosTable(a), ...dashboardTables(d).slice(1)] };
    case "cargos": return { title: "Cargos y dotación", tables: [cargosTable(a)] };
    case "actividades": return { title: "Actividades", tables: [actividadesTable(a)] };
    case "areas": return { title: "Áreas", tables: [areasTable(a)] };
    case "calculo": return { title: "Cálculo de tiempos", tables: [calculoTable(a)] };
    case "sedes": return { title: "Comparador de centros de operaciones", tables: [sedesTable(a, q.area ?? "", q.position ?? "", mode, reservePct)] };
    case "drill": { const lv = (["study", "area", "position", "activity"] as const).find((x) => x === q.level) ?? "study"; return { title: "Drill-down", tables: [drillTable(a, q.config ?? "carga-por-area", lv, { area: q.area, site: q.site, position: q.position, alertOnly: (q.alert as DrillFilters["alertOnly"]) ?? "", ...(q.code ? { code: q.code } : {}) } as DrillFilters)] }; }
    case "agente": return { title: "Agente de IA", tables: [agenteTable(proposals)] };
  }
}
