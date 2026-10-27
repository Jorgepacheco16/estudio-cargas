/**
 * Adaptadores por hoja: cómo se busca, se construye, se crea y se actualiza el registro de una fila de Google Sheets, y cómo se
 * vuelve a escribir en celdas. Reutilizan el mapeo declarativo del importador (rowmaps) en los dos sentidos. Todo corre dentro
 * de una transacción con RLS abierta por quien llama.
 */
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../../db/client";
import {
  actionItems, activities, areas, improvementOpportunities, measurabilityAssessments, positions, redesignProposals, riskAssessments, sites, staffingEntries, suitabilityAssessments,
} from "../../db/schema";
import { indexToCol, type SyncTarget, type SyncedSheet, SYNCED_SHEETS } from "../../domain/sheetmap";
import { labelOf } from "../../domain/calculators";
import { LABELS } from "../../domain/labels";
import { key, type Report } from "../import/normalize";
import {
  ACTIVITY_MAP, MEAS_MAP, OPP_MAP, PLAN_MAP, REDESIGN_MAP, RISK_MAP, STAFF_MAP, SUIT_MAP, activityFields, forward, measFields, oppFields, planFields, riskFields, suitFields, type FieldMap,
} from "../import/rowmaps";
import { ACTIVITY, MEAS, OPP, PLAN, REDESIGN, RISK, STAFF, SUIT, SHEETS, type Row, type Spec } from "../import/parse";

export type Rec = Record<string, unknown> & { id: string; version: number };
export interface Ctx { tx: Tx; studyId: string; rep: Report; sheet: string; rowNo: number }
export type Built = { values: Record<string, unknown> } | { error: string };

export interface Adapter {
  sheet: SyncedSheet; spec: Spec; map: FieldMap; entity: string; table: PgTable;
  /** Registro existente para el código de la fila (null si no existe). */
  find(c: Ctx, code: string): Promise<Rec | null>;
  /** Registro existente según la clave natural de la fila completa (hojas sin código: 9 usa tipo + área + cargo). Si falta, se usa el código. */
  findRow?(c: Ctx, r: Row): Promise<Rec | null>;
  /** Valores a guardar, resolviendo referencias; si falta algo imprescindible devuelve un error legible. */
  build(c: Ctx, r: Row, existing: Rec | null): Promise<Built>;
  /** Todos los registros del estudio con las columnas auxiliares (nombres de área, cargo, etc.) para escribirlos en la hoja. */
  all(tx: Tx, studyId: string): Promise<{ code: string; rec: Rec; extras: Record<string, unknown> }[]>;
}

const cols = (t: PgTable) => getTableColumns(t) as Record<string, Parameters<typeof eq>[0]>;
const norm = (c: Parameters<typeof eq>[0]) => sql`lower(btrim(${c}))`;

async function byCode(c: Ctx, table: PgTable, code: string): Promise<Rec | null> {
  const k = cols(table);
  const [row] = await c.tx.select().from(table).where(and(eq(k.studyId, c.studyId), sql`${norm(k.code)} = lower(btrim(${code}))`));
  return (row as Rec | undefined) ?? null;
}

/** Texto de la hoja → nombre de tipo de dato; sin valor se asume REAL y se informa (igual que el importador). */
function kindOf(c: Ctx, r: Row): "real" | "demo" {
  const k = r.s("kind");
  if (!k) { c.rep.add({ sheet: c.sheet, row: c.rowNo, field: "kind" }, "MISSING_KIND", "info", "Sin 'Tipo de dato'; se asumió REAL"); return "real"; }
  return k as "real" | "demo";
}

/** Busca el cargo por (tipo, área, sede, nombre). El área debe existir (la hoja no crea listas); sede y cargo faltantes se crean como el importador (D-08). */
async function resolvePosition(c: Ctx, kind: "real" | "demo", area: string, site: string, name: string): Promise<{ id: string } | { error: string }> {
  const [a] = await c.tx.select({ id: areas.id }).from(areas).where(and(eq(areas.studyId, c.studyId), sql`${norm(areas.name)} = lower(btrim(${area}))`));
  if (!a) return { error: `El área '${area.slice(0, 50)}' no está en la lista del estudio; no se crean áreas desde la hoja` };
  await c.tx.insert(sites).values({ studyId: c.studyId, name: site }).onConflictDoNothing();
  const [s] = await c.tx.select({ id: sites.id }).from(sites).where(and(eq(sites.studyId, c.studyId), sql`${norm(sites.name)} = lower(btrim(${site}))`));
  const [p] = await c.tx.select({ id: positions.id }).from(positions).where(and(eq(positions.studyId, c.studyId), eq(positions.areaId, a.id), eq(positions.siteId, s.id), eq(positions.dataKind, kind), sql`${norm(positions.name)} = lower(btrim(${name}))`));
  if (p) return p;
  const [ins] = await c.tx.insert(positions).values({ studyId: c.studyId, areaId: a.id, siteId: s.id, name, dataKind: kind, autoCreated: true }).returning({ id: positions.id });
  c.rep.add({ sheet: c.sheet, row: c.rowNo, field: "position" }, "POSITION_AUTO_CREATED", "warning", `El cargo '${name.slice(0, 60)}' no existía; se creó sin dotación (D-08). Falta registrar cantidad y jornada`);
  return ins;
}

/**
 * Cargo secundario de una actividad: la hoja solo trae su NOMBRE, no su área. Si ese cargo ya existe en el estudio (con ese nombre y tipo) se usa, de
 * preferencia el de la misma sede, sin importar el área; solo si no existe se crea, bajo el área y la sede de la actividad.
 */
async function resolveSecondary(c: Ctx, kind: "real" | "demo", area: string, site: string, name: string): Promise<{ id: string } | { error: string }> {
  const rows = await c.tx.select({ id: positions.id, siteName: sites.name }).from(positions).innerJoin(sites, eq(sites.id, positions.siteId))
    .where(and(eq(positions.studyId, c.studyId), eq(positions.dataKind, kind), sql`${norm(positions.name)} = lower(btrim(${name}))`));
  if (rows.length) return { id: (rows.find((r) => norm0(r.siteName) === norm0(site)) ?? rows[0]).id };
  return resolvePosition(c, kind, area, site, name);
}
const norm0 = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const areaIdOf = async (c: Ctx, name: string | null): Promise<string | null> => {
  if (!name) return null;
  const [a] = await c.tx.select({ id: areas.id }).from(areas).where(and(eq(areas.studyId, c.studyId), sql`${norm(areas.name)} = lower(btrim(${name}))`));
  if (!a) c.rep.add({ sheet: c.sheet, row: c.rowNo, field: "area" }, "NOT_IN_LIST", "warning", `Área '${name.slice(0, 50)}' no registrada; el vínculo quedó vacío`);
  return a?.id ?? null;
};
const activityIdOf = async (c: Ctx, code: string): Promise<string | null> => {
  const a = await byCode(c, activities, code);
  return a?.id ?? null;
};

const SHEET = (t: SyncTarget) => SYNCED_SHEETS.find((s) => s.target === t)!;

/* ───────── Hoja 3 · Actividades ───────── */
const activitiesAdapter: Adapter = {
  sheet: SHEET("activities"), spec: ACTIVITY, map: ACTIVITY_MAP, entity: "activity", table: activities,
  find: (c, code) => byCode(c, activities, code),
  async build(c, r, existing) {
    const [area, site, pos, name] = [r.s("area"), r.s("site"), r.s("position"), r.s("name")];
    if (!name) return { error: "La actividad no tiene nombre; no se inventa uno" };
    const kind = kindOf(c, r);
    let positionId = existing ? String(existing.positionId) : "";
    let secondaryPositionId: string | null = existing ? ((existing.secondaryPositionId as string | null) ?? null) : null;
    if (area && site && pos) {
      const p = await resolvePosition(c, kind, area, site, pos);
      if ("error" in p) return p;
      positionId = p.id;
      const sec = r.s("secondaryPosition");
      secondaryPositionId = null;
      if (sec) { const q = await resolveSecondary(c, kind, area, site, sec); if ("error" in q) return q; secondaryPositionId = q.id; }
    } else if (!existing) return { error: `Falta ${[!area && "área", !site && "centro de operaciones", !pos && "cargo"].filter(Boolean).join(", ")}; sin cargo no se puede guardar la actividad` };
    return { values: { dataKind: kind, positionId, secondaryPositionId, ...activityFields(r) } };
  },
  async all(tx, studyId) {
    const rows = await tx.select().from(activities).where(eq(activities.studyId, studyId)).orderBy(activities.code);
    const pos = await tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name }).from(positions)
      .innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(eq(positions.studyId, studyId));
    const byId = new Map(pos.map((p) => [p.id, p]));
    return rows.map((a) => {
      const p = byId.get(a.positionId);
      return { code: a.code, rec: a as unknown as Rec, extras: { kind: a.dataKind, code: a.code, area: p?.area ?? null, site: p?.site ?? null, position: p?.name ?? null, secondaryPosition: a.secondaryPositionId ? byId.get(a.secondaryPositionId)?.name ?? null : null } };
    });
  },
};

/* ───────── Hojas 5, 6 y 7 · una evaluación por actividad ───────── */
function assessment(target: SyncTarget, table: PgTable, spec: Spec, map: FieldMap, fields: (r: Row) => Record<string, unknown>, entity: string): Adapter {
  const k = cols(table);
  const load = async (c: Ctx, activityId: string) => ((await c.tx.select().from(table).where(and(eq(k.studyId, c.studyId), eq(k.activityId, activityId))))[0] as Rec | undefined) ?? null;
  return {
    sheet: SHEET(target), spec, map, entity, table,
    async find(c, code) { const id = await activityIdOf(c, code); return id ? load(c, id) : null; },
    async build(c, r, existing) {
      const code = r.s("code")!;
      const activityId = existing ? String(existing.activityId) : await activityIdOf(c, code);
      if (!activityId) return { error: `La actividad '${code.slice(0, 30)}' no existe en la hoja 3 (referencia huérfana)` };
      return { values: { activityId, ...fields(r) } };
    },
    async all(tx, studyId) {
      const acts = new Map((await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.studyId, studyId))).map((a) => [a.id, a.code]));
      const rows = (await tx.select().from(table).where(eq(k.studyId, studyId))) as Rec[];
      return rows.flatMap((rec) => { const code = acts.get(String(rec.activityId)); return code ? [{ code, rec, extras: { code } }] : []; }).sort((a, b) => a.code.localeCompare(b.code));
    },
  };
}

/* ───────── Hoja 8 · Oportunidades ───────── */
const opportunitiesAdapter: Adapter = {
  sheet: SHEET("8"), spec: OPP, map: OPP_MAP, entity: "opportunity", table: improvementOpportunities,
  find: (c, code) => byCode(c, improvementOpportunities, code),
  async build(c, r) {
    const act = r.s("activityCode");
    const relatedActivityId = act ? await activityIdOf(c, act) : null;
    if (act && !relatedActivityId) c.rep.add({ sheet: c.sheet, row: c.rowNo, field: "activityCode" }, "ORPHAN_REFERENCE", "warning", `La actividad relacionada '${act.slice(0, 30)}' no existe; el vínculo quedó vacío`);
    return { values: { dataKind: kindOf(c, r), relatedActivityId, areaId: await areaIdOf(c, r.s("area")), ...oppFields(r) } };
  },
  async all(tx, studyId) {
    const acts = new Map((await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.studyId, studyId))).map((a) => [a.id, a.code]));
    const ars = new Map((await tx.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.studyId, studyId))).map((a) => [a.id, a.name]));
    const sts = new Map((await tx.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.studyId, studyId))).map((s) => [s.id, s.name])); // D-75: centro de operaciones
    const rows = await tx.select().from(improvementOpportunities).where(eq(improvementOpportunities.studyId, studyId)).orderBy(improvementOpportunities.code);
    return rows.map((o) => ({ code: o.code, rec: o as unknown as Rec, extras: { kind: o.dataKind, code: o.code, activityCode: o.relatedActivityId ? acts.get(o.relatedActivityId) ?? null : null, area: o.areaId ? ars.get(o.areaId) ?? null : null, site: o.siteId ? sts.get(o.siteId) ?? null : null } }));
  },
};

/* ───────── Hoja 10 · Plan de acción ───────── */
const planAdapter: Adapter = {
  sheet: SHEET("10"), spec: PLAN, map: PLAN_MAP, entity: "action", table: actionItems,
  find: (c, code) => byCode(c, actionItems, code),
  async build(c, r) {
    if (!r.s("action")) return { error: "La acción no tiene descripción; no se inventa" };
    let [start, end] = [r.s("start"), r.s("end")];
    if (start && end && end < start) { c.rep.add({ sheet: c.sheet, row: c.rowNo, field: "end" }, "DATE_ORDER", "warning", "La fecha de fin es anterior a la de inicio; ambas fechas quedaron vacías"); start = null; end = null; }
    return { values: { dataKind: kindOf(c, r), areaId: await areaIdOf(c, r.s("area")), startDate: start, endDate: end, ...planFields(r) } };
  },
  async all(tx, studyId) {
    const ars = new Map((await tx.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.studyId, studyId))).map((a) => [a.id, a.name]));
    const sts = new Map((await tx.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.studyId, studyId))).map((s) => [s.id, s.name])); // D-75: centro de operaciones
    const rows = await tx.select().from(actionItems).where(eq(actionItems.studyId, studyId)).orderBy(actionItems.code);
    return rows.map((p) => ({ code: p.code, rec: p as unknown as Rec, extras: { kind: p.dataKind, code: p.code, area: p.areaId ? ars.get(p.areaId) ?? null : null, site: p.siteId ? sts.get(p.siteId) ?? null : null, start: p.startDate, end: p.endDate } }));
  },
};

/* ───────── Hoja 2 · Caracterización (una fila = una entrada de dotación) ───────── */
const staffAdapter: Adapter = {
  sheet: SHEET("2"), spec: STAFF, map: STAFF_MAP, entity: "staffing", table: staffingEntries,
  find: async () => null, // sin código: cada captura es una entrada nueva; se edita por identificador
  async build(c, r) {
    const [area, site, name] = [r.s("area"), r.s("site"), r.s("position")];
    if (!area || !site || !name) return { error: `Falta ${[!area && "el área", !site && "la sede", !name && "el cargo"].filter(Boolean).join(", ")}` };
    const kind = kindOf(c, r);
    const [a] = await c.tx.select({ id: areas.id }).from(areas).where(and(eq(areas.studyId, c.studyId), sql`${norm(areas.name)} = lower(btrim(${area}))`));
    if (!a) return { error: `El área «${area.slice(0, 50)}» no está en la lista del estudio (agréguela en Parámetros)` };
    await c.tx.insert(sites).values({ studyId: c.studyId, name: site }).onConflictDoNothing();
    const [s] = await c.tx.select({ id: sites.id }).from(sites).where(and(eq(sites.studyId, c.studyId), sql`${norm(sites.name)} = lower(btrim(${site}))`));
    if (r.s("regional")) await c.tx.update(sites).set({ regional: r.s("regional") }).where(eq(sites.id, s.id));
    const [p] = await c.tx.select({ id: positions.id }).from(positions).where(and(eq(positions.studyId, c.studyId), eq(positions.areaId, a.id), eq(positions.siteId, s.id), eq(positions.dataKind, kind), sql`${norm(positions.name)} = lower(btrim(${name}))`));
    const texts = { boss: r.s("boss"), objective: r.s("objective"), formalFunctions: r.s("functions"), autoCreated: false };
    const positionId = p ? (await c.tx.update(positions).set(texts).where(eq(positions.id, p.id)).returning({ id: positions.id }))[0].id : (await c.tx.insert(positions).values({ studyId: c.studyId, areaId: a.id, siteId: s.id, name, dataKind: kind, ...texts }).returning({ id: positions.id }))[0].id;
    return { values: { positionId, ...forward(STAFF_MAP, r) } };
  },
  async all(tx, studyId) {
    const rows = await tx.select({ e: staffingEntries, kind: positions.dataKind, name: positions.name, boss: positions.boss, objective: positions.objective, functions: positions.formalFunctions, area: areas.name, site: sites.name, regional: sites.regional })
      .from(staffingEntries).innerJoin(positions, eq(positions.id, staffingEntries.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(eq(staffingEntries.studyId, studyId)).orderBy(areas.name, sites.name, positions.name, staffingEntries.createdAt);
    return rows.map((x) => ({ code: x.e.id, rec: x.e as unknown as Rec, extras: { kind: x.kind, area: x.area, site: x.site, regional: x.regional, position: x.name, boss: x.boss, objective: x.objective, functions: x.functions } }));
  },
};

/* ───────── Hoja 9 · Rediseño de cargo (clave: tipo de dato + área + cargo actual) ───────── */
const redesignAdapter: Adapter = {
  sheet: SHEET("9"), spec: REDESIGN, map: REDESIGN_MAP, entity: "redesign", table: redesignProposals,
  find: async () => null,
  async findRow(c, r) {
    const [area, pos] = [r.s("area"), r.s("position")];
    if (!area || !pos) return null;
    const [a] = await c.tx.select({ id: areas.id }).from(areas).where(and(eq(areas.studyId, c.studyId), sql`${norm(areas.name)} = lower(btrim(${area}))`));
    if (!a) return null;
    const [x] = await c.tx.select().from(redesignProposals).where(and(eq(redesignProposals.studyId, c.studyId), eq(redesignProposals.dataKind, kindOf(c, r)), eq(redesignProposals.areaId, a.id), sql`${norm(redesignProposals.currentPositionName)} = lower(btrim(${pos}))`));
    return (x as Rec | undefined) ?? null;
  },
  async build(c, r) {
    const [area, pos] = [r.s("area"), r.s("position")];
    if (!area || !pos) return { error: `Falta ${[!area && "el área", !pos && "el cargo actual"].filter(Boolean).join(" y ")}` };
    const areaId = await areaIdOf(c, area);
    if (!areaId) return { error: `El área «${area.slice(0, 50)}» no está en la lista del estudio` };
    const v = forward(REDESIGN_MAP, r);
    if (!v.approvalStatus) delete v.approvalStatus; // columna NOT NULL con valor por defecto: en blanco no se envía
    return { values: { dataKind: kindOf(c, r), areaId, currentPositionName: pos, ...v } };
  },
  async all(tx, studyId) {
    const ars = new Map((await tx.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.studyId, studyId))).map((a) => [a.id, a.name]));
    const sts = new Map((await tx.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.studyId, studyId))).map((s) => [s.id, s.name])); // D-75: centro de operaciones
    const rows = await tx.select().from(redesignProposals).where(eq(redesignProposals.studyId, studyId)).orderBy(redesignProposals.createdAt);
    return rows.map((x) => ({ code: x.id, rec: x as unknown as Rec, extras: { kind: x.dataKind, area: ars.get(x.areaId) ?? null, position: x.currentPositionName, site: x.siteId ? sts.get(x.siteId) ?? null : null } }));
  },
};

/** Hojas que la app espeja hacia Google (todas las de captura), en el orden del libro. */
export const MIRROR_ADAPTERS: Adapter[] = [];

export const ADAPTERS: Adapter[] = [
  activitiesAdapter,
  assessment("5", measurabilityAssessments, MEAS, MEAS_MAP, measFields, "measurability"),
  assessment("6", suitabilityAssessments, SUIT, SUIT_MAP, suitFields, "suitability"),
  assessment("7", riskAssessments, RISK, RISK_MAP, riskFields, "risk"),
  opportunitiesAdapter, planAdapter,
];
export const adapterFor = (sheetName: string) => ADAPTERS.find((a) => a.sheet.sheetName === sheetName);
MIRROR_ADAPTERS.push(staffAdapter, ...ADAPTERS.filter((a) => a.sheet.target === "activities" || ["5", "6", "7", "8"].includes(a.sheet.target)), redesignAdapter, ...ADAPTERS.filter((a) => a.sheet.target === "10"));
/** Adaptador por identificador de hoja de captura («2», «3», «5»…«10»). */
export const adapterById = (id: string) => MIRROR_ADAPTERS.find((a) => (id === "3" ? a.sheet.target === "activities" : a.sheet.target === id));

/** Última columna de entrada de la hoja (para leer de A hasta ahí). */
export const lastInputCol = (a: Adapter) => Math.max(...Object.values(a.spec).map(([col]) => col.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)));

/* ───────── Celdas ↔ valores ───────── */
type Kind = Spec[string][1];
const serial = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000 + 25569);

/** Valor de la base → valor de celda (RAW). Códigos de lista → etiqueta en español; fechas → número de serie; Sí/No como texto. */
export function toCell(kind: Kind, v: unknown): string | number {
  if (v === null || v === undefined || v === "") return "";
  if (kind === "text") return String(v);
  if (kind === "bool") return v ? "Sí" : "No";
  if (kind === "date") return serial(String(v));
  if (typeof kind === "object" && "label" in kind) return labelOf(kind.label as keyof typeof LABELS, String(v)) ?? "";
  return Number(v);
}

/** Registro (más sus auxiliares) → celdas {letra de columna: valor} de todas las columnas de entrada de la hoja. */
export function cellsOf(a: Adapter, rec: Record<string, unknown>, extras: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const fieldToDb = new Map(Object.entries(a.map).map(([db, [f]]) => [f, db]));
  for (const [field, [col, kind]] of Object.entries(a.spec)) {
    const db = fieldToDb.get(field);
    const v = db !== undefined ? rec[db] : extras[field];
    out[col] = toCell(kind, v);
  }
  return out;
}

/** ¿El valor de la fila de la hoja equivale al guardado? Texto sin espacios sobrantes; números por valor (2.5 = "2.50"). */
export function sameValue(a: unknown, b: unknown): boolean {
  const e = (x: unknown) => x === null || x === undefined || x === "";
  if (e(a) || e(b)) return e(a) && e(b);
  const [na, nb] = [Number(a), Number(b)];
  if (typeof a !== "boolean" && typeof b !== "boolean" && Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") return Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(nb));
  return key(String(a)) === key(String(b));
}

export const headerName = (a: Adapter) => a.sheet.sheetName;
export { SHEETS, indexToCol };
