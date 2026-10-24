import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy } from "../src/server/studies";
import { buildBackup } from "../src/server/backup";
import { toXlsx } from "../src/lib/export";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/** Respaldo completo en Excel: trae todas las tablas del estudio, respeta los permisos y se puede releer. */
async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const [owner, viewer, outsider] = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of [owner, viewer, outsider]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio del respaldo");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    const p = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "S1", position: "Cajero", dataKind: "real", headcount: 2, weeklyHours: 42 });
    await addActivity(app.db, owner, studyId, { code: "B-1", name: "=1+1", positionId: p, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 4, period: "day", unitsPerExecution: null, timeAvgMin: 5, planning: "planned" });

    await check("El respaldo incluye una hoja por tabla de datos con las mismas filas que la base, y un «Léame»", async () => {
      const b = (await buildBackup(app.db, owner, studyId))!;
      const names = b.tables.map((t) => t.name);
      for (const n of ["Léame", "Parámetros", "Áreas", "Cargos", "Dotación", "Actividades", "7 Riesgos", "Mediciones"]) if (!names.includes(n)) throw new Error(`falta ${n}`);
      const count = async (t: string) => Number(((await admin.db.execute(sql.raw(`select count(*)::int n from public.${t} where study_id = '${studyId}'`))) as unknown as { n: number }[])[0].n);
      for (const [hoja, tabla] of [["Áreas", "areas"], ["Cargos", "positions"], ["Dotación", "staffing_entries"], ["Actividades", "activities"], ["Parámetros", "study_parameters"]] as const) {
        const got = b.tables.find((t) => t.name === hoja)!.rows.length;
        if (got !== (await count(tabla))) throw new Error(`${hoja}: ${got} ≠ ${await count(tabla)}`);
      }
    });
    await check("El archivo Excel se relee, conserva los datos y un texto que empieza con «=» queda como texto", async () => {
      const b = (await buildBackup(app.db, owner, studyId))!;
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await toXlsx(b.tables, "t")) as unknown as ArrayBuffer);
      const ws = wb.getWorksheet("Actividades")!;
      const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
      const row = (ws.getRow(2).values as unknown[]).slice(1);
      if (row[header.indexOf("name")] !== "=1+1" || row[header.indexOf("code")] !== "B-1") throw new Error("datos de la actividad");
    });
    await check("Permisos: un viewer puede descargar el respaldo; quien no pertenece al estudio no obtiene nada", async () => {
      if (!(await buildBackup(app.db, viewer, studyId))) throw new Error("el viewer debe poder");
      if ((await buildBackup(app.db, outsider, studyId)) !== null) throw new Error("un ajeno obtuvo el respaldo");
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer}, ${outsider})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
