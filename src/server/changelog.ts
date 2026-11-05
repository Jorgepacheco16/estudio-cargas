/**
 * Registro de cambios (D-96): consulta de audit_log para la pestaña de Historia y para la exportación. Todo corre con withRls(): la base decide quién puede leer el registro
 * (Historia en Lectura o Usuarios, con todas las áreas). Es de SOLO CONSULTA: aquí no hay nada que escriba, y la base rechaza modificar o borrar filas.
 */
import { and, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { withRls, type Db } from "../db/client";
import { auditLog } from "../db/schema";
import { readFilters, type Filters } from "../domain/filters";
import { PAGE_SIZE, actionsMatchingWord, entitiesMatchingWord, entitiesOfKinds, entitiesOfSections, searchWords } from "../domain/changelog";

/** Quién hizo el cambio, tal como se muestra: nombre, o correo, o «Persona retirada» (ya sin acceso y sin nombre guardado) o «Sistema» (sin persona). */
export const actorLabel = (r: { actor: string | null; email: string | null; actorId: string | null }) => r.actor ?? r.email ?? (r.actorId ? "Persona retirada" : "Sistema");

export interface ChangeFilters { q?: string; tipo: string[]; seccion: string[]; usuario: string[]; area: string[]; cargo: string[]; accion: string[]; origen: string[]; desde?: string; hasta?: string }
export const emptyChangeFilters = (): ChangeFilters => ({ tipo: [], seccion: [], usuario: [], area: [], cargo: [], accion: [], origen: [] });

export interface ChangeRow {
  id: number; at: Date; actorId: string | null; actor: string | null; email: string | null; origin: string; action: string; entity: string;
  area: string | null; position: string | null; subject: string | null; diff: Record<string, { from: unknown; to: unknown }> | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["tipo", "seccion", "usuario", "area", "cargo", "accion", "origen"] as const;
const dayOf = (v: string | undefined) => (v && ISO_DAY.test(v) ? v : "");

/** Lee de la dirección los filtros del registro (los mismos para la pantalla y la descarga). Todo se valida y se limita en cantidad y largo. */
export function readChangeFilters(sp: Record<string, string | string[] | undefined>): { current: Filters; filters: ChangeFilters; desde: string; hasta: string } {
  const current = readFilters(sp, KEYS, true);
  const [desde, hasta] = [dayOf(Array.isArray(sp.desde) ? sp.desde[0] : sp.desde), dayOf(Array.isArray(sp.hasta) ? sp.hasta[0] : sp.hasta)];
  const filters: ChangeFilters = { ...emptyChangeFilters(), q: current.q?.[0], desde: desde || undefined, hasta: hasta || undefined };
  for (const k of KEYS) filters[k] = current[k] ?? [];
  return { current, filters, desde, hasta };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SYSTEM_USER = "sistema";
const NOTHING = sql`false`;

/** Las condiciones de los filtros. Los valores de la dirección se validan; nada se pega como texto en la consulta (todo va como parámetro). */
export function changeConditions(studyId: string, f: ChangeFilters): SQL {
  const parts: SQL[] = [eq(auditLog.studyId, studyId)];
  const list = (col: Parameters<typeof inArray>[0], vals: string[]) => (vals.length ? inArray(col, vals.slice(0, 200)) : undefined);
  const push = (c: SQL | undefined) => { if (c) parts.push(c); };
  if (f.tipo.length) { const e = entitiesOfKinds(f.tipo); push(e.length ? inArray(auditLog.entity, e) : NOTHING); }
  if (f.seccion.length) { const e = entitiesOfSections(f.seccion); push(e.length ? inArray(auditLog.entity, e) : NOTHING); }
  if (f.usuario.length) {
    const ids = f.usuario.filter((u) => UUID.test(u));
    const conds: SQL[] = [];
    if (ids.length) conds.push(inArray(sql`${auditLog.actorId}::text`, ids.map((x) => x.toLowerCase())));
    if (f.usuario.includes(SYSTEM_USER)) conds.push(sql`${auditLog.actorId} is null`);
    push(conds.length ? or(...conds) : NOTHING);
  }
  push(list(auditLog.areaName, f.area)); push(list(auditLog.positionName, f.cargo)); push(list(auditLog.action, f.accion)); push(list(auditLog.origin, f.origen));
  if (f.desde && ISO_DAY.test(f.desde)) parts.push(sql`(${auditLog.at} at time zone 'America/Bogota')::date >= ${f.desde}::date`);
  if (f.hasta && ISO_DAY.test(f.hasta)) parts.push(sql`(${auditLog.at} at time zone 'America/Bogota')::date <= ${f.hasta}::date`);
  // Palabra clave: cada palabra debe aparecer en alguna parte (persona, área, cargo, registro, detalle del cambio, sección o acción); no distingue tildes ni mayúsculas.
  const hay = sql`translate(lower(concat_ws(' ', ${auditLog.actorName}, ${auditLog.actorEmail}, ${auditLog.areaName}, ${auditLog.positionName}, ${auditLog.subject}, ${auditLog.diff}::text)), 'áéíóúüñ', 'aeiouun')`;
  for (const w of searchWords(f.q)) {
    const alts: SQL[] = [sql`${hay} like ${`%${w}%`} escape '\\'`];
    const ents = entitiesMatchingWord(w); if (ents.length) alts.push(inArray(auditLog.entity, ents));
    const acts = actionsMatchingWord(w); if (acts.length) alts.push(inArray(auditLog.action, acts));
    parts.push(or(...alts)!);
  }
  return and(...parts)!;
}

export interface ChangePage { rows: ChangeRow[]; total: number; all: number; page: number; pages: number }

const columns = {
  id: auditLog.id, at: auditLog.at, actorId: auditLog.actorId, actor: auditLog.actorName, email: auditLog.actorEmail, origin: auditLog.origin, action: auditLog.action, entity: auditLog.entity,
  area: auditLog.areaName, position: auditLog.positionName, subject: auditLog.subject, diff: auditLog.diff,
};

/** Una página de cambios (los más recientes primero) con el total que cumple los filtros y el total del estudio. */
export async function queryChanges(db: Db, sub: string, studyId: string, f: ChangeFilters, page: number, pageSize = PAGE_SIZE): Promise<ChangePage> {
  return withRls(db, { sub }, async (tx) => {
    const where = changeConditions(studyId, f);
    const [{ n: total }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where);
    const [{ n: all }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.studyId, studyId));
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const rows = await tx.select(columns).from(auditLog).where(where).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(pageSize).offset((at - 1) * pageSize);
    return { rows: rows as ChangeRow[], total, all, page: at, pages };
  });
}

/** Todo lo que cumple los filtros, hasta un tope, para descargarlo (los más recientes primero). */
export async function exportChangeRows(db: Db, sub: string, studyId: string, f: ChangeFilters, limit = 20000): Promise<{ rows: ChangeRow[]; truncated: boolean }> {
  return withRls(db, { sub }, async (tx) => {
    const rows = await tx.select(columns).from(auditLog).where(changeConditions(studyId, f)).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit + 1);
    return { rows: (rows as ChangeRow[]).slice(0, limit), truncated: rows.length > limit };
  });
}

export interface ChangeFacets { users: { value: string; label: string }[]; areas: string[]; positions: string[] }
/** Las personas, áreas y cargos que aparecen en el registro, para las listas de los filtros. */
export async function changeFacets(db: Db, sub: string, studyId: string): Promise<ChangeFacets> {
  return withRls(db, { sub }, async (tx) => {
    const people = await tx.select({ id: auditLog.actorId, name: sql<string | null>`max(${auditLog.actorName})`, email: sql<string | null>`max(${auditLog.actorEmail})` }).from(auditLog)
      .where(eq(auditLog.studyId, studyId)).groupBy(auditLog.actorId).limit(500);
    const areas = await tx.selectDistinct({ v: auditLog.areaName }).from(auditLog).where(and(eq(auditLog.studyId, studyId), isNotNull(auditLog.areaName))).orderBy(auditLog.areaName).limit(500);
    const positions = await tx.selectDistinct({ v: auditLog.positionName }).from(auditLog).where(and(eq(auditLog.studyId, studyId), isNotNull(auditLog.positionName))).orderBy(auditLog.positionName).limit(1000);
    const users = people.map((p) => ({ value: p.id ?? SYSTEM_USER, label: p.id === null ? "Sistema (sin persona)" : p.name && p.email ? `${p.name} (${p.email})` : p.name ?? p.email ?? "Persona retirada" }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
    return { users, areas: areas.map((a) => a.v!), positions: positions.map((p) => p.v!) };
  });
}
