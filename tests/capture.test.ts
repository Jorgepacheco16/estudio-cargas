import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy, listActivityVersions, listAreas } from "../src/server/studies";
import { deleteRow, listRows, parseForm, saveRow, SHEETS, sheetById } from "../src/server/capture";
import { check, rejects, summary, URL_ADMIN, URL_APP } from "./helpers";

/** Fase 3 (hojas 5–10 y parámetros): validación del formulario y guardado real con RLS, versión y auditoría. No deja datos. */
const def = (id: string) => sheetById(id)!;
const fd = (o: Record<string, string>) => o as Record<string, FormDataEntryValue>;

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    await check("Validación: texto no numérico, escala fuera de 1–5, fecha inválida y lista fuera de catálogo se rechazan (nunca se vuelven 0)", () => {
      const bad = (id: string, o: Record<string, string>, frag: string) => {
        const e = parseForm(def(id), fd(o)).errors.join(" | ");
        if (!e.includes(frag)) throw new Error(`${id}: esperaba «${frag}», obtuvo «${e}»`);
      };
      bad("7", { activityId: randomUUID(), impactLegal: "7" }, "Impacto legal");
      bad("7", { activityId: randomUUID(), probability: "abc" }, "Probabilidad");
      bad("10", { code: "A1", action: "x", startDate: "2026-13-45" }, "Inicio");
      bad("10", { code: "A1", action: "x", status: "inventado" }, "Estado");
      bad("8", { code: "" }, "Código: es obligatorio");
      bad("param", { reservePct: "150" }, "Reserva");
      const ok = parseForm(def("param"), fd({ reservePct: "10", workDaysPerWeek: "6,5" }));
      if (ok.values.reservePct !== "0.1000" || ok.values.workDaysPerWeek !== "6.5") throw new Error(JSON.stringify(ok.values));
    });

    studyId = await createStudy(app.db, owner, "Estudio de prueba captura");
    const areas = await listAreas(app.db, owner, studyId);
    const posId = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "S1", position: "Cajero", dataKind: "demo", headcount: 2, weeklyHours: 42 });
    await addActivity(app.db, owner, studyId, { code: "C-1", name: "Arqueo", positionId: posId, dataKind: "demo", calcMode: "per_event", scope: "per_employee", executions: 1, period: "day", unitsPerExecution: null, timeAvgMin: 10, planning: "planned" });
    const actId = (await listActivityVersions(app.db, owner, studyId))[0].id;
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);

    for (const [id, values] of [
      ["5", { activityId: actId, directMeasurement: "yes", hasIndicators: true }],
      ["6", { activityId: actId, situation: "s1_train" }],
      ["7", { activityId: actId, impactLegal: 5, probability: 3 }],
    ] as const) {
      await check(`Hoja ${id}: crea, relee, actualiza con la versión vista y detecta versión vieja (409)`, async () => {
        const d = def(id);
        if ((await saveRow(app.db, owner, studyId, d, { ...values }, null)) !== "created") throw new Error("no creó");
        if ((await saveRow(app.db, owner, studyId, d, { ...values }, null)) !== "exists") throw new Error("permitió duplicar la clave sin abrir la fila");
        const [row] = await listRows(app.db, owner, studyId, d);
        if (!row || row.version !== 1) throw new Error("fila no encontrada");
        if ((await saveRow(app.db, owner, studyId, d, { ...values }, row.version)) !== "updated") throw new Error("no actualizó");
        if ((await saveRow(app.db, owner, studyId, d, { ...values }, row.version)) !== "conflict") throw new Error("aceptó versión vieja");
      });
    }

    await check("Hoja 8: escalas fuera de rango las rechaza la base (23514) y el código duplicado no se duplica", async () => {
      const d = def("8");
      await rejects(saveRow(app.db, owner, studyId, d, { code: "O-1", dataKind: "demo", impactScore: 9 }, null), "23514");
      if ((await saveRow(app.db, owner, studyId, d, { code: "O-1", dataKind: "demo", impactScore: 4 }, null)) !== "created") throw new Error("no creó");
      if ((await saveRow(app.db, owner, studyId, d, { code: "O-1", dataKind: "demo" }, null)) !== "exists") throw new Error("duplicó");
    });

    await check("Hoja 9 y 10: rediseño por (tipo, área, cargo) y plan con fechas incoherentes rechazado", async () => {
      const r = { dataKind: "demo", areaId: areas.find((a) => a.name === "Cajas")!.id, currentPositionName: "Cajero", hoursOutPerWeek: "2" };
      if ((await saveRow(app.db, owner, studyId, def("9"), r, null)) !== "created") throw new Error("rediseño");
      await rejects(saveRow(app.db, owner, studyId, def("10"), { code: "P-1", dataKind: "demo", action: "x", startDate: "2026-02-01", endDate: "2026-01-01" }, null), "23514");
    });

    await check("Parámetros: se actualizan con control de versión y la reserva se guarda como fracción", async () => {
      const d = def("param");
      const [row] = await listRows(app.db, owner, studyId, d);
      const p = parseForm(d, fd({ reservePct: "15" })).values;
      if ((await saveRow(app.db, owner, studyId, d, p, row.version)) !== "updated") throw new Error("no actualizó");
      const [after] = await listRows(app.db, owner, studyId, d);
      if (Number(after.reservePct) !== 0.15) throw new Error(String(after.reservePct));
    });

    await check("Un viewer no puede escribir (42501) ni borrar; el owner borra y queda auditoría", async () => {
      await rejects(saveRow(app.db, viewer, studyId, def("8"), { code: "V-1", dataKind: "demo" }, null), "42501");
      const [row] = await listRows(app.db, owner, studyId, def("8"));
      if (await deleteRow(app.db, viewer, studyId, def("8"), String(row.id))) throw new Error("el viewer borró");
      if (!(await deleteRow(app.db, owner, studyId, def("8"), String(row.id)))) throw new Error("el owner no pudo borrar");
      const a = await admin.db.execute(sql`select action, count(*)::int n from public.audit_log where study_id = ${studyId} and origin = 'app' group by action`);
      const by = Object.fromEntries((a as unknown as { action: string; n: number }[]).map((x) => [x.action, x.n]));
      if (!by.insert || !by.update || !by.delete) throw new Error(JSON.stringify(by));
    });

    await check("Las definiciones de hoja no repiten claves de campo", () => {
      for (const s of SHEETS) if (new Set(s.fields.map((f) => f.key)).size !== s.fields.length) throw new Error(`claves repetidas en ${s.id}`);
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
