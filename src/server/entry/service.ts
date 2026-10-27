/**
 * Servicio de captura desde la app (D-62): guarda, edita y borra registros de las hojas 2, 3, 5, 6, 7, 8, 9 y 10 con las MISMAS reglas de normalización y
 * validación que la importación (un solo camino de datos), con control de versión, auditoría con origen «app» y espejo hacia Google Sheets.
 * Los valores de las columnas con fórmula del libro se calculan aquí con las reglas del libro y se devuelven como SOLO LECTURA.
 */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { after } from "next/server";
import { withRls, type Db, type Tx } from "../../db/client";
import { areas as areaTable, auditLog, studyParameters, syncEvents } from "../../db/schema";
import { SUGGESTED_INDICATORS, computeMeasurability, computeOpportunity, computePlan, computeRedesign, computeRisk, computeSuitability, labelOf } from "../../domain/calculators";
import { norm } from "../../domain/engine";
import { LABELS } from "../../domain/labels";
import { analyze, type Analysis } from "../../domain/summary";
import { Report } from "../import/normalize";
import { readRowFrom } from "../import/parse";
import { adapterById, cellsOf, type Ctx, type Rec } from "../sheets/adapters";
import { googleGateway } from "../sheets/gateway";
import { pushSheet, mirrorParameters } from "../sheets/mirror";
import { listConnections } from "../sheets/sync";
import { todayBogota } from "../dashboard-data";
import { loadStudyDataTx } from "../studies";
import { entryDef, type EntryDef, type EntryId } from "./defs";

type Cells = Record<string, string | number | null>;
export type ComputedValue = string | number | null;
export interface EntryRow { id: string; version: number; positionId?: string; cells: Cells; computed: Record<string, ComputedValue> }

/* ───────── Contexto para los valores calculados ───────── */
interface Context {
  prm: typeof studyParameters.$inferSelect; analysis: Analysis; thresholds: { high: number; low: number }; today: string;
  activities: Map<string, { rec: Rec; extras: Record<string, unknown> }>;     // por código en minúsculas
  entries: { rec: Rec; extras: Record<string, unknown> }[];                    // hoja 2, en el orden de la lista
}
async function loadContext(tx: Tx, studyId: string): Promise<Context> {
  const d = await loadStudyDataTx(tx, studyId);
  const [prm] = await tx.select().from(studyParameters).where(eq(studyParameters.studyId, studyId));
  const acts = await adapterById("3")!.all(tx, studyId);
  const entries = await adapterById("2")!.all(tx, studyId);
  return { prm, analysis: analyze(d.staff, d.acts, d.params, d.thresholds, "all"), thresholds: d.thresholds, today: todayBogota(), activities: new Map(acts.map((x) => [x.code.trim().toLowerCase(), { rec: x.rec, extras: x.extras }])), entries: entries.map((x) => ({ rec: x.rec, extras: x.extras })) };
}

const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const tri = (v: unknown) => (v === "yes" || v === "partial" || v === "no" ? v : null);
const lvl = (v: unknown) => (v === "high" || v === "medium" || v === "low" ? v : null);
const kindLabel = (k: unknown) => labelOf("L_TipoDato", String(k)) ?? "";

/** Columnas con fórmula del libro, calculadas con sus mismas reglas. */
function computedFor(def: EntryDef, rec: Rec, extras: Record<string, unknown>, ctx: Context): Record<string, ComputedValue> {
  const out: Record<string, ComputedValue> = {};
  const act = ctx.activities.get(String(extras.code ?? "").trim().toLowerCase());
  const lookup = () => { // columnas A, C, D, E y F de las hojas 5, 6 y 7: datos de la actividad
    out.A = act ? kindLabel(act.extras.kind) : ""; out.C = act ? String(act.extras.area ?? "") : ""; out.D = act ? String(act.extras.position ?? "") : "";
    out.E = act ? String(act.rec.name ?? "") : ""; out.F = act ? labelOf("L_TipoAct", String(act.rec.activityType)) ?? "" : "";
  };
  const r = rec as Record<string, unknown>;
  switch (def.id) {
    case "2": {
      const key = `${extras.area}|${extras.site}|${extras.position}|${kindLabel(extras.kind)}`;
      const firstIdx = ctx.entries.findIndex((e) => `${e.extras.area}|${e.extras.site}|${e.extras.position}|${kindLabel(e.extras.kind)}` === key);
      const myIdx = ctx.entries.findIndex((e) => e.rec.id === rec.id);
      const sameCargo = (x: { extras: Record<string, unknown> }) => norm(String(x.extras.area)) === norm(String(extras.area)) && norm(String(x.extras.site)) === norm(String(extras.site)) && norm(String(x.extras.position)) === norm(String(extras.position)) && x.extras.kind === extras.kind;
      const acts = [...ctx.activities.values()].filter(sameCargo);
      const h = num(r.headcount), w = num(r.weeklyHours);
      out.P = key; out.Q = firstIdx === myIdx ? 1 : 0; out.R = h !== null && w !== null ? h * w * (1 - Number(ctx.prm.reservePct)) : "";
      out.S = r.employeeCode ? ctx.entries.slice(0, myIdx + 1).filter((e) => (e.rec as Record<string, unknown>).employeeCode).length : "";
      out.T = acts.length; out.U = acts.filter((x) => x.rec.formallyDocumented === "no" || x.rec.formallyDocumented === "partial").length;
      out.V = !extras.area || !extras.site ? "Falta área o sede" : h === null ? "Falta cantidad de colaboradores" : w === null ? "Falta jornada semanal" : "OK";
      break;
    }
    case "3": out.C = ctx.analysis.activities.find((x) => norm(x.code) === norm(String(r.code)))?.status ?? ""; break;
    case "5": {
      lookup();
      const m = computeMeasurability({ direct: tri(r.directMeasurement), hasIndicators: r.hasIndicators as boolean | null, hasHistory: tri(r.hasHistory), hasTimeStandard: r.hasTimeStandard as boolean | null, reliability: lvl(r.sourceReliability), external: lvl(r.externalDependency), verifiable: tri(r.resultVerifiable), proposedIndicator: (r.proposedIndicator as string | null) ?? null, qualitativeCriterion: (r.qualitativeCriterion as string | null) ?? null });
      out.Q = m.score ?? ""; out.R = m.level; out.S = act ? SUGGESTED_INDICATORS[String(act.rec.activityType)] ?? "" : ""; out.T = m.recommendation;
      break;
    }
    case "6": {
      lookup();
      const s = computeSuitability({ gaps: (r.gaps as string | null) ?? null, trainingPossible: tri(r.trainingPossible), reassignmentPossible: (r.reassignmentPossible as "yes" | "conditional" | "no" | null) ?? null, specializationNeeded: r.specializationNeeded as boolean | null, situation: (r.situation as string | null) ?? null, sensitiveResponsibility: r.sensitiveResponsibility as boolean | null, separationEvaluated: r.separationEvaluated as boolean | null });
      out.W = s.alert; out.X = s.reading;
      break;
    }
    case "7": {
      lookup();
      const k = computeRisk({ impOperational: num(r.impactOperational), impEconomic: num(r.impactEconomic), impLabor: num(r.impactLabor), impLegal: num(r.impactLegal), impService: num(r.impactService), probability: num(r.probability), peopleWhoCanExecute: num(r.peopleWhoCanExecute) });
      out.T = k.maxImpact ?? ""; out.U = k.criticality; out.V = k.concentration; out.W = k.backup;
      break;
    }
    case "8": {
      const o = computeOpportunity({ findingClass: (r.findingClass as string | null) ?? null, evidence: (r.evidence as string | null) ?? null, hoursPerWeek: num(r.recoverableHoursPerWeek), impact: num(r.impactScore), ease: num(r.easeScore), effort: num(r.effortScore), cost: num(r.costScore), risk: num(r.riskScore) },
        { weeksPerYear: ctx.prm.weeksPerYear, hourlyCost: num(ctx.prm.hourlyCostCop), wImpact: ctx.prm.weightImpact, wEase: ctx.prm.weightEase, wEffort: ctx.prm.weightEffort, wCost: ctx.prm.weightCost, wRisk: ctx.prm.weightRisk });
      out.N = o.annualImpact ?? ""; out.Z = o.score ?? ""; out.AA = o.priority; out.AB = o.implementation ?? ""; out.AC = o.control;
      break;
    }
    case "9": {
      const ps = ctx.analysis.positions.filter((p) => norm(p.area) === norm(String(extras.area)) && p.dataKind === r.dataKind && norm(p.position) === norm(String(r.currentPositionName)));
      const load = ps.reduce((a, p) => a + p.hours, 0), cap = ps.reduce((a, p) => a + p.capacity, 0);
      const x = computeRedesign({ currentLoad: load, capacity: cap, hoursOut: num(r.hoursOutPerWeek), hoursIn: num(r.hoursInPerWeek), hoursRecovered: num(r.hoursRecoveredPerWeek), receivingPosition: (r.receivingPositionName as string | null) ?? null }, ctx.thresholds.high);
      out.Q = load; out.R = cap; out.S = x.currentPct ?? ""; out.W = x.proposedLoad; out.X = x.proposedPct ?? ""; out.Y = x.alert;
      break;
    }
    case "10": {
      const p = computePlan({ start: (r.startDate as string | null) ?? null, end: (r.endDate as string | null) ?? null, target: num(r.target), actual: num(r.actualResult), status: (r.status as string | null) ?? null }, ctx.today);
      out.S = p.durationDays ?? ""; out.T = p.difference ?? ""; out.U = p.compliancePct ?? ""; out.V = p.deadlineAlert;
      break;
    }
  }
  return out;
}

/** Texto de una columna para la tabla y el formulario: etiquetas en español, fechas como AAAA-MM-DD, porcentajes como «12 %». */
const serialToIso = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
export function inputValue(def: EntryDef, field: string, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const f = def.fields.find((x) => x.field === field);
  if (f?.control === "date" && typeof v === "number") return serialToIso(v);
  if (f?.control === "percent" && typeof v === "number") return `${Math.round(v * 10000) / 100} %`;
  return String(v);
}

export async function listEntries(db: Db, sub: string, studyId: string, id: EntryId): Promise<{ def: EntryDef; rows: EntryRow[] } | null> {
  const def = entryDef(id); if (!def) return null;
  return withRls(db, { sub }, async (tx) => {
    const ctx = await loadContext(tx, studyId);
    const items = await def.adapter.all(tx, studyId);
    return { def, rows: items.map((it) => ({ id: it.rec.id, version: it.rec.version, positionId: (it.rec as { positionId?: string }).positionId, cells: cellsOf(def.adapter, it.rec, it.extras), computed: computedFor(def, it.rec, it.extras, ctx) })) };
  });
}

export async function getEntry(db: Db, sub: string, studyId: string, id: EntryId, recId: string): Promise<{ def: EntryDef; row: EntryRow } | null> {
  const r = await listEntries(db, sub, studyId, id);
  const row = r?.rows.find((x) => x.id === recId);
  return r && row ? { def: r.def, row } : null;
}

/** Opciones de las listas que dependen del estudio: áreas, sedes, cargos y códigos de actividad. */
export async function entryOptions(db: Db, sub: string, studyId: string): Promise<{ areas: string[]; sites: string[]; positions: string[]; activities: { code: string; name: string }[] }> {
  return withRls(db, { sub }, async (tx) => {
    const ar = await adapterById("2")!.all(tx, studyId), ac = await adapterById("3")!.all(tx, studyId);
    const areaRows = await tx.select({ name: areaTable.name }).from(areaTable).where(eq(areaTable.studyId, studyId)).orderBy(areaTable.sortOrder);
    const uniq = (xs: unknown[]) => [...new Set(xs.filter((x): x is string => typeof x === "string" && x !== ""))].sort((a, b) => a.localeCompare(b, "es"));
    return {
      areas: areaRows.map((a) => a.name), sites: uniq([...ar.map((x) => x.extras.site), ...ac.map((x) => x.extras.site)]),
      positions: uniq([...ar.map((x) => x.extras.position), ...ac.map((x) => x.extras.position)]), activities: ac.map((x) => ({ code: x.code, name: String(x.rec.name ?? "") })),
    };
  });
}

/* ───────── Guardar ───────── */
export type SaveResult =
  | { ok: true; recId: string; result: "created" | "updated" | "unchanged"; notices: string[] }
  | { ok: false; errors: string[]; conflict?: boolean };

const friendly = (m: string) => m.replace(/;?\s*(el valor )?no se importó\.?$/i, "").replace(/;\s*queda NULL$/i, "");
/** Un porcentaje sin «%» se interpreta como porcentaje (12 → 12 %), no como fracción. */
function prepare(def: EntryDef, raw: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of def.fields) {
    const s = (raw[f.col] ?? "").trim();
    out[f.col] = s === "" ? null : f.control === "percent" && /^\d+(?:[.,]\d+)?$/.test(s) ? `${s}%` : s;
  }
  return out;
}

/** Valida lo capturado con las mismas reglas del libro, sin tocar la base de datos. */
export function validateRaw(def: EntryDef, raw: Record<string, string>): { ok: true; row: ReturnType<typeof readRowFrom> } | { ok: false; errors: string[] } {
  const a = def.adapter, cells = prepare(def, raw), rep = new Report();
  const row = readRowFrom((col) => cells[col] ?? null, def.sheetName, 7, a.spec, rep);
  const header = (field: string) => def.fields.find((f) => f.field === field)?.header ?? field;
  const errors = rep.issues.filter((i) => i.severity !== "info").map((i) => `${header(i.field)}: ${friendly(i.message)}`);
  for (const f of def.fields.filter((x) => x.required)) if (cells[f.col] === null) errors.push(`${f.header}: es obligatorio`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, row };
}

export async function saveEntry(db: Db, sub: string, studyId: string, id: EntryId, raw: Record<string, string>, ref: { recId?: string; version?: number }): Promise<SaveResult> {
  const def = entryDef(id); if (!def) return { ok: false, errors: ["Hoja desconocida"] };
  const v = validateRaw(def, raw);
  if (!v.ok) return v;
  return withRls(db, { sub }, (tx) => persistEntry(tx, sub, studyId, def, v.row, ref));
}

/** Guarda un registro ya validado dentro de una transacción abierta. Con matchExisting, si la clave ya existe se actualiza ese registro (carga masiva). */
export async function persistEntry(tx: Tx, sub: string, studyId: string, def: EntryDef, row: ReturnType<typeof readRowFrom>, ref: { recId?: string; version?: number; matchExisting?: boolean }): Promise<SaveResult> {
  const a = def.adapter;
  const table = a.table as PgTable, k = getTableColumns(table) as Record<string, Parameters<typeof eq>[0]>;
  const hasCode = "code" in k;
  {
    const c: Ctx = { tx, studyId, rep: new Report(), sheet: def.sheetName, rowNo: 0 };
    let existing: Rec | null = null;
    if (ref.recId) {
      existing = ((await tx.select().from(table).where(and(eq(k.studyId, studyId), eq(k.id, ref.recId)))) as Rec[])[0] ?? null;
      if (!existing) return { ok: false, errors: ["El registro ya no existe (otra persona lo eliminó)."], conflict: true };
      if (existing.version !== ref.version) return { ok: false, errors: ["Conflicto (409): otra persona modificó este registro. Vuelva a abrirlo y repita el cambio."], conflict: true };
    } else {
      const dup = a.findRow ? await a.findRow(c, row) : await a.find(c, row.s("code") ?? "");
      if (dup && ref.matchExisting) existing = dup; // carga masiva: la clave ya existe y se actualiza ese registro
      else if (dup) return { ok: false, errors: ["Ya existe un registro con esa clave: ábralo desde la lista y edítelo."] };
    }
    const built = await a.build(c, row, existing);
    if ("error" in built) return { ok: false, errors: [built.error] };
    // Desde el formulario una fecha de fin anterior a la de inicio es un error que la persona corrige (la importación, en cambio, las deja vacías y lo reporta).
    if (c.rep.issues.some((i) => i.rule === "DATE_ORDER")) return { ok: false, errors: ["Fecha de fin: no puede ser anterior a la fecha de inicio."] };
    const values: Record<string, unknown> = hasCode ? { ...built.values, code: row.s("code") } : built.values;
    const notices = c.rep.issues.map((i) => friendly(i.message));
    const audit = (action: string, entityId: string, diff: Record<string, { from: unknown; to: unknown }>) => tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action, entity: a.entity, entityId, diff });
    if (!existing) {
      const [rec] = (await tx.insert(table).values({ studyId, ...values } as never).returning()) as Rec[];
      await audit("insert", rec.id, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== "").map(([f, v]) => [f, { from: null, to: v }])));
      return { ok: true, recId: rec.id, result: "created", notices };
    }
    const prev = existing as Record<string, unknown>;
    const same = (x: unknown, y: unknown) => (x === null || x === undefined || x === "") && (y === null || y === undefined || y === "") || (x !== null && y !== null && String(x).trim() === String(y).trim()) || (Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && x !== "" && y !== "" && Number(x) === Number(y));
    const changed = Object.entries(values).filter(([f, v]) => !same(prev[f], v));
    if (!changed.length) return { ok: true, recId: existing.id, result: "unchanged", notices };
    const upd = (await tx.update(table).set(Object.fromEntries(changed) as never).where(and(eq(k.id, existing.id), eq(k.version, existing.version))).returning()) as Rec[];
    if (upd.length !== 1) return { ok: false, errors: ["Conflicto (409): otra persona modificó este registro mientras se guardaba."], conflict: true };
    await audit("update", existing.id, Object.fromEntries(changed.map(([f, v]) => [f, { from: prev[f] ?? null, to: v }])));
    return { ok: true, recId: existing.id, result: "updated", notices };
  }
}

export async function deleteEntry(db: Db, sub: string, studyId: string, id: EntryId, recId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = entryDef(id); if (!def) return { ok: false, error: "Hoja desconocida" };
  const table = def.adapter.table as PgTable, k = getTableColumns(table) as Record<string, Parameters<typeof eq>[0]>;
  try {
    return await withRls(db, { sub }, async (tx) => {
      const gone = (await tx.delete(table).where(and(eq(k.studyId, studyId), eq(k.id, recId))).returning({ id: k.id } as never)) as unknown[];
      if (!gone.length) return { ok: false as const, error: "No se pudo eliminar (permiso o el registro ya no existe)." };
      await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "delete", entity: def.adapter.entity, entityId: recId, diff: null });
      return { ok: true as const };
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    return { ok: false, error: code === "23503" ? "No se puede eliminar: otros registros dependen de este (por ejemplo, oportunidades que lo citan). Elimine o cambie primero esas referencias." : code === "42501" ? "No tiene permiso para modificar este estudio." : "No se pudo eliminar." };
  }
}

/* ───────── Espejo hacia Google tras cada cambio ───────── */
/**
 * Escribe en la hoja de Google lo que acaba de cambiar en la app. Se ejecuta DESPUÉS de responder a la persona (`after`), así que no la hace esperar;
 * si Google falla, queda un evento con error en Integraciones y «Sincronizar ahora» (o la tarea diaria) lo corrige.
 */
export async function mirrorAfterChange(db: Db, sub: string, studyId: string, what: EntryId | "params"): Promise<void> {
  const conn = (await listConnections(db, sub, studyId)).find((c) => c.mode === "push" || c.mode === "bidirectional");
  if (!conn) return;
  const c = { id: conn.id, studyId: conn.studyId, actorId: conn.actorId, spreadsheetId: conn.spreadsheetId, mode: conn.mode };
  let error: string | null = null;
  try {
    const gw = googleGateway(conn.spreadsheetId);
    if (what === "params") await mirrorParameters(db, c, gw); else await pushSheet(db, c, gw, entryDef(what)!.adapter);
  } catch { error = "No se pudo escribir en la hoja de Google; use «Sincronizar ahora»"; }
  await withRls(db, { sub }, (tx) => tx.insert(syncEvents).values({ studyId, connectionId: conn.id, direction: "app_to_sheet", originId: crypto.randomUUID(), sheetName: what === "params" ? "Parametros" : entryDef(what)!.sheetName, payload: { origen: "guardado en la app" }, status: error ? "error" : "processed", error, processedAt: new Date() })).catch(() => undefined);
}

/** Programa el espejo para después de la respuesta (en servidor) sin esperar a Google. */
export function scheduleMirror(db: Db, sub: string, studyId: string, what: EntryId | "params"): void {
  after(() => mirrorAfterChange(db, sub, studyId, what));
}
void LABELS;
