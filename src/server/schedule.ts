/** Carga de lo necesario para el reparto semanal (D-101, D-102): cargos, actividades con nombre y tipo, y los turnos de cada cargo (días y horas). Siempre con RLS. */
import { eq } from "drizzle-orm";
import { withRls, type Db } from "../db/client";
import { activities, areas, positionShifts, positions, sites } from "../db/schema";
import { buildSchedules, isActivityType, positionKey, type ActivityExtra, type PositionSchedule, type ShiftDef } from "../domain/schedule";
import type { Params } from "../domain/engine";
import { daysOf } from "../domain/shifts";
import { analyze, type Mode, type PositionRow } from "../domain/summary";
import { loadStudyDataTx } from "./studies";

export interface LoadedSchedules { schedules: PositionSchedule[]; positions: PositionRow[]; params: Params; overload: number }

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export async function loadSchedules(db: Db, sub: string, studyId: string, mode: Mode): Promise<LoadedSchedules> {
  return withRls(db, { sub }, async (tx) => {
    const d = await loadStudyDataTx(tx, studyId);
    const analysis = analyze(d.staff, d.acts, d.params, d.thresholds, mode);
    const acts = await tx.select({ code: activities.code, name: activities.name, type: activities.activityType }).from(activities).where(eq(activities.studyId, studyId));
    const extras = new Map<string, ActivityExtra>(acts.map((a) => [a.code.toLowerCase(), { name: a.name, type: isActivityType(a.type) ? a.type : null }]));
    const rows = await tx.select({ name: positionShifts.name, start: positionShifts.startTime, end: positionShifts.endTime, brk: positionShifts.breakMinutes, days: positionShifts.days, kind: positions.dataKind, area: areas.name, site: sites.name, position: positions.name }).from(positionShifts)
      .innerJoin(positions, eq(positions.id, positionShifts.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(eq(positionShifts.studyId, studyId));
    const shifts = new Map<string, ShiftDef[]>();
    for (const r of rows) {
      const k = positionKey(r.kind, r.area, r.site, r.position);
      (shifts.get(k) ?? shifts.set(k, []).get(k)!).push({ name: r.name, start: hhmm(r.start), end: hhmm(r.end), breakMin: r.brk, days: daysOf(r.days) }); // sin días marcados (null) = los siete
    }
    return { schedules: buildSchedules({ staff: d.staff, acts: d.acts, params: d.params, positions: analysis.positions, extras, shifts, overload: d.thresholds.high }), positions: analysis.positions, params: d.params, overload: d.thresholds.high };
  });
}
