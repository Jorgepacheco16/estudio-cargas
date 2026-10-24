/**
 * Prueba de restauración (brief F6), paso 1: siembra en la base ORIGEN un estudio completo (cargo, actividades, evaluaciones, medición, foto,
 * propuesta del agente, conexión de hoja) y guarda en restore-expected.json lo que la copia restaurada debe reproducir.
 * Solo corre contra la base de CI (PostgreSQL local), nunca contra Supabase.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy, listActivityVersions } from "../src/server/studies";
import { saveRow, sheetById } from "../src/server/capture";
import { addMeasurement, takeSnapshot } from "../src/server/history";
import { connectSheet } from "../src/server/sheets/sync";
import { loadDashboard } from "../src/server/dashboard-data";
import { URL_ADMIN, URL_APP, refuseHostedDb } from "../tests/helpers";

async function main() {
  refuseHostedDb();
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  for (const id of [owner, viewer, outsider]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  const studyId = await createStudy(app.db, owner, "Estudio para la prueba de restauración");
  await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
  for (const [site, n] of [["Norte", 2], ["Sur", 4]] as const) {
    const p = await addPosition(app.db, owner, studyId, { area: "Cajas", site, position: "Cajero", dataKind: "real", headcount: n, weeklyHours: 42 });
    await addActivity(app.db, owner, studyId, { code: `R-${site}`, name: "Arqueo", positionId: p, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 4, period: "day", unitsPerExecution: null, timeAvgMin: 5, planning: "planned" });
  }
  const acts = await listActivityVersions(app.db, owner, studyId);
  await saveRow(app.db, owner, studyId, sheetById("5")!, { activityId: acts[0].id, directMeasurement: "yes", hasIndicators: true, hasHistory: "yes", hasTimeStandard: true, sourceReliability: "high", resultVerifiable: "yes" }, null);
  await saveRow(app.db, owner, studyId, sheetById("7")!, { activityId: acts[0].id, impactLegal: 5, probability: 3, peopleWhoCanExecute: 1 }, null);
  await saveRow(app.db, owner, studyId, sheetById("8")!, { code: "OP-1", dataKind: "real", findingClass: "confirmed", evidence: "registro", recoverableHoursPerWeek: "2", impactScore: 4, easeScore: 3, effortScore: 2, costScore: 2, riskScore: 2 }, null);
  await addMeasurement(app.db, owner, studyId, { activityId: acts[0].id, observedAt: new Date(), unitsProcessed: 10, personHours: 1, method: "timed", observer: null });
  await takeSnapshot(app.db, owner, studyId, "Foto de la prueba de restauración");
  await connectSheet(app.db, owner, studyId, `restore-${randomUUID()}`, "bidirectional");
  const kpis = (await loadDashboard(app.db, owner, studyId, "all")).analysis.kpis;

  const tables = (await admin.db.execute(sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)) as unknown as { name: string }[];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t.name] = Number(((await admin.db.execute(sql.raw(`select count(*)::int n from public."${t.name}"`))) as unknown as { n: number }[])[0].n);
  const policies = Number(((await admin.db.execute(sql`select count(*)::int n from pg_policies where schemaname = 'public'`)) as unknown as { n: number }[])[0].n);
  writeFileSync("restore-expected.json", JSON.stringify({ studyId, owner, viewer, outsider, kpis, counts, policies }, null, 1));
  console.log(`Sembrado: ${Object.values(counts).reduce((a, b) => a + b, 0)} filas en ${tables.length} tablas, ${policies} políticas, actividades ${kpis.activities}, horas ${kpis.hours}`);
  await admin.client.end(); await app.client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
