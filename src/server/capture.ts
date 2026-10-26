/**
 * Formulario de los PARÁMETROS del estudio (hoja «Parametros» del libro + umbrales propios de la app). Las hojas de captura 2, 3, 5 a 10 viven en
 * server/entry (D-62). Una definición declarativa alimenta el formulario, la validación y el guardado. Todo pasa por withRls(); los campos vacíos se
 * guardan vacíos (no se inventan valores). «Semanas por mes» NO es editable: en el libro es una fórmula (52/12).
 */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { withRls, type Db } from "../db/client";
import { auditLog, studyParameters } from "../db/schema";
import { LABELS } from "../domain/labels";
import { LONG_TEXT_MAX } from "../domain/limits";

export type FieldKind = "text" | "longtext" | "bool" | "scale" | "int" | "num" | "pct" | "date" | "list" | "activity" | "area";
export interface Field { key: string; label: string; kind: FieldKind; list?: keyof typeof LABELS; required?: boolean; notNull?: boolean; max?: number; hint?: string }
export interface SheetDef { id: string; title: string; table: PgTable; keyCols: string[]; idCol: "id" | "studyId"; fields: Field[]; entity: string }

const L = (key: string, label: string, list: keyof typeof LABELS, o: Partial<Field> = {}): Field => ({ key, label, kind: "list", list, ...o });
const T = (key: string, label: string, o: Partial<Field> = {}): Field => ({ key, label, kind: "longtext", ...o });
const B = (key: string, label: string): Field => ({ key, label, kind: "bool" });
const S = (key: string, label: string, hint = "1 a 5"): Field => ({ key, label, kind: "scale", hint });
const N = (key: string, label: string, o: Partial<Field> = {}): Field => ({ key, label, kind: "num", ...o });

export const SHEETS: SheetDef[] = [
  { id: "param", title: "Parámetros", table: studyParameters, keyCols: [], idCol: "studyId", entity: "parameters", fields: [
    N("workDaysPerWeek", "Días laborales por semana", { notNull: true, max: 7 }),
    { key: "weeksPerYear", label: "Semanas por año", kind: "int", notNull: true, max: 53 }, { key: "reservePct", label: "Reserva de capacidad (%)", kind: "pct", notNull: true },
    { key: "overloadThreshold", label: "Umbral de sobrecarga (%)", kind: "pct", notNull: true }, { key: "lowLoadThreshold", label: "Umbral de carga baja (%)", kind: "pct", notNull: true },
    N("hourlyCostCop", "Costo por hora (COP)", { max: 1e9 }), L("scenario", "Escenario", "L_Escenario", { notNull: true }),
    { ...B("assumptionsValidated", "Supuestos validados por el responsable"), notNull: true },
    { key: "weightImpact", label: "Peso: impacto", kind: "int", notNull: true, max: 10 }, { key: "weightEase", label: "Peso: facilidad", kind: "int", notNull: true, max: 10 },
    { key: "weightEffort", label: "Peso: esfuerzo", kind: "int", notNull: true, max: 10 }, { key: "weightCost", label: "Peso: costo", kind: "int", notNull: true, max: 10 },
    { key: "weightRisk", label: "Peso: riesgo", kind: "int", notNull: true, max: 10 },
    { key: "devEstimatePct", label: "Desviación: diferencia estimado vs medido (%)", kind: "pct", notNull: true }, { key: "devMinMeasurements", label: "Desviación: mínimo de mediciones", kind: "int", notNull: true, max: 100 },
    { key: "devJumpPct", label: "Desviación: salto de horas entre fotos (%)", kind: "pct", notNull: true }, { key: "devMinHistory", label: "Desviación: mínimo de fotos de historia", kind: "int", notNull: true, max: 100 },
  ] },
];
export const sheetById = (id: string | undefined) => SHEETS.find((s) => s.id === id);

export const optionsOf = (list: keyof typeof LABELS) => Object.entries(LABELS[list].map).map(([label, code]) => ({ code: code as string, label }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Número sin signo: dígitos con, a lo sumo, un separador decimal (coma o punto). */
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** Convierte lo recibido del formulario en los valores de la tabla. Texto no numérico es un error, nunca 0. Devuelve los errores por campo. */
export function parseForm(def: SheetDef, raw: Record<string, FormDataEntryValue>): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of def.fields) {
    const s = String(raw[f.key] ?? "").trim();
    if (s === "") {
      if (f.required) errors.push(`${f.label}: es obligatorio`);
      else if (!f.notNull) values[f.key] = null; // los campos NOT NULL vacíos conservan su valor/predeterminado
      continue;
    }
    switch (f.kind) {
      case "text": case "longtext":
        { const max = f.max ?? (f.kind === "longtext" ? LONG_TEXT_MAX : 4000); if (s.length > max) errors.push(`${f.label}: máximo ${max} caracteres`); else values[f.key] = s; break; }
      case "bool":
        if (s !== "yes" && s !== "no") errors.push(`${f.label}: elija Sí o No`); else values[f.key] = s === "yes"; break;
      case "scale": case "int": {
        const n = DECIMAL.test(s) ? Number(s.replace(",", ".")) : Number.NaN; // formato estricto: dígitos con un solo separador decimal
        const [lo, hi] = f.kind === "scale" ? [1, 5] : [0, f.max ?? 1e6];
        if (!Number.isInteger(n) || n < lo || n > hi) errors.push(`${f.label}: escriba un entero entre ${lo} y ${hi}`); else values[f.key] = n;
        break;
      }
      case "num": case "pct": {
        const body = f.kind === "pct" ? s.replace(/\s*%$/, "") : s; // un «%» solo se admite al final
        const n = DECIMAL.test(body) ? Number(body.replace(",", ".")) : Number.NaN;
        const v = f.kind === "pct" ? n / 100 : n;
        const hi = f.kind === "pct" ? 1 : f.max ?? 1e12;
        if (!Number.isFinite(n) || v < 0 || v > hi) errors.push(`${f.label}: escriba un número ${f.kind === "pct" ? "entre 0 y 100" : `entre 0 y ${hi}`}`);
        else values[f.key] = f.kind === "pct" ? v.toFixed(4) : String(n);
        break;
      }
      case "date":
        if (!DATE.test(s) || Number.isNaN(Date.parse(s))) errors.push(`${f.label}: fecha inválida`); else values[f.key] = s; break;
      case "list":
        if (!optionsOf(f.list!).some((o) => o.code === s)) errors.push(`${f.label}: valor fuera de la lista`); else values[f.key] = s; break;
      case "activity": case "area":
        if (!UUID.test(s)) errors.push(`${f.label}: elija un valor de la lista`); else values[f.key] = s; break;
    }
  }
  return { values, errors };
}

/** Valores de una fila de la base como texto para precargar el formulario. */
export function toFormValue(f: Field, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.kind === "bool") return v ? "yes" : "no";
  if (f.kind === "pct") return String(Math.round(Number(v) * 10000) / 100);
  return String(v);
}

type Row = Record<string, unknown> & { id?: string; studyId: string; version: number };
const cols = (t: PgTable) => getTableColumns(t) as Record<string, Parameters<typeof eq>[0]>;

export async function listRows(db: Db, sub: string, studyId: string, def: SheetDef): Promise<Row[]> {
  const c = cols(def.table);
  return withRls(db, { sub }, async (tx) => (await tx.select().from(def.table).where(eq(c.studyId, studyId))) as Row[]);
}

export type SaveResult = "created" | "updated" | "conflict" | "exists";

/**
 * Inserta o actualiza por la clave natural de la hoja. Si la fila ya existe se exige la versión que el usuario vio
 * (control de concurrencia optimista); si cambió, devuelve "conflict" (HTTP 409 equivalente).
 */
export async function saveRow(db: Db, sub: string, studyId: string, def: SheetDef, values: Record<string, unknown>, seenVersion: number | null): Promise<SaveResult> {
  const c = cols(def.table);
  return withRls(db, { sub }, async (tx) => {
    const keyMatch = def.keyCols.map((k) => eq(c[k], values[k] as never));
    const [found] = (await tx.select().from(def.table).where(and(eq(c.studyId, studyId), ...keyMatch))) as Row[];
    let result: SaveResult;
    let entityId: string | null = null;
    if (!found) {
      if (def.idCol === "studyId") throw new Error("Estudio sin parámetros");
      const inserted = (await tx.insert(def.table).values({ ...values, studyId } as never).returning({ id: c.id } as never)) as { id: string }[];
      entityId = inserted[0]?.id ?? null; result = "created";
    } else {
      if (seenVersion === null) return "exists";
      const idMatch = eq(c[def.idCol], found[def.idCol] as never);
      const upd = (await tx.update(def.table).set(values as never).where(and(idMatch, eq(c.version, seenVersion))).returning({ v: c.version } as never)) as unknown[];
      if (upd.length !== 1) return "conflict";
      entityId = found.id ?? null; result = "updated";
    }
    const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => !found || String(found[k] ?? "") !== String(v ?? "")).map(([k, v]) => [k, { from: found ? found[k] ?? null : null, to: v }]));
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: result === "created" ? "insert" : "update", entity: def.entity, entityId, diff });
    return result;
  });
}

export async function deleteRow(db: Db, sub: string, studyId: string, def: SheetDef, id: string): Promise<boolean> {
  if (def.idCol !== "id") return false;
  const c = cols(def.table);
  return withRls(db, { sub }, async (tx) => {
    const gone = (await tx.delete(def.table).where(and(eq(c.studyId, studyId), eq(c.id, id))).returning({ id: c.id } as never)) as unknown[];
    if (gone.length === 1) await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "delete", entity: def.entity, entityId: id, diff: null });
    return gone.length === 1;
  });
}
