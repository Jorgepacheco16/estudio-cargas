/** Carga de lo necesario para el reparto semanal (D-101, D-102, D-103): cargos, actividades con nombre y tipo, y los días de los turnos de cada cargo. Siempre con RLS. */
import { eq } from "drizzle-orm";
import { withRls, type Db } from "../db/client";
import { activities, activityShifts, areas, positionShifts, positions, sites } from "../db/schema";
import { attachSavedOrders, buildSchedules, isActivityType, positionKey, reserveHoursByPosition, type ActivityExtra, type PositionSchedule, type ShiftRef } from "../domain/schedule";
import type { Params } from "../domain/engine";
import { daysOf } from "../domain/shifts";
import { analyze, type Mode, type PositionRow } from "../domain/summary";
import { listOrdersTx } from "./schedule-order";
import { loadStudyDataTx } from "./studies";

export interface LoadedSchedules { schedules: PositionSchedule[]; positions: PositionRow[]; params: Params; overload: number; kpis: { activities: number; complete: number } }

/** Horas por semana de actividades no planificadas u ocasionales de cada cargo (por clave de cargo), SIN calcular el reparto: lo usa Dotación requerida para mostrar su peso. Siempre con RLS. */
export async function loadReserveHours(db: Db, sub: string, studyId: string, mode: Mode): Promise<Map<string, number>> {
  return withRls(db, { sub }, async (tx) => {
    const d = await loadStudyDataTx(tx, studyId);
    const analysis = analyze(d.staff, d.acts, d.params, d.thresholds, mode);
    const acts = await tx.select({ code: activities.code, name: activities.name, type: activities.activityType }).from(activities).where(eq(activities.studyId, studyId));
    const extras = new Map<string, ActivityExtra>(acts.map((a) => [a.code.toLowerCase(), { name: a.name, type: isActivityType(a.type) ? a.type : null }]));
    return reserveHoursByPosition({ staff: d.staff, acts: d.acts, params: d.params, positions: analysis.positions, extras, shiftDays: new Map() });
  });
}

export async function loadSchedules(db: Db, sub: string, studyId: string, mode: Mode): Promise<LoadedSchedules> {
  return withRls(db, { sub }, async (tx) => {
    const d = await loadStudyDataTx(tx, studyId);
    const analysis = analyze(d.staff, d.acts, d.params, d.thresholds, mode);
    const acts = await tx.select({ code: activities.code, name: activities.name, type: activities.activityType }).from(activities).where(eq(activities.studyId, studyId));
    const extras = new Map<string, ActivityExtra>(acts.map((a) => [a.code.toLowerCase(), { name: a.name, type: isActivityType(a.type) ? a.type : null }]));
    const rows = await tx.select({ id: positionShifts.id, name: positionShifts.name, start: positionShifts.startTime, end: positionShifts.endTime, order: positionShifts.sortOrder, days: positionShifts.days, kind: positions.dataKind, area: areas.name, site: sites.name, position: positions.name }).from(positionShifts)
      .innerJoin(positions, eq(positions.id, positionShifts.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(eq(positionShifts.studyId, studyId));
    const union = new Map<string, Set<number>>(), refOf = new Map<string, ShiftRef>(), positionShiftsMap = new Map<string, ShiftRef[]>();
    const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
    for (const r of [...rows].sort((a, b) => a.order - b.order)) {
      const k = positionKey(r.kind, r.area, r.site, r.position);
      const set = union.get(k) ?? union.set(k, new Set()).get(k)!;
      for (const day of daysOf(r.days)) set.add(day); // sin días marcados (null) = los siete
      const ref: ShiftRef = { id: r.id, name: r.name, days: daysOf(r.days), start: hhmm(r.start), end: hhmm(r.end) };
      refOf.set(r.id, ref);
      (positionShiftsMap.get(k) ?? positionShiftsMap.set(k, []).get(k)!).push(ref);
    }
    const shiftDays = new Map([...union].map(([k, s]) => [k, [...s].sort((a, b) => a - b)]));
    // Días en que se ejecuta cada actividad (D-108): la unión de los días de los turnos que tiene marcados; «Todos los turnos» o ninguno marcado = sin restricción (todos los días del cargo).
    const shiftRows = await tx.select({ code: activities.code, all: activities.allShifts, shiftId: activityShifts.shiftId, days: positionShifts.days }).from(activities)
      .leftJoin(activityShifts, eq(activityShifts.activityId, activities.id)).leftJoin(positionShifts, eq(positionShifts.id, activityShifts.shiftId)).where(eq(activities.studyId, studyId));
    const byActivity = new Map<string, Set<number> | null>(), byActivityShifts = new Map<string, ShiftRef[] | null>(); // D-109: los turnos de cada actividad
    for (const r of shiftRows) {
      const k = r.code.toLowerCase();
      if (r.all) { byActivity.set(k, null); byActivityShifts.set(k, null); continue; }
      if (r.shiftId === null) { if (!byActivity.has(k)) { byActivity.set(k, null); byActivityShifts.set(k, null); } continue; }
      const set = byActivity.get(k) ?? new Set<number>();
      for (const day of daysOf(r.days)) set.add(day);
      byActivity.set(k, set);
      const ref = refOf.get(r.shiftId);
      if (ref) byActivityShifts.set(k, [...(byActivityShifts.get(k) ?? []), ref]);
    }
    const activityDays = new Map([...byActivity].map(([k, s]) => [k, s === null ? null : [...s].sort((a, b) => a - b)]));
    const orders = await listOrdersTx(tx, studyId); // órdenes guardados de las tareas (D-104)
    return { schedules: attachSavedOrders(buildSchedules({ staff: d.staff, acts: d.acts, params: d.params, positions: analysis.positions, extras, shiftDays, activityDays, activityShifts: byActivityShifts, positionShifts: positionShiftsMap, overload: d.thresholds.high }), orders), positions: analysis.positions, params: d.params, overload: d.thresholds.high, kpis: { activities: analysis.kpis.activities, complete: analysis.kpis.complete } };
  });
}
