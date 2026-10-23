import type { Analysis } from "@/domain/summary";
import type { Table } from "./export";

export const VIEWS = ["tablero", "cargos", "actividades", "areas", "agente"] as const;
export type View = (typeof VIEWS)[number];
export const isView = (v: string): v is View => (VIEWS as readonly string[]).includes(v);

const KIND = (k: string) => (k === "real" ? "REAL" : "DEMO");
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const pctOf = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

export function cargosTable(a: Analysis): Table {
  return {
    name: "Cargos",
    columns: [
      { key: "kind", header: "Tipo de dato", width: 12 }, { key: "area", header: "Área", width: 28 }, { key: "site", header: "Sede", width: 18 }, { key: "position", header: "Cargo", width: 30 },
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
      { key: "code", header: "Código", width: 14 }, { key: "kind", header: "Tipo de dato", width: 12 }, { key: "area", header: "Área", width: 28 }, { key: "site", header: "Sede", width: 18 },
      { key: "position", header: "Cargo", width: 30 }, { key: "status", header: "Estado de captura", width: 44 },
      { key: "hw", header: "Horas por semana", fmt: "#,##0.00" }, { key: "hm", header: "Horas por mes", fmt: "#,##0.00" },
    ],
    rows: a.activities.map((x) => ({ code: x.code, kind: KIND(x.dataKind), area: x.area, site: x.site, position: x.position, status: x.status, hw: r2(x.hoursWeek), hm: r2(x.hoursMonth) })),
  };
}

export function kpiTable(a: Analysis): Table {
  const k = a.kpis;
  return {
    name: "Indicadores",
    columns: [{ key: "ind", header: "Indicador", width: 40 }, { key: "val", header: "Valor", width: 18 }],
    rows: [
      { ind: "Actividades registradas", val: k.activities }, { ind: "Actividades completas", val: k.complete }, { ind: "Horas por semana", val: r2(k.hours) },
      { ind: "Capacidad (h/sem)", val: r2(k.capacity) }, { ind: "% de capacidad comprometida", val: pctOf(k.pct) }, { ind: "Cargos con alerta de sobrecarga", val: k.overload }, { ind: "Cargos por validar (carga baja)", val: k.low },
    ],
  };
}

/** Propuestas del agente: sin ejecuciones aún (requiere ANTHROPIC_API_KEY, Fase 9). */
export function agenteTable(): Table {
  return {
    name: "Propuestas",
    columns: [{ key: "id", header: "ID" }, { key: "tipo", header: "Tipo" }, { key: "resumen", header: "Resumen", width: 60 }, { key: "estado", header: "Estado" }, { key: "decidio", header: "Decidida por" }, { key: "fecha", header: "Fecha" }],
    rows: [],
  };
}

export function tablesFor(view: View, a: Analysis): { title: string; tables: Table[] } {
  switch (view) {
    case "tablero": return { title: "Tablero ejecutivo", tables: [kpiTable(a), cargosTable(a), areasTable(a)] };
    case "cargos": return { title: "Cargos y dotación", tables: [cargosTable(a)] };
    case "actividades": return { title: "Inventario de actividades", tables: [actividadesTable(a)] };
    case "areas": return { title: "Áreas", tables: [areasTable(a)] };
    case "agente": return { title: "Agente de IA", tables: [agenteTable()] };
  }
}
