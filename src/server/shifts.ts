/**
 * Turnos del cargo y turnos de cada actividad (D-67). Todo corre con withRls(); la escritura deja constancia en audit_log con origen «app».
 * Es información: nada de aquí entra en el cálculo de horas.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../db/client";
import { activities, activityShifts, areas, auditLog, positionShifts, positions, sites } from "../db/schema";
import { activityShiftsText, describeDays, describeShift, normTime, parseShift, reconcileSelection, type ShiftInput } from "../domain/shifts";

export interface ShiftRow { id: string; positionId: string; name: string; start: string | null; end: string | null; breakMin: number | null; days: number | null; usedBy: number }
export type ShiftResult = { ok: true; notices: string[]; changed?: boolean } | { ok: false; errors: string[] };

const hhmm = (t: string | null) => (t ? normTime(t) : null);
const audit = (tx: Tx, studyId: string, sub: string, action: string, entity: string, entityId: string, diff: Record<string, { from: unknown; to: unknown }> | null) =>
  tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action, entity, entityId, diff });

/** Turnos de un cargo, con cuántas actividades los usan (las de «Todos los turnos» no se cuentan: aplican a cualquiera). */
export async function listShifts(db: Db, sub: string, studyId: string, positionId: string): Promise<ShiftRow[]> {
  return withRls(db, { sub }, async (tx) => {
    const rows = await tx.select().from(positionShifts).where(and(eq(positionShifts.studyId, studyId), eq(positionShifts.positionId, positionId))).orderBy(asc(positionShifts.sortOrder), asc(positionShifts.name));
    const uses = rows.length ? await tx.select({ shiftId: activityShifts.shiftId, n: sql<number>`count(*)::int` }).from(activityShifts).where(and(eq(activityShifts.studyId, studyId), inArray(activityShifts.shiftId, rows.map((r) => r.id)))).groupBy(activityShifts.shiftId) : [];
    const n = new Map(uses.map((u) => [u.shiftId, u.n]));
    return rows.map((r) => ({ id: r.id, positionId: r.positionId, name: r.name, start: hhmm(r.startTime), end: hhmm(r.endTime), breakMin: r.breakMinutes, days: r.days, usedBy: n.get(r.id) ?? 0 }));
  });
}

/** Crea (sin shiftId) o edita un turno del cargo. */
export async function saveShift(db: Db, sub: string, studyId: string, positionId: string, shiftId: string | undefined, input: ShiftInput): Promise<ShiftResult> {
  const p = parseShift(input);
  if (!p.ok) return p;
  const v = p.values;
  return withRls(db, { sub }, async (tx) => {
    const [pos] = await tx.select({ id: positions.id }).from(positions).where(and(eq(positions.id, positionId), eq(positions.studyId, studyId)));
    if (!pos) return { ok: false as const, errors: ["El cargo ya no existe."] };
    const mine = await tx.select().from(positionShifts).where(and(eq(positionShifts.studyId, studyId), eq(positionShifts.positionId, positionId)));
    if (mine.some((s) => s.id !== shiftId && s.name.trim().toLowerCase() === v.name.toLowerCase())) return { ok: false as const, errors: [`Ya existe un turno llamado «${v.name}» en este cargo.`] };
    const row = { name: v.name, startTime: v.start, endTime: v.end, breakMinutes: v.breakMin, days: v.days };
    if (!shiftId) {
      const [ins] = await tx.insert(positionShifts).values({ studyId, positionId, ...row, sortOrder: Math.max(-1, ...mine.map((s) => s.sortOrder)) + 1 }).returning({ id: positionShifts.id });
      await audit(tx, studyId, sub, "insert", "position_shift", ins.id, { name: { from: null, to: v.name } });
      return { ok: true as const, notices: [`Turno «${v.name}» agregado.`] };
    }
    const cur = mine.find((s) => s.id === shiftId);
    if (!cur) return { ok: false as const, errors: ["El turno ya no existe (otra persona lo eliminó)."] };
    await tx.update(positionShifts).set(row).where(and(eq(positionShifts.id, shiftId), eq(positionShifts.studyId, studyId)));
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (cur.name !== v.name) diff.name = { from: cur.name, to: v.name };
    if (hhmm(cur.startTime) !== v.start) diff.startTime = { from: hhmm(cur.startTime), to: v.start };
    if (hhmm(cur.endTime) !== v.end) diff.endTime = { from: hhmm(cur.endTime), to: v.end };
    if (cur.breakMinutes !== v.breakMin) diff.breakMinutes = { from: cur.breakMinutes, to: v.breakMin };
    if (cur.days !== v.days) diff.days = { from: describeDays(cur.days), to: describeDays(v.days) };
    if (Object.keys(diff).length) await audit(tx, studyId, sub, "update", "position_shift", shiftId, diff);
    return { ok: true as const, notices: [Object.keys(diff).length ? `Turno «${v.name}» actualizado.` : "Sin cambios."] };
  });
}

/**
 * Elimina un turno. Si lo usan actividades y no se confirmó, no borra y devuelve cuántas; al confirmar se quita de ellas
 * (la actividad conserva sus otros turnos; si era el único, queda sin turno).
 */
export async function deleteShift(db: Db, sub: string, studyId: string, shiftId: string, confirmed: boolean): Promise<{ ok: true; removedFrom: number } | { ok: false; needsConfirm: number } | { ok: false; error: string }> {
  return withRls(db, { sub }, async (tx) => {
    const [s] = await tx.select().from(positionShifts).where(and(eq(positionShifts.id, shiftId), eq(positionShifts.studyId, studyId)));
    if (!s) return { ok: false as const, error: "El turno ya no existe." };
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(activityShifts).where(and(eq(activityShifts.studyId, studyId), eq(activityShifts.shiftId, shiftId)));
    if (n > 0 && !confirmed) return { ok: false as const, needsConfirm: n };
    await tx.delete(positionShifts).where(and(eq(positionShifts.id, shiftId), eq(positionShifts.studyId, studyId))); // activity_shifts se limpia por cascada
    await audit(tx, studyId, sub, "delete", "position_shift", shiftId, { name: { from: s.name, to: null } });
    return { ok: true as const, removedFrom: n };
  });
}

/** Turnos elegidos de una actividad. */
export async function activityShiftSelection(db: Db, sub: string, studyId: string, activityId: string): Promise<{ all: boolean; ids: string[] }> {
  return withRls(db, { sub }, async (tx) => {
    const [a] = await tx.select({ all: activities.allShifts }).from(activities).where(and(eq(activities.id, activityId), eq(activities.studyId, studyId)));
    const rows = await tx.select({ id: activityShifts.shiftId }).from(activityShifts).where(and(eq(activityShifts.studyId, studyId), eq(activityShifts.activityId, activityId)));
    return { all: a?.all ?? false, ids: rows.map((r) => r.id) };
  });
}

/**
 * Guarda los turnos de una actividad: «Todos los turnos» o una lista. Solo se aceptan turnos del cargo responsable de la actividad;
 * los que no lo sean (p. ej. porque cambió de cargo) se descartan y se avisa.
 */
export async function setActivityShifts(db: Db, sub: string, studyId: string, activityId: string, sel: { all: boolean; ids: string[] }): Promise<ShiftResult> {
  return withRls(db, { sub }, async (tx) => {
    const [a] = await tx.select({ id: activities.id, code: activities.code, positionId: activities.positionId, all: activities.allShifts }).from(activities).where(and(eq(activities.id, activityId), eq(activities.studyId, studyId)));
    if (!a) return { ok: false as const, errors: ["La actividad ya no existe."] };
    const valid = await tx.select({ id: positionShifts.id, name: positionShifts.name }).from(positionShifts).where(and(eq(positionShifts.studyId, studyId), eq(positionShifts.positionId, a.positionId)));
    const { kept, dropped } = reconcileSelection(sel.all ? [] : sel.ids, valid.map((v) => v.id));
    const before = await tx.select({ id: activityShifts.shiftId }).from(activityShifts).where(and(eq(activityShifts.studyId, studyId), eq(activityShifts.activityId, activityId)));
    const beforeIds = before.map((b) => b.id).sort().join(","), afterIds = [...kept].sort().join(",");
    if (a.all === sel.all && beforeIds === afterIds) return { ok: true as const, notices: [], changed: false };
    await tx.update(activities).set({ allShifts: sel.all }).where(and(eq(activities.id, activityId), eq(activities.studyId, studyId)));
    await tx.delete(activityShifts).where(and(eq(activityShifts.studyId, studyId), eq(activityShifts.activityId, activityId)));
    if (kept.length) await tx.insert(activityShifts).values(kept.map((shiftId) => ({ studyId, activityId, shiftId })));
    const nameOf = new Map(valid.map((v) => [v.id, v.name]));
    await audit(tx, studyId, sub, "update", "activity_shifts", activityId, { shifts: { from: a.all ? "Todos los turnos" : before.map((b) => nameOf.get(b.id) ?? "?").join(", "), to: activityShiftsText(sel.all, kept.map((k) => nameOf.get(k) ?? "")) } });
    return { ok: true as const, notices: dropped.length ? [`Se descartaron ${dropped.length} turno(s) que no pertenecen al cargo de la actividad.`] : [], changed: true };
  });
}

export interface PositionShifts { kind: string; area: string; site: string; position: string; shifts: { id: string; name: string; start: string | null; end: string | null; breakMin: number | null; days: number | null }[] }
/** Cargos con sus turnos, para el selector del formulario de actividades (solo cargos que tienen turnos). */
export async function shiftsByPosition(db: Db, sub: string, studyId: string): Promise<PositionShifts[]> {
  return withRls(db, { sub }, async (tx) => {
    const rows = await tx.select({ id: positionShifts.id, name: positionShifts.name, start: positionShifts.startTime, end: positionShifts.endTime, brk: positionShifts.breakMinutes, days: positionShifts.days, order: positionShifts.sortOrder, kind: positions.dataKind, area: areas.name, site: sites.name, position: positions.name })
      .from(positionShifts).innerJoin(positions, eq(positions.id, positionShifts.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(eq(positionShifts.studyId, studyId)).orderBy(asc(positionShifts.sortOrder), asc(positionShifts.name));
    const out = new Map<string, PositionShifts>();
    for (const r of rows) {
      const k = `${r.kind}|${r.area}|${r.site}|${r.position}`;
      if (!out.has(k)) out.set(k, { kind: r.kind, area: r.area, site: r.site, position: r.position, shifts: [] });
      out.get(k)!.shifts.push({ id: r.id, name: r.name, start: hhmm(r.start), end: hhmm(r.end), breakMin: r.brk, days: r.days });
    }
    return [...out.values()];
  });
}

/** Texto de turnos por id de actividad (hoja de Google y agente): solo actividades que tienen turnos. */
export async function shiftTextByActivityId(tx: Tx, studyId: string): Promise<Map<string, string>> {
  const byCode = await shiftTextRows(tx, studyId);
  return new Map(byCode.map((r) => [r.id, r.text]));
}
/** Lo mismo por código de actividad (para el agente). */
export async function shiftTextByActivityCode(tx: Tx, studyId: string): Promise<Map<string, string>> {
  const rows = await shiftTextRows(tx, studyId);
  return new Map(rows.map((r) => [r.code, r.text]));
}
/** Descripción de los turnos de cada cargo, un turno por línea, para la hoja 2 de Google. Solo cargos con turnos. */
export async function shiftLinesByPositionId(tx: Tx, studyId: string): Promise<Map<string, string>> {
  const rows = await tx.select().from(positionShifts).where(eq(positionShifts.studyId, studyId)).orderBy(asc(positionShifts.sortOrder), asc(positionShifts.name));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.positionId, [...(out.get(r.positionId) ?? []), describeShift({ name: r.name, start: hhmm(r.startTime), end: hhmm(r.endTime), breakMin: r.breakMinutes, days: r.days })]);
  return new Map([...out].map(([k, v]) => [k, v.join("\n")]));
}
async function shiftTextRows(tx: Tx, studyId: string): Promise<{ id: string; code: string; text: string }[]> {
  const acts = await tx.select({ id: activities.id, code: activities.code, all: activities.allShifts }).from(activities).where(eq(activities.studyId, studyId));
  const links = await tx.select({ activityId: activityShifts.activityId, name: positionShifts.name, days: positionShifts.days }).from(activityShifts).innerJoin(positionShifts, eq(positionShifts.id, activityShifts.shiftId)).where(eq(activityShifts.studyId, studyId));
  const names = new Map<string, string[]>();
  for (const l of links) names.set(l.activityId, [...(names.get(l.activityId) ?? []), l.days === null ? l.name : `${l.name} (${describeDays(l.days)})`]);
  const out: { id: string; code: string; text: string }[] = [];
  for (const a of acts) { const t = activityShiftsText(a.all, names.get(a.id) ?? []); if (t) out.push({ id: a.id, code: a.code, text: t }); }
  return out;
}
