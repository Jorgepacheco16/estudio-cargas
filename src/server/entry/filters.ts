/**
 * Filtros de las listas de registros de cada sección (D-74): los básicos (centro de operaciones, área y cargo) en todas, y los propios aprobados por el
 * titular: actividades → estado de captura; medibilidad → nivel; riesgos → criticidad; oportunidades → tipo; plan de acción → estado, prioridad, tipo de
 * iniciativa, alerta de plazo y fecha de vencimiento. Pertinencia y rediseño solo llevan los básicos.
 */
import { BASIC_KEYS, BASIC_LABELS, activeCount, optionsOf, passes, readFilters, SEARCH_KEY, type FilterField, type Filters, type Triple } from "../../domain/filters";
import type { EntryDef, EntryId } from "./defs";
import type { EntryRow } from "./service";

interface Extra { key: string; label: string; value: (r: EntryRow, d: EntryDef) => string; order?: string[]; labels?: Record<string, string> }
const comp = (re: RegExp) => (r: EntryRow, d: EntryDef) => { const c = d.computed.find((x) => re.test(x.header))?.col; return c ? String(r.computed[c] ?? "") : ""; };
const cell = (field: string) => (r: EntryRow, d: EntryDef) => { const c = d.fields.find((f) => f.field === field)?.col; return c ? String(r.cells[c] ?? "") : ""; };

const EXTRAS: Partial<Record<EntryId, Extra[]>> = {
  "3": [{ key: "captura", label: "Estado de captura", value: (r, d) => (comp(/^Estado de captura/)(r, d).trim().toUpperCase() === "OK" ? "completa" : "incompleta"), order: ["completa", "incompleta"], labels: { completa: "Completa", incompleta: "Con datos faltantes" } }],
  "5": [{ key: "nivel", label: "Nivel de medibilidad", value: comp(/^Nivel de medibilidad/), order: ["Alta", "Media", "Baja", "Evaluación incompleta"] }],
  "7": [{ key: "criticidad", label: "Criticidad", value: comp(/^Criticidad/), order: ["Crítica", "Alta", "Media", "Baja", "Evaluación incompleta"] }],
  "8": [{ key: "tipo", label: "Tipo de oportunidad", value: cell("type") }],
  "10": [
    { key: "estado", label: "Estado", value: cell("status") },
    { key: "prioridad", label: "Prioridad", value: cell("priority"), order: ["Alta", "Media", "Baja"] },
    { key: "iniciativa", label: "Tipo de iniciativa", value: cell("initiative") },
    { key: "alerta", label: "Alerta de plazo", value: comp(/^Alerta de plazo/) },
  ],
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export interface DateRange { fromKey: string; toKey: string; label: string; from: string; to: string }
export interface EntryFilterResult { rows: EntryRow[]; fields: FilterField[]; triples: Triple[]; current: Filters; range: DateRange | null; active: number }

/** Aplica a las filas de una sección los filtros de la dirección y arma lo que necesita la barra de filtros. Las opciones salen de TODAS las filas. */
export function entryFilters(def: EntryDef, all: EntryRow[], sp: Record<string, string | string[] | undefined>): EntryFilterResult {
  const extras = EXTRAS[def.id] ?? [];
  const search = def.id === "3";
  const current = readFilters(sp, [...BASIC_KEYS, ...extras.map((e) => e.key)], search);
  const get: Record<string, (r: EntryRow) => string> = { co: (r) => r.facets.co, area: (r) => r.facets.area, cargo: (r) => r.facets.cargo };
  for (const e of extras) get[e.key] = (r) => e.value(r, def);
  const text = (r: EntryRow) => `${Object.values(r.cells).join(" ")} ${r.facets.cargo}`;
  let rows = all.filter((r) => passes(r, current, get, search ? text : undefined));

  let range: DateRange | null = null;
  if (def.id === "10") {
    const one = (k: string) => { const v = Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined); return v && ISO.test(v) ? v : ""; };
    range = { fromKey: "vdesde", toKey: "vhasta", label: "Vence entre", from: one("vdesde"), to: one("vhasta") };
    if (range.from || range.to) rows = rows.filter((r) => { const d = r.facets.end; return !!d && (!range!.from || d >= range!.from) && (!range!.to || d <= range!.to); });
  }
  const fields: FilterField[] = [
    ...BASIC_KEYS.map((k) => ({ key: k as string, label: BASIC_LABELS[k], options: optionsOf(all.map((r) => r.facets[k])) })),
    ...extras.map((e) => ({ key: e.key, label: e.label, options: optionsOf(all.map((r) => e.value(r, def)), e.order, e.labels) })),
  ];
  const triples = all.map((r) => ({ co: r.facets.co, area: r.facets.area, cargo: r.facets.cargo }));
  return { rows, fields: fields.filter((f) => f.options.length > 0), triples, current, range, active: activeCount(current) + (range && (range.from || range.to) ? 1 : 0) };
}
export { SEARCH_KEY };
