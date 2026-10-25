/**
 * Acceso a datos de estudios (Fase 3). TODA consulta pasa por withRls(): la base aplica los permisos por usuario.
 * Las funciones reciben `db` (conexión app_user) y `sub` (id del usuario autenticado); no usan la clave de servicio.
 */
import { and, eq, inArray } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../db/client";
import { activities, areas, memberships, positions, sites, staffingEntries, studies, studyParameters } from "../db/schema";
import type { ActivityInput, Params, StaffingInput } from "../domain/engine";
import type { Thresholds } from "../domain/summary";

/** Áreas operativas del Excel (hoja Parametros, columna E). Se cargan al crear cada estudio. */
export const AREAS_14 = [
  "Administración punto de venta", "Cajas", "Carnes - Operaciones", "Domicilios", "Fruver - Operaciones", "Inventarios", "OPL - Operaciones",
  "Panadería - Operaciones", "PLS", "Recibo y almacenamiento - Operaciones", "Riesgos y prevención de pérdidas - Operaciones", "SAC - Operaciones",
  "Servicio al cliente PDV", "Supervisión de cajas y tesorería",
] as const;

type Kind = "real" | "demo";
const num = (x: string | number | null | undefined) => (x === null || x === undefined ? null : Number(x));
const str = (x: number | null | undefined) => (x === null || x === undefined ? null : String(x));

export async function createStudy(db: Db, sub: string, name: string, description?: string) {
  const clean = name.trim();
  if (clean.length < 3 || clean.length > 120) throw new Error("El nombre del estudio debe tener entre 3 y 120 caracteres");
  return withRls(db, { sub }, async (tx) => {
    const [s] = await tx.insert(studies).values({ name: clean, description: description?.trim() || null, createdBy: sub }).returning({ id: studies.id });
    await tx.insert(memberships).values({ studyId: s.id, userId: sub, role: "owner" });
    await tx.insert(studyParameters).values({ studyId: s.id });
    await tx.insert(areas).values(AREAS_14.map((n, i) => ({ studyId: s.id, name: n, sortOrder: i })));
    return s.id;
  });
}

export async function listStudies(db: Db, sub: string) {
  return withRls(db, { sub }, (tx) =>
    tx.select({ id: studies.id, name: studies.name, role: memberships.role }).from(studies)
      .innerJoin(memberships, and(eq(memberships.studyId, studies.id), eq(memberships.userId, sub))).orderBy(studies.createdAt));
}

export async function listAreas(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) => tx.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.studyId, studyId)).orderBy(areas.sortOrder));
}

export async function listPositions(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) =>
    tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name, dataKind: positions.dataKind }).from(positions)
      .innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(eq(positions.studyId, studyId)).orderBy(areas.name, sites.name, positions.name));
}

export interface PositionInput { area: string; site: string; position: string; dataKind: Kind; headcount: number | null; weeklyHours: number | null }

/** Crea (o reutiliza) sede y cargo por su clave del Excel y agrega una fila de dotación. */
export async function addPosition(db: Db, sub: string, studyId: string, i: PositionInput) {
  const siteName = i.site.trim(), posName = i.position.trim();
  if (!siteName || !posName) throw new Error("Sede y cargo son obligatorios");
  return withRls(db, { sub }, async (tx) => {
    const [area] = await tx.select({ id: areas.id }).from(areas).where(and(eq(areas.studyId, studyId), eq(areas.name, i.area)));
    if (!area) throw new Error("Área no registrada en el estudio");
    await tx.insert(sites).values({ studyId, name: siteName }).onConflictDoNothing();
    const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.studyId, studyId), eq(sites.name, siteName)));
    await tx.insert(positions).values({ studyId, areaId: area.id, siteId: site.id, name: posName, dataKind: i.dataKind }).onConflictDoNothing();
    const [pos] = await tx.select({ id: positions.id }).from(positions)
      .where(and(eq(positions.studyId, studyId), eq(positions.areaId, area.id), eq(positions.siteId, site.id), eq(positions.name, posName), eq(positions.dataKind, i.dataKind)));
    await tx.insert(staffingEntries).values({ studyId, positionId: pos.id, headcount: i.headcount, weeklyHours: str(i.weeklyHours) });
    return pos.id;
  });
}

export interface ActivityFormInput {
  code: string; name: string; positionId: string; dataKind: Kind; calcMode: "per_event" | "per_unit" | null; scope: "per_employee" | "position_total" | null;
  executions: number | null; period: "day" | "week" | "fortnight" | "month" | "quarter" | "year" | null; unitsPerExecution: number | null; timeAvgMin: number | null;
  planning: "planned" | "unplanned" | null;
}

export async function addActivity(db: Db, sub: string, studyId: string, i: ActivityFormInput) {
  const code = i.code.trim(), name = i.name.trim();
  if (!code || !name) throw new Error("Código y nombre de la actividad son obligatorios");
  return withRls(db, { sub }, async (tx) => {
    const [a] = await tx.insert(activities).values({
      studyId, dataKind: i.dataKind, code, name, positionId: i.positionId, calcMode: i.calcMode, scope: i.scope, executionsPerPeriod: str(i.executions), period: i.period,
      unitsPerExecution: str(i.unitsPerExecution), timeAvgMin: str(i.timeAvgMin), planning: i.planning,
    }).returning({ id: activities.id });
    return a.id;
  });
}

/** Actualiza con control de versión. Devuelve false si otra persona cambió la fila antes (equivale a HTTP 409). */
export async function updateActivityTime(db: Db, sub: string, id: string, expectedVersion: number, timeAvgMin: number | null): Promise<boolean> {
  return withRls(db, { sub }, async (tx) => {
    const rows = await tx.update(activities).set({ timeAvgMin: str(timeAvgMin) }).where(and(eq(activities.id, id), eq(activities.version, expectedVersion))).returning({ id: activities.id });
    return rows.length === 1;
  });
}

export async function listActivityVersions(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) => tx.select({ id: activities.id, code: activities.code, version: activities.version }).from(activities).where(eq(activities.studyId, studyId)));
}

/** Carga el estudio completo en la forma que espera el motor de cálculo. */
export type StudyData = { params: Params; thresholds: Thresholds; staff: StaffingInput[]; acts: ActivityInput[] };

export async function loadStudyData(db: Db, sub: string, studyId: string): Promise<StudyData> {
  return withRls(db, { sub }, (tx) => loadStudyDataTx(tx, studyId));
}

/** Igual que loadStudyData, dentro de una transacción ya abierta con RLS (lo usa la importación para verificar antes de confirmar). */
export async function loadStudyDataTx(tx: Tx, studyId: string): Promise<StudyData> {
  {
    const [p] = await tx.select().from(studyParameters).where(eq(studyParameters.studyId, studyId));
    if (!p) throw new Error("Estudio sin parámetros o sin acceso");
    const pos = await tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name, kind: positions.dataKind }).from(positions)
      .innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(eq(positions.studyId, studyId));
    const byId = new Map(pos.map((x) => [x.id, x]));
    const st = await tx.select({ positionId: staffingEntries.positionId, headcount: staffingEntries.headcount, weeklyHours: staffingEntries.weeklyHours }).from(staffingEntries).where(eq(staffingEntries.studyId, studyId));
    const staff: StaffingInput[] = st.flatMap((s) => { const x = byId.get(s.positionId); return x ? [{ dataKind: x.kind, area: x.area, site: x.site, position: x.name, headcount: s.headcount, weeklyHours: num(s.weeklyHours) }] : []; });
    const ac = await tx.select().from(activities).where(eq(activities.studyId, studyId)).orderBy(activities.code);
    const acts: ActivityInput[] = ac.flatMap((a) => {
      const x = byId.get(a.positionId); if (!x) return [];
      return [{
        code: a.code, dataKind: a.dataKind, area: x.area, site: x.site, position: x.name, employeeCode: a.employeeCode, calcMode: a.calcMode, scope: a.scope,
        executions: num(a.executionsPerPeriod), period: a.period, unitsPerExecution: num(a.unitsPerExecution), timeAvgMin: num(a.timeAvgMin), timeMinMin: num(a.timeMinMin), timeMaxMin: num(a.timeMaxMin),
        seasonHigh: num(a.seasonHighFactor), seasonLow: num(a.seasonLowFactor), simultaneous: a.simultaneousPeople, loadShare: num(a.loadSharePct),
        secondaryPosition: a.secondaryPositionId ? byId.get(a.secondaryPositionId)?.name ?? null : null, planning: a.planning,
        secondaryArea: a.secondaryPositionId ? byId.get(a.secondaryPositionId)?.area ?? null : null, secondarySite: a.secondaryPositionId ? byId.get(a.secondaryPositionId)?.site ?? null : null,
        waitMin: num(a.waitMin), waitOccupies: a.waitOccupiesPerson, travelMin: num(a.travelMin), reworkPct: num(a.reworkPct), reworkMin: num(a.reworkMin),
      }];
    });
    const params: Params = { workDaysPerWeek: Number(p.workDaysPerWeek), weeksPerMonth: Number(p.weeksPerMonth), weeksPerYear: p.weeksPerYear, reservePct: Number(p.reservePct), scenario: p.scenario };
    return { params, thresholds: { high: Number(p.overloadThreshold), low: Number(p.lowLoadThreshold) }, staff, acts };
  }
}

/** Actividades «No» o «Parcialmente» documentadas formalmente, por (tipo, área, sede, cargo): columna K del comparador de sedes (hoja 2b). */
export async function loadUndocumented(db: Db, sub: string, studyId: string): Promise<Map<string, number>> {
  return withRls(db, { sub }, async (tx) => {
    const rows = await tx.select({ kind: positions.dataKind, area: areas.name, site: sites.name, position: positions.name }).from(activities)
      .innerJoin(positions, eq(positions.id, activities.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(and(eq(activities.studyId, studyId), inArray(activities.formallyDocumented, ["no", "partial"])));
    const out = new Map<string, number>();
    for (const r of rows) { const k = [r.kind, r.area.trim().toLowerCase(), r.site.trim().toLowerCase(), r.position.trim().toLowerCase()].join("|"); out.set(k, (out.get(k) ?? 0) + 1); }
    return out;
  });
}