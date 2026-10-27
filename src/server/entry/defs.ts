/**
 * Definición de los formularios de captura: UNA por hoja de entrada del libro (2, 3, 5, 6, 7, 8, 9 y 10). Cada casilla amarilla del libro es un
 * campo del formulario, con su encabezado, su ayuda y su lista desplegable idénticos a los del libro. Las columnas con fórmula (grises) se listan
 * aparte como «calculadas» y NO son editables.
 */
import { LABELS } from "../../domain/labels";
import { SHEET_FIELDS } from "../../domain/sheetfields";
import { ui } from "../../domain/terms";
import { ADAPTERS, MIRROR_ADAPTERS, adapterById, type Adapter } from "../sheets/adapters";

export type EntryId = "2" | "3" | "5" | "6" | "7" | "8" | "9" | "10";
export const ENTRY_IDS: EntryId[] = ["2", "3", "5", "6", "7", "8", "9", "10"];
export type Control = "text" | "textarea" | "select" | "yesno" | "number" | "percent" | "date" | "area" | "site" | "position" | "activity";

/** Hojas cuyo registro lleva el dato «Centro de operaciones» (D-75): no existe en el libro de Excel; se guarda aparte y se espeja a una columna adicional de la hoja de Google. */
export const SITE_FIELD_SHEETS: EntryId[] = ["8", "9", "10"];
/** Clave del campo «Centro de operaciones» en los formularios y las plantillas (no es una columna del libro). */
export const SITE_COL = "CO";

export interface EntryField { col: string; field: string; header: string; /** Encabezado del libro de Excel (la plantilla de carga masiva también lo reconoce). */ libroHeader: string; hint: string; group: string; control: Control; list?: keyof typeof LABELS; required: boolean; /** Campo propio de la aplicación (no es una casilla del libro de Excel). */ extra?: boolean }
export interface EntryComputed { col: string; header: string; format: "text" | "number" | "percent" }
export interface EntryDef {
  id: EntryId; adapter: Adapter; sheetName: string; title: string; note: string; short: string;
  fields: EntryField[]; computed: EntryComputed[]; listFields: string[];
}

const SHORT_TEXT = new Set(["code", "name", "area", "site", "position", "regional", "employeeCode", "boss", "surveyor", "secondaryPosition", "otherPositions", "owner", "indicator", "receiving", "activityCode", "criterion", "process"]);
const REQUIRED: Record<EntryId, string[]> = {
  "2": ["area", "site", "position"], "3": ["code", "area", "site", "position", "name"], "5": ["code"], "6": ["code"], "7": ["code"], "8": ["code"], "9": ["area", "position"], "10": ["code", "action"],
};
const SHORT_TITLE: Record<EntryId, string> = { "2": "Cargos y dotación", "3": "Actividades", "5": "Medibilidad", "6": "Pertinencia", "7": "Riesgos", "8": "Oportunidades", "9": "Rediseño", "10": "Plan de acción" };
/** Campos de la lista (tabla) de cada hoja, además de los calculados. */
const LIST_FIELDS: Record<EntryId, string[]> = {
  "2": ["area", "site", "position", "headcount", "weeklyHours"], "3": ["code", "area", "position", "name"], "5": ["code"], "6": ["code"], "7": ["code"], "8": ["code", "type", "site"], "9": ["area", "position", "site"], "10": ["code", "action", "site"],
};

function controlOf(id: EntryId, field: string, kind: unknown): { control: Control; list?: keyof typeof LABELS } {
  if (field === "area") return { control: "area" };
  if (field === "site") return { control: "site" };
  if (field === "position" || field === "secondaryPosition" || field === "receiving") return { control: "position" };
  if (field === "code" && ["5", "6", "7"].includes(id)) return { control: "activity" };
  if (field === "activityCode") return { control: "activity" };
  if (typeof kind === "object" && kind !== null && "label" in kind) return { control: "select", list: (kind as { label: keyof typeof LABELS }).label };
  if (kind === "bool") return { control: "yesno" };
  if (kind === "date") return { control: "date" };
  if (kind === "pct") return { control: "percent" };
  if (kind === "num" || kind === "scale" || (typeof kind === "object" && kind !== null && ("range" in kind || "int" in kind))) return { control: "number" };
  return { control: SHORT_TEXT.has(field) ? "text" : "textarea" };
}

/** «INVENTARIO DETALLADO DE ACTIVIDADES» → «Inventario detallado de actividades» (sin el identificador de la hoja del libro). */
const sentence = (s: string) => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

function build(id: EntryId): EntryDef {
  const adapter = adapterById(id)!;
  const cat = SHEET_FIELDS[id];
  const byCol = new Map(cat.columns.map((c) => [c.col, c]));
  const fields: EntryField[] = Object.entries(adapter.spec).flatMap(([field, [col, kind]]) => {
    const c = byCol.get(col); if (!c || !c.input) return [];
    return [{ col, field, header: ui(c.header), libroHeader: c.header, hint: ui(c.hint), group: c.group, ...controlOf(id, field, kind), required: REQUIRED[id].includes(field) }];
  }).sort((x, y) => cat.columns.findIndex((c) => c.col === x.col) - cat.columns.findIndex((c) => c.col === y.col));
  if (SITE_FIELD_SHEETS.includes(id)) {
    // D-75: «Centro de operaciones» (opcional), junto al cargo; no es una casilla del libro.
    const at = fields.findIndex((f) => f.field === "position");
    const near = fields[at];
    fields.splice(at + 1, 0, { col: SITE_COL, field: "site", header: "Centro de operaciones (CO)", libroHeader: "Centro de operaciones (CO)", hint: "Centro de operaciones al que aplica. Debe estar ya registrado en Cargos y dotación. Opcional.", group: near.group, control: "site", required: false, extra: true });
  }
  const computed: EntryComputed[] = cat.columns.filter((c) => !c.input).map((c) => ({ col: c.col, header: ui(c.header), format: "text" as const }));
  return { id, adapter, sheetName: cat.sheetName, title: sentence(cat.title.replace(/^HOJA \d+ · /i, "")), note: ui(cat.note), short: SHORT_TITLE[id], fields, computed, listFields: LIST_FIELDS[id] };
}

let cache: Map<EntryId, EntryDef> | null = null;
export function entryDef(id: string): EntryDef | null {
  if (!(ENTRY_IDS as string[]).includes(id)) return null;
  cache ??= new Map(ENTRY_IDS.map((x) => [x, build(x)]));
  return cache.get(id as EntryId) ?? null;
}
export const allEntryDefs = () => ENTRY_IDS.map((i) => entryDef(i)!);
void ADAPTERS; void MIRROR_ADAPTERS;
