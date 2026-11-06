/** Carga de lo necesario para el reparto semanal (D-101, D-102, D-103): cargos, actividades con nombre y tipo, y los días de los turnos de cada cargo. Siempre con RLS. */
import { eq } from "drizzle-orm";
import { withRls, type Db } from "../db/client";
import { activities, areas, positionShifts, positions, sites } from "../db/schema";
import { buildSchedules, isActivityType, positionKey, type ActivityExtra, type PositionSchedule } from "../domain/schedule";
import type { Params } from "../domain/engine";
import { daysOf } from "../domain/shifts";
import { analyze, type Mode, type PositionRow } from "../domain/summary";
import { loadStudyDataTx } from "./studies";

export interface LoadedSchedules { schedules: PositionSchedule[]; positions: PositionRow[]; params: Params; overload: number }

export async function loadSchedules(db: Db, sub: string, studyId: string, mode: Mode): Promise<LoadedSchedules> {
  return withRls(db, { sub }, async (tx) => {
    const d = await loadStudyDataTx(tx, studyId);
    const analysis = analyze(d.staff, d.acts, d.params, d.thresholds, mode);
    const acts = await tx.select({ code: activities.code, name: activities.name, type: activities.activityType }).from(activities).where(eq(activities.studyId, studyId));
    const extras = new Map<string, ActivityExtra>(acts.map((a) => [a.code.toLowerCase(), { name: a.name, type: isActivityType(a.type) ? a.type : null }]));
    const rows = await tx.select({ days: positionShifts.days, kind: positions.dataKind, area: areas.name, site: sites.name, position: positions.name }).from(positionShifts)
      .innerJoin(positions, eq(positions.id, positionShifts.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(eq(positionShifts.studyId, studyId));
    const union = new Map<string, Set<number>>();
    for (const r of rows) {
      const k = positionKey(r.kind, r.area, r.site, r.position);
      const set = union.get(k) ?? union.set(k, new Set()).get(k)!;
      for (const day of daysOf(r.days)) set.add(day); // sin días marcados (null) = los siete
    }
    const shiftDays = new Map([...union].map(([k, s]) => [k, [...s].sort((a, b) => a - b)]));
    return { schedules: buildSchedules({ staff: d.staff, acts: d.acts, params: d.params, positions: analysis.positions, extras, shiftDays, overload: d.thresholds.high }), positions: analysis.positions, params: d.params, overload: d.thresholds.high };
  });
}
