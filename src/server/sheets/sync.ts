/**
 * Sincronización bidireccional con Google Sheets (brief §12). La app manda (D-13): la hoja es una vista de captura.
 * - hoja → app: un evento de Apps Script o la reconciliación leen las filas afectadas, las normalizan con las reglas del importador
 *   y las aplican CON CONTROL DE VERSIÓN. Si la app tiene una versión más nueva, hay conflicto: no se sobrescribe y la hoja recibe el valor vigente.
 * - app → hoja: se escribe en RAW (nunca como fórmula) y solo en las columnas de entrada; las fórmulas de la hoja no se tocan.
 * Todo corre con withRls() como el usuario que creó la conexión; la base sigue aplicando sus permisos.
 */
import { randomUUID } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../../db/client";
import { auditLog, sheetConnections, syncEvents, validationIssues } from "../../db/schema";
import type { SheetChangeEvent } from "../../domain/contracts";
import { looksLikeFormula } from "../../domain/cellguard";
import { colToIndex, indexToCol, INTERNAL_HEADERS } from "../../domain/sheetmap";
import { key, Report } from "../import/normalize";
import { readRowFrom } from "../import/parse";
import { ADAPTERS, adapterFor, cellsOf, lastInputCol, sameValue, type Adapter, type Ctx, type Rec } from "./adapters";
import { googleGateway, type CellValue, type SheetGateway } from "./gateway";

export interface Conn { id: string; studyId: string; actorId: string; spreadsheetId: string; mode: string }
export type Result = "created" | "updated" | "linked" | "unchanged" | "conflict" | "rejected" | "skipped";
export interface RowOutcome { row: number; code: string; result: Result; message?: string; rec?: Rec; appCells?: Record<string, string | number> }

const q = (sheet: string) => `'${sheet}'`;
const MAX_ROWS = 2000;

/* ───────── Conexiones ───────── */
export async function lookupConnection(db: Db, spreadsheetId: string): Promise<Conn | null> {
  const r = await db.execute(sql`select id, study_id, actor_id, mode from public.sheet_connection_lookup(${spreadsheetId})`);
  const x = (r as unknown as { id: string; study_id: string; actor_id: string; mode: string }[])[0];
  return x ? { id: x.id, studyId: x.study_id, actorId: x.actor_id, spreadsheetId, mode: x.mode } : null;
}
export async function activeConnections(db: Db): Promise<Conn[]> {
  const r = await db.execute(sql`select id, study_id, actor_id, spreadsheet_id, mode from public.sheet_connections_active()`);
  return (r as unknown as { id: string; study_id: string; actor_id: string; spreadsheet_id: string; mode: string }[]).map((x) => ({ id: x.id, studyId: x.study_id, actorId: x.actor_id, spreadsheetId: x.spreadsheet_id, mode: x.mode }));
}
export async function listConnections(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) => tx.select().from(sheetConnections).where(eq(sheetConnections.studyId, studyId)));
}
export async function connectSheet(db: Db, sub: string, studyId: string, spreadsheetId: string, mode: "push" | "pull" | "bidirectional" | "off") {
  return withRls(db, { sub }, async (tx) => {
    const [c] = await tx.insert(sheetConnections).values({ studyId, spreadsheetId, actorId: sub, mode })
      .onConflictDoUpdate({ target: [sheetConnections.studyId, sheetConnections.spreadsheetId], set: { mode, actorId: sub } }).returning({ id: sheetConnections.id });
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "update", entity: "sheet_connection", entityId: c.id, diff: { mode: { from: null, to: mode } } });
    return c.id;
  });
}
export async function recentEvents(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) => tx.select().from(syncEvents).where(eq(syncEvents.studyId, studyId)).orderBy(sql`${syncEvents.createdAt} desc`).limit(15));
}
export async function openIssues(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) => tx.select().from(validationIssues).where(and(eq(validationIssues.studyId, studyId), eq(validationIssues.status, "open"))).limit(100));
}

/* ───────── Columnas internas (id y versión de cada fila) ───────── */
export async function findInternal(gw: SheetGateway, a: Adapter): Promise<{ idCol: string; verCol: string } | null> {
  const s = a.sheet, n = await gw.columnCount(s.sheetName);
  const header = ((await gw.read(`${q(s.sheetName)}!A${s.headerRow}:${indexToCol(n)}${s.headerRow}`))[0] ?? []) as unknown[];
  const [i, v] = [header.indexOf(INTERNAL_HEADERS.id), header.indexOf(INTERNAL_HEADERS.version)];
  return i >= 0 && v >= 0 ? { idCol: indexToCol(i + 1), verCol: indexToCol(v + 1) } : null;
}
export async function ensureInternal(gw: SheetGateway, a: Adapter): Promise<{ idCol: string; verCol: string }> {
  const found = await findInternal(gw, a);
  if (found) return found;
  const s = a.sheet, n = await gw.columnCount(s.sheetName);
  await gw.appendHiddenColumns(s.sheetName, 2);
  const [idCol, verCol] = [indexToCol(n + 1), indexToCol(n + 2)];
  await gw.write([{ range: `${q(s.sheetName)}!${idCol}${s.headerRow}:${verCol}${s.headerRow}`, values: [[INTERNAL_HEADERS.id, INTERNAL_HEADERS.version]] }]);
  return { idCol, verCol };
}

/* ───────── Hoja → app ───────── */
const safeMessage = (e: unknown): string => {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42501") return "Sin permiso para modificar este estudio";
  if (code === "23514") return "Un valor está fuera del rango permitido";
  if (code === "23505") return "Ya existe un registro con ese código";
  if (code === "23503") return "La referencia indicada no existe";
  return "No se pudo guardar la fila";
};

const asText = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

async function applyOne(c: Ctx, a: Adapter, it: { code: string; row: ReturnType<typeof readRowFrom>; linkId: string | null; linkVer: number | null }, actor: string): Promise<RowOutcome> {
  const { code, row, linkId, linkVer } = it;
  const T = a.table as never;
  const k = getTableColumns(a.table) as Record<string, Parameters<typeof eq>[0]>;
  const hasCode = "code" in k;
  let existing = await a.find(c, code);
  if (!existing && linkId) {
    const [byId] = (await c.tx.select().from(T).where(and(eq(k.studyId, c.studyId), eq(k.id, linkId)))) as Rec[];
    if (byId && hasCode) existing = byId; // código renombrado en la hoja: el id conserva el vínculo
    else if (!byId) return { row: c.rowNo, code, result: "conflict", message: "El registro fue eliminado en la aplicación; la hoja no lo recrea" };
  }
  const built = await a.build(c, row, existing);
  if ("error" in built) return { row: c.rowNo, code, result: "rejected", message: built.error };
  let values: Record<string, unknown> = hasCode ? { ...built.values, code } : built.values;
  if (existing) {
    // Una celda que no se pudo interpretar (p. ej. «abc» en un número) NO borra el valor guardado: se conserva y queda el hallazgo.
    const bad = new Set(c.rep.issues.filter((i) => i.severity !== "info" && i.row === c.rowNo).map((i) => i.field));
    const badDb = new Set(Object.entries(a.map).filter(([, [f]]) => bad.has(f)).map(([db]) => db));
    values = Object.fromEntries(Object.entries(values).filter(([f]) => !badDb.has(f)));
  }

  const audit = (action: string, entityId: string, diff: Record<string, { from: unknown; to: unknown }>) =>
    c.tx.insert(auditLog).values({ studyId: c.studyId, actorId: actor, origin: "sheet", action, entity: a.entity, entityId, diff });

  if (!existing) {
    const [rec] = (await c.tx.insert(T).values({ studyId: c.studyId, ...values } as never).returning()) as Rec[];
    await audit("insert", rec.id, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== "").map(([f, v]) => [f, { from: null, to: v }])));
    return { row: c.rowNo, code, result: "created", rec };
  }

  const changed = Object.entries(values).filter(([f, v]) => !sameValue(existing![f], v));
  if (!linkId) {
    // Fila sin vincular que ya existe en la app: si es idéntica se vincula; si difiere NO se sobrescribe nada (la app manda).
    return changed.length === 0
      ? { row: c.rowNo, code, result: "linked", rec: existing }
      : { row: c.rowNo, code, result: "conflict", rec: existing, message: `Fila sin vincular que difiere de la app en ${changed.length} campo(s); no se aplicó (la app manda)` };
  }
  if (linkId !== existing.id) return { row: c.rowNo, code, result: "conflict", rec: existing, message: "El vínculo de la fila apunta a otro registro" };
  if (linkVer !== existing.version) return { row: c.rowNo, code, result: "conflict", rec: existing, message: `La app tiene una versión más nueva (${existing.version}) que la de la hoja (${linkVer ?? "—"}); se restituye el valor vigente` };
  if (changed.length === 0) return { row: c.rowNo, code, result: "unchanged", rec: existing };
  const upd = (await c.tx.update(T).set(Object.fromEntries(changed) as never).where(and(eq(k.id, existing.id), eq(k.version, existing.version))).returning()) as Rec[];
  if (upd.length !== 1) return { row: c.rowNo, code, result: "conflict", rec: existing, message: "Otra persona modificó el registro mientras se aplicaba el cambio" };
  await audit("update", existing.id, Object.fromEntries(changed.map(([f, v]) => [f, { from: existing![f] ?? null, to: v }])));
  return { row: c.rowNo, code, result: "updated", rec: upd[0] };
}

/** Lee las filas indicadas de la hoja, las normaliza y las aplica a la app. Devuelve un resultado por fila (nada se oculta). */
class DryRun extends Error {}

export async function applyRows(db: Db, conn: Conn, gw: SheetGateway, a: Adapter, rowNums: number[], dryRun = false): Promise<RowOutcome[]> {
  const s = a.sheet;
  const rows = [...new Set(rowNums)].filter((r) => r >= s.firstDataRow && r < MAX_ROWS).sort((x, y) => x - y);
  if (!rows.length) return [];
  // En vista previa no se modifica la hoja: si aún no tiene columnas internas, ninguna fila está vinculada.
  const internal = dryRun ? await findInternal(gw, a) : await ensureInternal(gw, a);
  const [lo, hi] = [rows[0], rows[rows.length - 1]];
  const inputs = await gw.read(`${q(s.sheetName)}!A${lo}:${indexToCol(lastInputCol(a))}${hi}`);
  const links = internal ? await gw.read(`${q(s.sheetName)}!${internal.idCol}${lo}:${internal.verCol}${hi}`) : [];

  const items: { code: string; row: ReturnType<typeof readRowFrom>; rep: Report; linkId: string | null; linkVer: number | null; rowNo: number }[] = [];
  const outcomes: RowOutcome[] = [];
  for (const r of rows) {
    const cells = (inputs[r - lo] ?? []) as unknown[];
    if (cells.every((v) => v === null || v === undefined || v === "")) continue;
    const rep = new Report();
    const row = readRowFrom((col) => cells[colToIndex(col) - 1] ?? null, s.sheetName, r, a.spec, rep);
    const code = row.s("code");
    if (!code) { outcomes.push({ row: r, code: "", result: "rejected", message: "Fila con datos pero sin código; no se puede identificar y no se aplicó" }); continue; }
    const link = (links[r - lo] ?? []) as unknown[];
    const ver = Number(link[1]);
    items.push({ code, row, rep, linkId: asText(link[0]), linkVer: Number.isFinite(ver) && link[1] !== "" ? ver : null, rowNo: r });
  }

  // Detecta códigos repetidos dentro del lote: no se fusiona ni se borra nada (se rechazan las repeticiones).
  const seen = new Set<string>();
  const unique = items.filter((it) => {
    const kk = key(it.code);
    if (seen.has(kk)) { outcomes.push({ row: it.rowNo, code: it.code, result: "rejected", message: "Código repetido en la hoja: no se fusiona ni se borra; esta fila no se aplicó" }); return false; }
    seen.add(kk); return true;
  });

  try { await withRls(db, { sub: conn.actorId }, async (tx) => {
    for (const it of unique) {
      const c: Ctx = { tx, studyId: conn.studyId, rep: it.rep, sheet: s.sheetName, rowNo: it.rowNo };
      try { outcomes.push(await tx.transaction((sp) => applyOne({ ...c, tx: sp as unknown as Tx }, a, it, conn.actorId))); }
      catch (e) { outcomes.push({ row: it.rowNo, code: it.code, result: "rejected", message: safeMessage(e) }); }
    }
    // Valores vigentes de la app para las filas en conflicto (se restituyen en la hoja).
    if (outcomes.some((o) => o.result === "conflict")) {
      const all = new Map((await a.all(tx, conn.studyId)).map((x) => [key(x.code), x]));
      for (const o of outcomes) if (o.result === "conflict") { const hit = all.get(key(o.code)); if (hit) { o.rec = hit.rec; o.appCells = cellsOf(a, hit.rec, hit.extras); } }
    }
    // Hallazgos del autocorrector y del validador: se regeneran por fila (sin duplicar los de lecturas anteriores).
    await tx.delete(validationIssues).where(and(eq(validationIssues.studyId, conn.studyId), eq(validationIssues.status, "open"), sql`${validationIssues.suggestedValue}->>'sheet' = ${s.sheetName}`, sql`(${validationIssues.suggestedValue}->>'row')::int in (${sql.join(rows.map((r) => sql`${r}`), sql`, `)})`));
    const issues = [
      ...items.flatMap((it) => it.rep.issues.map((i) => ({ i, entityId: outcomes.find((o) => o.row === it.rowNo)?.rec?.id ?? null }))),
      ...outcomes.filter((o) => o.result === "rejected" || o.result === "conflict").map((o) => ({ i: { sheet: s.sheetName, row: o.row, field: "fila", rule: o.result === "conflict" ? "VERSION_CONFLICT" : "ROW_REJECTED", severity: "warning" as const, message: o.message ?? "" }, entityId: o.rec?.id ?? null })),
    ];
    if (issues.length) await tx.insert(validationIssues).values(issues.map(({ i, entityId }) => ({
      studyId: conn.studyId, entity: a.entity, entityId, field: i.field || null, ruleCode: i.rule, severity: i.severity, autoFixable: i.rule === "LABEL_AUTOFIXED",
      suggestedValue: { message: i.message, sheet: i.sheet, row: i.row }, status: i.rule === "LABEL_AUTOFIXED" ? "auto_fixed" : "open",
    })));
    if (dryRun) throw new DryRun();
  }); } catch (e) { if (!(e instanceof DryRun)) throw e; }
  return outcomes.sort((x, y) => x.row - y.row);
}

/** Escribe en la hoja el id y la versión de las filas aplicadas, y restituye el valor vigente en las filas en conflicto. */
export async function writeBack(gw: SheetGateway, a: Adapter, outcomes: RowOutcome[]) {
  const internal = await ensureInternal(gw, a);
  const updates: { range: string; values: CellValue[][] }[] = [];
  for (const o of outcomes) {
    if (!o.rec || !["created", "updated", "linked", "conflict"].includes(o.result)) continue;
    if (o.result === "conflict" && !o.appCells) continue;
    updates.push({ range: `${q(a.sheet.sheetName)}!${internal.idCol}${o.row}:${internal.verCol}${o.row}`, values: [[o.rec.id, o.rec.version]] });
    if (o.result === "conflict" && o.appCells) for (const [col, v] of Object.entries(o.appCells)) updates.push({ range: `${q(a.sheet.sheetName)}!${col}${o.row}`, values: [[v]] });
  }
  await gw.write(updates);
}

export type EventStatus = "unknown_sheet" | "duplicate" | "ignored" | "processed" | "error";
export interface EventResult { status: EventStatus; outcomes?: RowOutcome[]; message?: string }

async function logEvent(db: Db, conn: Conn, ev: SheetChangeEvent): Promise<string | null> {
  return withRls(db, { sub: conn.actorId }, async (tx) => {
    const [ins] = await tx.insert(syncEvents).values({ studyId: conn.studyId, connectionId: conn.id, direction: "sheet_to_app", originId: ev.eventId, sheetName: ev.sheetName, rowRef: `${ev.range.row}+${ev.range.rows}`, payload: { kind: ev.kind, range: ev.range, editedAt: ev.editedAt }, status: "received" })
      .onConflictDoNothing({ target: [syncEvents.connectionId, syncEvents.originId] }).returning({ id: syncEvents.id });
    return ins?.id ?? null;
  });
}
/** Evento firmado de Apps Script (ya verificado por la ruta). Idempotente por eventId. */
export async function handleEvent(db: Db, ev: SheetChangeEvent, gw: SheetGateway = googleGateway(ev.spreadsheetId)): Promise<EventResult> {
  const conn = await lookupConnection(db, ev.spreadsheetId);
  if (!conn) return { status: "unknown_sheet" };
  const a = adapterFor(ev.sheetName);
  let logId: string | null;
  try { logId = await logEvent(db, conn, ev); }
  catch { return { status: "error", message: "La conexión no tiene permiso para escribir en el estudio (revise el rol de quien la creó)" }; }
  if (!logId) return { status: "duplicate" };
  const id = logId;
  const finish = (status: string, error: string | null, extra?: Record<string, unknown>) => withRls(db, { sub: conn.actorId }, (tx) => tx.update(syncEvents)
    .set({ status, error, processedAt: new Date(), ...(extra ? { payload: sql`${syncEvents.payload} || ${JSON.stringify(extra)}::jsonb` } : {}) }).where(eq(syncEvents.id, id)));

  if (!a) { await finish("ignored", "Hoja no sincronizada"); return { status: "ignored", message: "Hoja no sincronizada" }; }
  if (conn.mode === "push") { await finish("ignored", "La conexión es solo app → hoja"); return { status: "ignored", message: "La conexión es solo app → hoja" }; }
  if (ev.kind === "change") { await finish("processed", "Cambio de estructura: la reconciliación refrescará los datos"); return { status: "processed", outcomes: [] }; }
  try {
    const rowNums = Array.from({ length: ev.range.rows }, (_, i) => ev.range.row + i);
    const outcomes = await applyRows(db, conn, gw, a, rowNums);
    await writeBack(gw, a, outcomes);
    const bad = outcomes.filter((o) => o.result === "rejected").length;
    const conflictRows = outcomes.filter((o) => o.result === "conflict").map((o) => o.row);
    await finish("processed", bad ? `${bad} fila(s) rechazada(s); ver hallazgos` : null, conflictRows.length ? { conflictRows } : undefined); // las filas en conflicto alimentan la regla R8 (conflictos recurrentes)
    return { status: "processed", outcomes };
  } catch (e) {
    await finish("error", "Error al procesar el evento");
    return { status: "error", message: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

/* ───────── App → hoja ───────── */
export interface PushStats { sheet: string; appended: number; refreshed: number; unlinked: number; unchanged: number; formulaLike: number }

export async function pushAll(db: Db, conn: Conn, gw: SheetGateway, dryRun = false): Promise<PushStats[]> {
  const stats: PushStats[] = [];
  for (const a of ADAPTERS) {
    const s = a.sheet, internal = dryRun ? (await findInternal(gw, a)) ?? { idCol: "", verCol: "" } : await ensureInternal(gw, a);
    const app = await withRls(db, { sub: conn.actorId }, (tx) => a.all(tx, conn.studyId));
    const keys = await gw.read(`${q(s.sheetName)}!${s.keyColumn}${s.firstDataRow}:${s.keyColumn}${MAX_ROWS}`);
    const links = keys.length && internal.idCol ? await gw.read(`${q(s.sheetName)}!${internal.idCol}${s.firstDataRow}:${internal.verCol}${s.firstDataRow + keys.length - 1}`) : [];
    const rowOf = new Map<string, number>();
    keys.forEach((k, i) => { const c = asText((k as unknown[])[0]); if (c) rowOf.set(key(c), s.firstDataRow + i); });
    const st: PushStats = { sheet: s.sheetName, appended: 0, refreshed: 0, unlinked: 0, unchanged: 0, formulaLike: 0 };
    const updates: { range: string; values: CellValue[][] }[] = [];
    let next = s.firstDataRow + keys.length;
    const write = (row: number, rec: Rec, extras: Record<string, unknown>) => {
      for (const [col, v] of Object.entries(cellsOf(a, rec, extras))) {
        if (typeof v === "string" && looksLikeFormula(v)) st.formulaLike++; // se escribe como texto (RAW) y se cuenta
        updates.push({ range: `${q(s.sheetName)}!${col}${row}`, values: [[v]] });
      }
      updates.push({ range: `${q(s.sheetName)}!${internal.idCol}${row}:${internal.verCol}${row}`, values: [[rec.id, rec.version]] });
    };
    for (const it of app) {
      const row = rowOf.get(key(it.code));
      if (row === undefined) { write(next++, it.rec, it.extras); st.appended++; continue; }
      const link = (links[row - s.firstDataRow] ?? []) as unknown[];
      if (!asText(link[0])) { st.unlinked++; continue; } // sin vincular: la reconciliación decide (vincula si es idéntica, avisa si difiere)
      if (Number(link[1]) < it.rec.version) { write(row, it.rec, it.extras); st.refreshed++; } else st.unchanged++;
    }
    if (!dryRun) await gw.write(updates);
    stats.push(st);
  }
  return stats;
}

/* ───────── Reconciliación (lectura periódica) ───────── */
export interface ReconcileStats { sheet: string; counts: Record<Result, number> }

export async function reconcile(db: Db, conn: Conn, gw: SheetGateway, dryRun = false): Promise<ReconcileStats[]> {
  const out: ReconcileStats[] = [];
  for (const a of ADAPTERS) {
    const s = a.sheet;
    const keys = await gw.read(`${q(s.sheetName)}!${s.keyColumn}${s.firstDataRow}:${s.keyColumn}${MAX_ROWS}`);
    const rowNums = keys.flatMap((k, i) => (asText((k as unknown[])[0]) ? [s.firstDataRow + i] : []));
    const counts: Record<Result, number> = { created: 0, updated: 0, linked: 0, unchanged: 0, conflict: 0, rejected: 0, skipped: 0 };
    for (let i = 0; i < rowNums.length; i += 200) {
      const outcomes = await applyRows(db, conn, gw, a, rowNums.slice(i, i + 200), dryRun);
      if (!dryRun) await writeBack(gw, a, outcomes);
      for (const o of outcomes) counts[o.result]++;
    }
    out.push({ sheet: s.sheetName, counts });
  }
  return out;
}

/** Vista previa: lee la hoja y la app y cuenta qué pasaría, sin escribir nada en ninguna de las dos (todo se revierte). */
export async function previewSync(db: Db, conn: Conn, gw: SheetGateway = googleGateway(conn.spreadsheetId)) {
  return { pull: await reconcile(db, conn, gw, true), push: await pushAll(db, conn, gw, true) };
}

/** Ciclo completo según el modo de la conexión: primero hoja → app (reconcile), luego app → hoja (push). Registra el resultado. */
export async function syncNow(db: Db, conn: Conn, gw: SheetGateway = googleGateway(conn.spreadsheetId)) {
  const pull = conn.mode === "pull" || conn.mode === "bidirectional" ? await reconcile(db, conn, gw) : [];
  const push = conn.mode === "push" || conn.mode === "bidirectional" ? await pushAll(db, conn, gw) : [];
  await withRls(db, { sub: conn.actorId }, async (tx) => {
    await tx.update(sheetConnections).set({ lastSyncAt: new Date(), status: "idle" }).where(eq(sheetConnections.id, conn.id));
    await tx.insert(syncEvents).values({ studyId: conn.studyId, connectionId: conn.id, direction: "app_to_sheet", originId: randomUUID(), sheetName: "*", payload: { pull, push }, status: "processed", processedAt: new Date() });
  });
  return { pull, push };
}
