/**
 * Filtros de las pantallas que muestran RESULTADOS calculados (D-74): Cargos y dotación (por cargo y centro de operaciones), Actividades y Cálculo de
 * tiempos (por actividad). Las listas de registros capturados usan src/server/entry/filters.ts. Las opciones salen de todas las filas, no de las filtradas.
 */
import { BASIC_KEYS, BASIC_LABELS, activeCount, optionsOf, passes, readFilters, type FilterField, type Filters, type Triple } from "@/domain/filters";
import type { ActivityRow, PositionRow } from "@/domain/summary";

export type RawParams = Record<string, string | string[] | undefined>;
export interface PageFilter<T> { rows: T[]; fields: FilterField[]; triples: Triple[]; current: Filters; active: number }

const LOAD_LABEL: Record<string, string> = { overload: "Sobrecarga (alerta)", low: "Carga baja (validar)", ok: "Dentro del rango", nodata: "Sin datos suficientes" };
const DATA_LABEL: Record<string, string> = { completos: "Completos", faltantes: "Con faltantes" };
const CAPTURE_LABEL: Record<string, string> = { completa: "Completa", incompleta: "Con datos faltantes" };
const CALC_LABEL: Record<string, string> = { completa: "Calculada", incompleta: "Incompleta (no suma horas)" };

/** Cargos y dotación: centro de operaciones, área, cargo, estado de la carga y datos completos o con faltantes. */
export function positionFilters(all: PositionRow[], sp: RawParams): PageFilter<PositionRow> {
  const current = readFilters(sp, [...BASIC_KEYS, "carga", "datos"]);
  const dataOf = (p: PositionRow) => (p.activities > 0 && p.complete === p.activities && p.capacity > 0 ? "completos" : "faltantes");
  const get = { co: (p: PositionRow) => p.site, area: (p: PositionRow) => p.area, cargo: (p: PositionRow) => p.position, carga: (p: PositionRow) => p.level, datos: dataOf };
  const fields: FilterField[] = [
    ...BASIC_KEYS.map((k) => ({ key: k as string, label: BASIC_LABELS[k], options: optionsOf(all.map((p) => ({ co: p.site, area: p.area, cargo: p.position })[k])) })),
    { key: "carga", label: "Estado de la carga", options: optionsOf(all.map((p) => p.level), ["overload", "low", "ok", "nodata"], LOAD_LABEL) },
    { key: "datos", label: "Datos", options: optionsOf(all.map(dataOf), ["completos", "faltantes"], DATA_LABEL) },
  ];
  return { rows: all.filter((p) => passes(p, current, get)), fields: fields.filter((f) => f.options.length > 0), triples: all.map((p) => ({ co: p.site, area: p.area, cargo: p.position })), current, active: activeCount(current) };
}

/**
 * Actividades (estado de captura) y Cálculo de tiempos (estado del cálculo): centro de operaciones, área, cargo, estado y búsqueda por código, nombre o cargo.
 * `names` (código en minúsculas → nombre) amplía la búsqueda cuando se conoce el nombre de la actividad.
 */
export function activityFilters(all: ActivityRow[], sp: RawParams, kind: "captura" | "calculo", names?: Map<string, string>): PageFilter<ActivityRow> {
  const current = readFilters(sp, [...BASIC_KEYS, kind], true);
  const state = (x: ActivityRow) => (x.complete ? "completa" : "incompleta");
  const get = { co: (x: ActivityRow) => x.site, area: (x: ActivityRow) => x.area, cargo: (x: ActivityRow) => x.position, [kind]: state };
  const labels = kind === "captura" ? CAPTURE_LABEL : CALC_LABEL;
  const fields: FilterField[] = [
    ...BASIC_KEYS.map((k) => ({ key: k as string, label: BASIC_LABELS[k], options: optionsOf(all.map((x) => ({ co: x.site, area: x.area, cargo: x.position })[k])) })),
    { key: kind, label: kind === "captura" ? "Estado de captura" : "Estado del cálculo", options: optionsOf(all.map(state), ["completa", "incompleta"], labels) },
  ];
  const text = (x: ActivityRow) => `${x.code} ${names?.get(x.code.toLowerCase()) ?? ""} ${x.position} ${x.area} ${x.site}`;
  return { rows: all.filter((x) => passes(x, current, get, text)), fields: fields.filter((f) => f.options.length > 0), triples: all.map((x) => ({ co: x.site, area: x.area, cargo: x.position })), current, active: activeCount(current) };
}

/** Convierte los parámetros de una dirección en un objeto que conserva los valores repetidos. */
export function paramsToRecord(u: URLSearchParams): RawParams {
  const out: Record<string, string[]> = {};
  for (const [k, v] of u.entries()) (out[k] ??= []).push(v);
  return out;
}
