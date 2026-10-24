import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy, listActivityVersions } from "../src/server/studies";
import { addMeasurement, deleteMeasurement, getSnapshots, listDeviations, listMeasurements, listSnapshots, productivityInputs, runDetection, setDeviationStatus, snapshotTargets, takeSnapshot, timelineEvents } from "../src/server/history";
import { DISPERSION_PCT, RECURRING_CONFLICTS, detectDeviations, diffSnapshots, numbersIn, productivity, standardPerHour, validateExplanation, type DevInput, type SnapActivity, type SnapMetrics, type SnapPosition } from "../src/domain/history";
import { check, rejects, summary, URL_ADMIN, URL_APP } from "./helpers";

/** Fase 10 [PROPUESTA]: reglas puras de historia, productividad y desviaciones, y su persistencia contra PostgreSQL real con RLS. */
const IND = { areasWithInfo: "1 de 14", activities: 0, completePct: null, hours: 0, capacity: 0, capacityPct: null, overload: 0, lowLoad: 0, verifiablePct: null, opportunities: 0, recoverableHours: 0, criticalNoBackup: 0 };
const pos = (o: Partial<SnapPosition> = {}): SnapPosition => ({ key: "real|cajas|s1|cajero", area: "Cajas", site: "S1", position: "Cajero", kind: "real", occupants: 2, capacity: 100, hours: 80, pct: 0.8, level: "ok", activities: 3, complete: 3, ...o });
const act = (o: Partial<SnapActivity> = {}): SnapActivity => ({ id: "a1", code: "A-1", hours: 10, complete: true, source: "declared_by_employee", confidence: "high", hasEvidence: false, ...o });
const snap = (o: { positions?: SnapPosition[]; activities?: SnapActivity[]; overduePlans?: string[] } = {}): SnapMetrics => ({ version: 1, indicators: IND, areas: [], positions: o.positions ?? [pos()], activities: o.activities ?? [act()], overduePlans: o.overduePlans ?? [], thresholds: { high: 1, low: 0.5 } });
const P = { estimatePct: 0.2, minMeasurements: 3, jumpPct: 0.25, minHistory: 3 };
const base = (o: Partial<DevInput> = {}): DevInput => ({ params: P, snapshots: [], activities: [], measurements: [], syncEvents: [], ...o });
const codes = (i: DevInput) => detectDeviations(i).map((c) => c.ruleCode).sort().join(",");

async function main() {
  await check("Estándar por hora: 60 ÷ tiempo promedio; sin modalidad o sin tiempo no hay estándar", () => {
    if (standardPerHour({ calcMode: "per_event", timeAvgMin: 4 }) !== 15 || standardPerHour({ calcMode: "per_unit", timeAvgMin: 30 }) !== 2) throw new Error("estándar");
    if (standardPerHour({ calcMode: null, timeAvgMin: 4 }) !== null || standardPerHour({ calcMode: "per_event", timeAvgMin: 0 }) !== null || standardPerHour({ calcMode: "per_event", timeAvgMin: null }) !== null) throw new Error("debía ser null");
  });

  await check("Productividad: sin mediciones o con menos del mínimo NO hay número; con el mínimo, índice = real ÷ estándar", () => {
    const a = { calcMode: "per_event" as const, timeAvgMin: 4 };
    const none = productivity(a, [], 3);
    if (none.status !== "sin_mediciones" || none.index !== null || none.message !== "Sin mediciones") throw new Error(JSON.stringify(none));
    const few = productivity(a, [{ unitsProcessed: 30, personHours: 2 }, { unitsProcessed: 30, personHours: 2 }], 3);
    if (few.status !== "insuficientes" || few.index !== null || few.realPerHour !== null) throw new Error(JSON.stringify(few));
    const ok = productivity(a, [{ unitsProcessed: 30, personHours: 2 }, { unitsProcessed: 15, personHours: 1 }, { unitsProcessed: 15, personHours: 1 }], 3);
    if (ok.status !== "ok" || ok.realPerHour !== 15 || ok.standardPerHour !== 15 || ok.index !== 1) throw new Error(JSON.stringify(ok));
    const noUnits = productivity(a, [{ unitsProcessed: null, personHours: 2 }, { unitsProcessed: null, personHours: 2 }, { unitsProcessed: null, personHours: 2 }], 3);
    if (noUnits.status !== "insuficientes") throw new Error("contó mediciones sin unidades");
    if (productivity({ calcMode: null, timeAvgMin: null }, [], 3).status !== "sin_estandar") throw new Error("sin estándar");
  });

  await check("R1 estimado vs medido: con n mediciones y diferencia > X %; no con pocas mediciones ni con diferencia pequeña", () => {
    const acts = [{ id: "a1", code: "A-1", calcMode: "per_event" as const, timeAvgMin: 4 }];
    const ms = (units: number, hours: number, n: number) => Array.from({ length: n }, () => ({ activityId: "a1", unitsProcessed: units, personHours: hours }));
    if (codes(base({ activities: acts, measurements: ms(10, 1, 3) })) !== "R1") throw new Error("6 min vs 4 min debía alertar"); // 60/10 = 6 min (+50 %)
    if (codes(base({ activities: acts, measurements: ms(10, 1, 2) })) !== "") throw new Error("alertó con menos del mínimo");
    if (codes(base({ activities: acts, measurements: ms(15, 1, 3) })) !== "") throw new Error("alertó sin diferencia (4 min)");
    if (codes(base({ activities: acts, measurements: ms(14, 1, 3) })) !== "") throw new Error("alertó dentro del umbral (+7 %)");
  });

  await check("R2 cruce de umbral: solo cuando un cargo PASA a sobrecarga entre dos fotos", () => {
    const ok = snap(), over = snap({ positions: [pos({ level: "overload", pct: 1.2 })] });
    if (codes(base({ snapshots: [ok, over] })) !== "R2") throw new Error("no detectó el cruce");
    if (codes(base({ snapshots: [over, over] })) !== "") throw new Error("alertó sin cruce");
    if (codes(base({ snapshots: [over] })) !== "") throw new Error("alertó con una sola foto");
  });

  await check("R3 salto sin respaldo: contra la mediana de las fotos previas, con mínimo de historia y sin cambio de fuente/confianza/evidencia", () => {
    const h = (hours: number, o: Partial<SnapActivity> = {}) => snap({ activities: [act({ hours, ...o })] });
    const hist = [h(10), h(10), h(10)];
    if (codes(base({ snapshots: [...hist, h(14)] })) !== "R3") throw new Error("+40 % debía alertar");
    if (codes(base({ snapshots: [...hist, h(11)] })) !== "") throw new Error("+10 % no debía alertar");
    if (codes(base({ snapshots: [...hist, h(14, { confidence: "low" })] })) === "R3") throw new Error("hubo cambio de confianza: tiene respaldo");
    if (codes(base({ snapshots: [h(10), h(10), h(14)] })).includes("R3")) throw new Error("sin el mínimo de historia no se activa la línea base");
    if (codes(base({ snapshots: [h(10), h(30), h(10), h(10), h(11)] })).includes("R3")) throw new Error("la mediana debía ignorar el valor atípico");
  });

  await check("R4 pérdida de calidad: baja la confianza o la fuente deja de ser verificable", () => {
    const a = (o: Partial<SnapActivity>) => snap({ activities: [act(o)] });
    if (codes(base({ snapshots: [a({ confidence: "high" }), a({ confidence: "low" })] })) !== "R4") throw new Error("confianza");
    if (codes(base({ snapshots: [a({ source: "timed" }), a({ source: "declared_by_manager" })] })) !== "R4") throw new Error("fuente");
    if (codes(base({ snapshots: [a({ confidence: "low" }), a({ confidence: "high" })] })) !== "") throw new Error("mejorar no es una desviación");
  });

  await check("R5 dispersión entre sedes: > 30 % de horas por ocupante; avisa si aparece o crece, no si se mantiene", () => {
    const two = (b: number) => snap({ positions: [pos({ key: "k1", site: "S1", hours: 20, occupants: 2 }), pos({ key: "k2", site: "S2", hours: 2 * b, occupants: 2 })] });
    if (codes(base({ snapshots: [two(14)] })) !== "R5") throw new Error("40 % debía alertar");
    if (codes(base({ snapshots: [two(11)] })) !== "") throw new Error("10 % no debía alertar");
    if (codes(base({ snapshots: [two(14), two(14)] })) !== "") throw new Error("se mantiene igual: no repetir");
    if (codes(base({ snapshots: [two(14), two(16)] })) !== "R5") throw new Error("creció: debía alertar");
    if (DISPERSION_PCT !== 0.3) throw new Error("la regla del Excel es 30 %");
  });

  await check("R6 plan reincidente, R7 más incompletas y R8 conflictos recurrentes", () => {
    if (codes(base({ snapshots: [snap({ overduePlans: ["AC-1"] }), snap({ overduePlans: ["AC-1", "AC-2"] })] })) !== "R6") throw new Error("R6");
    if (codes(base({ snapshots: [snap({ overduePlans: ["AC-1"] }), snap({ overduePlans: [] })] })) !== "") throw new Error("R6 sin reincidencia");
    if (codes(base({ snapshots: [snap(), snap({ activities: [act(), act({ id: "a2", code: "A-2", complete: false })] })] })) !== "R7") throw new Error("R7");
    const ev = (n: number) => Array.from({ length: n }, () => ({ sheet: "3_Actividades", rows: [9], at: "2026-10-01T00:00:00Z" }));
    if (codes(base({ syncEvents: ev(RECURRING_CONFLICTS) })) !== "R8" || codes(base({ syncEvents: ev(RECURRING_CONFLICTS - 1) })) !== "") throw new Error("R8");
  });

  await check("Comparar dos fotos: indicadores, cargos que cambian de nivel e incompletas", () => {
    const d = diffSnapshots(snap(), { ...snap({ positions: [pos({ level: "overload" })], activities: [act({ complete: false })] }), indicators: { ...IND, hours: 50 } });
    if (d.indicators.find((i) => i.key === "hours")?.delta !== 50 || d.crossings.length !== 1 || d.crossings[0].to !== "overload" || d.incomplete.from !== 0 || d.incomplete.to !== 1) throw new Error(JSON.stringify(d));
  });

  await check("Explicación del modelo: debe citar cambios entregados y no introducir cifras nuevas", () => {
    const rec = { baseline: { estimatedMin: 4 }, observed: { measuredMin: 6, n: 3 } };
    const v = (text: string, cited: number[], ids = [101, 102]) => validateExplanation({ text, cited }, ids, rec, true);
    if (v("El tiempo medido (6 min) supera el estimado de 4 min tras el cambio #101 hecho desde la hoja.", [101]) !== null) throw new Error("rechazó una explicación válida");
    if (!v("El tiempo medido subió a 9 min tras el cambio #101 de la hoja de cálculo.", [101])?.includes("cifras")) throw new Error("aceptó una cifra inventada");
    if (!v("El tiempo medido es 6 min por el cambio #999 de la hoja de cálculo.", [999])?.includes("identificador")) throw new Error("aceptó un cambio no entregado");
    if (!v("El tiempo medido es 6 min y no hay más explicación disponible aquí.", [])?.includes("ningún")) throw new Error("aceptó sin citar");
    if (v("Corto", [101]) === null) throw new Error("aceptó un texto vacío de contenido");
    if (numbersIn("1,5 y 2.25 y 7").join("|") !== "1.5|2.25|7") throw new Error("numbersIn");
    if (validateExplanation({ text: "No hay cambios recientes que expliquen la desviación observada.", cited: [] }, [], rec, true) !== null) throw new Error("sin cambios entregados no se exige cita");
  });

  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio historia");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    const p = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "S1", position: "Cajero", dataKind: "real", headcount: 2, weeklyHours: 42 });
    await addActivity(app.db, owner, studyId, { code: "H-1", name: "Arqueo", positionId: p, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 1, period: "day", unitsPerExecution: null, timeAvgMin: 4, planning: "planned" });
    const actId = (await listActivityVersions(app.db, owner, studyId))[0].id;

    await check("Fotos: se guardan con los indicadores, se listan y se leen para comparar; el viewer no puede tomarlas", async () => {
      const a = await takeSnapshot(app.db, owner, studyId, "Primera");
      const b = await takeSnapshot(app.db, owner, studyId, "Segunda");
      const list = await listSnapshots(app.db, owner, studyId);
      if (list.length !== 2 || !list.some((s) => s.id === a)) throw new Error("no se listaron");
      const got = await getSnapshots(app.db, owner, studyId, [a, b]);
      const m = got[0].metrics as SnapMetrics;
      if (m.version !== 1 || m.positions.length !== 1 || m.activities[0].code !== "H-1" || m.activities[0].id !== actId) throw new Error(JSON.stringify(m).slice(0, 200));
      if (JSON.stringify(m).includes("Arqueo")) throw new Error("la foto guardó texto libre");
      await rejects(takeSnapshot(app.db, viewer, studyId, "No debe"), "42501");
      if ((await listSnapshots(app.db, viewer, studyId)).length !== 2) throw new Error("el viewer debe poder leer");
    });

    await check("Mediciones: se guardan, la productividad pasa de «sin mediciones» a índice con el mínimo, y el viewer no escribe", async () => {
      const before = await productivityInputs(app.db, owner, studyId);
      if (productivity({ calcMode: before.rows[0].calcMode, timeAvgMin: before.rows[0].timeAvgMin }, before.rows[0].measures, before.minN).status !== "sin_mediciones") throw new Error("debía decir sin mediciones");
      for (let i = 0; i < 3; i++) await addMeasurement(app.db, owner, studyId, { activityId: actId, observedAt: new Date(), unitsProcessed: 10, personHours: 1, method: "timed", observer: null });
      const after = await productivityInputs(app.db, owner, studyId);
      const pr = productivity({ calcMode: after.rows[0].calcMode, timeAvgMin: after.rows[0].timeAvgMin }, after.rows[0].measures, after.minN);
      if (pr.status !== "ok" || Math.abs((pr.index ?? 0) - 10 / 15) > 1e-9) throw new Error(JSON.stringify(pr));
      await rejects(addMeasurement(app.db, viewer, studyId, { activityId: actId, observedAt: new Date(), unitsProcessed: 1, personHours: 1, method: "timed", observer: null }), "42501");
      await rejects(addMeasurement(app.db, owner, studyId, { activityId: actId, observedAt: new Date(), unitsProcessed: 1, personHours: 0, method: "timed", observer: null }), "23514");
    });

    await check("Detección: R1 se crea una vez; repetir no duplica; descartar suprime; reconocer y reabrir cambian el estado; todo queda auditado", async () => {
      const r1 = await runDetection(app.db, owner, studyId);
      if (r1.created !== 1) throw new Error(JSON.stringify(r1));
      const again = await runDetection(app.db, owner, studyId);
      if (again.created !== 0 || again.suppressed !== 1) throw new Error(`duplicó: ${JSON.stringify(again)}`);
      const d = (await listDeviations(app.db, owner, studyId))[0];
      if (d.ruleCode !== "R1" || d.entityId !== actId || (d.observed as { measuredMin: number }).measuredMin !== 6) throw new Error(JSON.stringify(d));
      if (!(await setDeviationStatus(app.db, owner, studyId, d.id, "dismissed"))) throw new Error("no descartó");
      if ((await runDetection(app.db, owner, studyId)).created !== 0) throw new Error("volvió a crear una descartada");
      if (!(await setDeviationStatus(app.db, owner, studyId, d.id, "acknowledged"))) throw new Error("no reconoció");
      if ((await listDeviations(app.db, owner, studyId))[0].status !== "acknowledged") throw new Error("estado");
      if (await setDeviationStatus(app.db, viewer, studyId, d.id, "open")) throw new Error("el viewer cambió el estado");
      const au = (await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and entity in ('deviation','deviation_detection','measurement','snapshot')`)) as unknown as { n: number }[];
      if (au[0].n < 8) throw new Error(`auditoría ${au[0].n}`);
    });

    await check("Umbrales del estudio: subir el mínimo de mediciones desactiva R1 en una detección nueva", async () => {
      const fresh = await createStudy(app.db, owner, "Estudio umbrales");
      const p2 = await addPosition(app.db, owner, fresh, { area: "Cajas", site: "S1", position: "Cajero", dataKind: "real", headcount: 2, weeklyHours: 42 });
      await addActivity(app.db, owner, fresh, { code: "U-1", name: "x", positionId: p2, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 1, period: "day", unitsPerExecution: null, timeAvgMin: 4, planning: "planned" });
      const a2 = (await listActivityVersions(app.db, owner, fresh))[0].id;
      for (let i = 0; i < 3; i++) await addMeasurement(app.db, owner, fresh, { activityId: a2, observedAt: new Date(), unitsProcessed: 10, personHours: 1, method: "timed", observer: null });
      await admin.db.execute(sql`update public.study_parameters set dev_min_measurements = 5 where study_id = ${fresh}`);
      if ((await runDetection(app.db, owner, fresh)).created !== 0) throw new Error("ignoró el mínimo del estudio");
      await admin.db.execute(sql`delete from public.studies where id = ${fresh}`);
    });

    await check("Borrar una medición la elimina y deja auditoría; la línea de tiempo trae eventos por origen", async () => {
      const ms = await listMeasurements(app.db, owner, studyId);
      if (!(await deleteMeasurement(app.db, owner, studyId, ms[0].id))) throw new Error("no borró");
      if (await deleteMeasurement(app.db, viewer, studyId, ms[1].id)) throw new Error("el viewer borró");
      const tl = await timelineEvents(app.db, owner, studyId, 90);
      if (tl.snaps.length !== 2 || !tl.audit.some((e) => e.origin === "app")) throw new Error("línea de tiempo");
    });

    await check("Fotos programadas: la función segura entrega un propietario por estudio y no datos del estudio", async () => {
      const t = (await snapshotTargets(app.db)).find((x) => x.studyId === studyId);
      if (!t || t.actorId !== owner) throw new Error(JSON.stringify(t));
      const cols = (await admin.db.execute(sql`select count(*)::int n from information_schema.routines where routine_name = 'snapshot_targets' and security_type = 'DEFINER'`)) as unknown as { n: number }[];
      if (cols[0].n !== 1) throw new Error("la función no es SECURITY DEFINER");
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
