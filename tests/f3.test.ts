import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy, listAreas, listPositions, listStudies, loadStudyData, updateActivityTime, listActivityVersions, AREAS_14 } from "../src/server/studies";
import { analyze } from "../src/domain/summary";
import { check, rejects, summary, URL_ADMIN, URL_APP } from "./helpers";

/** Fase 3: captura de datos de punta a punta contra PostgreSQL real, con RLS y roles. No deja datos de prueba al terminar. */
async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  const users = [owner, viewer, outsider];
  for (const id of users) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    await check("Crear estudio: queda el creador como owner, con parámetros y las 14 áreas del Excel", async () => {
      studyId = await createStudy(app.db, owner, "Estudio de prueba F3");
      const areas = await listAreas(app.db, owner, studyId);
      if (areas.length !== 14 || areas.map((a) => a.name).join("|") !== AREAS_14.join("|")) throw new Error(`áreas: ${areas.length}`);
      const st = await listStudies(app.db, owner);
      if (!st.some((s) => s.id === studyId && s.role === "owner")) throw new Error("no aparece como owner");
    });

    let positionId = "";
    await check("Agregar cargo con dotación: crea sede y cargo; repetir la misma clave reutiliza el cargo", async () => {
      positionId = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "Sede Prueba", position: "Cajero", dataKind: "demo", headcount: 4, weeklyHours: 42 });
      const again = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "Sede Prueba", position: "Cajero", dataKind: "demo", headcount: 2, weeklyHours: 42 });
      if (again !== positionId) throw new Error("se duplicó el cargo");
      const pos = await listPositions(app.db, owner, studyId);
      if (pos.length !== 1) throw new Error(`cargos: ${pos.length}`);
    });

    await check("Agregar actividad y calcular: el resultado coincide con la regla del Excel (hoja 4a/4b)", async () => {
      await addActivity(app.db, owner, studyId, { code: "T-001", name: "Arqueo", positionId, dataKind: "demo", calcMode: "per_event", scope: "per_employee", executions: 1, period: "day", unitsPerExecution: null, timeAvgMin: 10, planning: "planned" });
      const d = await loadStudyData(app.db, owner, studyId);
      const a = analyze(d.staff, d.acts, d.params, d.thresholds, "demo");
      const p = a.positions[0];
      // días/sem = 6 → 6 ejec/sem × 10/60 h = 1 h por ocupante; 6 ocupantes (4+2) → 6 h. Capacidad = 6 × 42 × 0,9 = 226,8
      if (p.occupants !== 6 || Math.abs(p.hours - 6) > 1e-9 || Math.abs(p.capacity - 226.8) > 1e-9) throw new Error(`occ=${p.occupants} h=${p.hours} cap=${p.capacity}`);
      if (a.activities[0].status !== "OK") throw new Error(a.activities[0].status);
    });

    await check("Una actividad con datos faltantes se guarda y muestra su estado, sin inventar valores", async () => {
      await addActivity(app.db, owner, studyId, { code: "T-002", name: "Sin tiempo", positionId, dataKind: "demo", calcMode: "per_event", scope: "per_employee", executions: 1, period: "day", unitsPerExecution: null, timeAvgMin: null, planning: null });
      const d = await loadStudyData(app.db, owner, studyId);
      const a = analyze(d.staff, d.acts, d.params, d.thresholds, "demo");
      const x = a.activities.find((r) => r.code === "T-002");
      if (!x || x.complete || x.status !== "Falta tiempo promedio") throw new Error(JSON.stringify(x?.status));
    });

    await check("Código de actividad duplicado en el estudio es rechazado (23505)", async () => {
      await rejects(addActivity(app.db, owner, studyId, { code: "T-001", name: "Otra", positionId, dataKind: "demo", calcMode: null, scope: null, executions: null, period: null, unitsPerExecution: null, timeAvgMin: null, planning: null }), "23505");
    });

    await check("Un usuario sin membresía no ve ni escribe en el estudio", async () => {
      let denied = false;
      try { await loadStudyData(app.db, outsider, studyId); } catch { denied = true; }
      if (!denied) throw new Error("leyó datos de un estudio ajeno");
      const st = await listStudies(app.db, outsider);
      if (st.length !== 0) throw new Error("ve estudios ajenos");
      let blocked = false;
      try { await addPosition(app.db, outsider, studyId, { area: "Cajas", site: "X", position: "Y", dataKind: "demo", headcount: 1, weeklyHours: 40 }); } catch { blocked = true; }
      if (!blocked) throw new Error("escribió en estudio ajeno");
    });

    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    await check("Un viewer puede leer los datos pero NO crear actividades (42501)", async () => {
      const d = await loadStudyData(app.db, viewer, studyId);
      if (d.acts.length !== 2) throw new Error(`actividades visibles: ${d.acts.length}`);
      const pos = (await listPositions(app.db, viewer, studyId))[0].id;
      await rejects(addActivity(app.db, viewer, studyId, { code: "V-001", name: "No debe", positionId: pos, dataKind: "demo", calcMode: null, scope: null, executions: null, period: null, unitsPerExecution: null, timeAvgMin: null, planning: null }), "42501");
    });

    await check("Concurrencia: con la versión correcta actualiza; con la versión vieja devuelve conflicto (409)", async () => {
      const v = (await listActivityVersions(app.db, owner, studyId)).find((a) => a.code === "T-001")!;
      if (!(await updateActivityTime(app.db, owner, v.id, v.version, 20))) throw new Error("no actualizó con versión correcta");
      if (await updateActivityTime(app.db, owner, v.id, v.version, 30)) throw new Error("aceptó una versión vieja");
      const d = await loadStudyData(app.db, owner, studyId);
      if (d.acts.find((a) => a.code === "T-001")!.timeAvgMin !== 20) throw new Error("el valor guardado no es 20");
    });

    await check("Cambiar un dato actualiza los resultados dependientes (10 → 20 min duplica las horas)", async () => {
      const d = await loadStudyData(app.db, owner, studyId);
      const p = analyze(d.staff, d.acts, d.params, d.thresholds, "demo").positions[0];
      if (Math.abs(p.hours - 12) > 1e-9) throw new Error(`horas=${p.hours}`);
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${users[0]}, ${users[1]}, ${users[2]})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
