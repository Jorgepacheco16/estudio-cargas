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
import { saveEntry } from "../src/server/entry/service";
import { entryDef, type EntryId } from "../src/server/entry/defs";
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
  const put = async (id: EntryId, byField: Record<string, string>) => {
    const d = entryDef(id)!, raw: Record<string, string> = {};
    for (const [f, v] of Object.entries(byField)) raw[d.fields.find((x) => x.field === f)!.col] = v;
    const r = await saveEntry(app.db, owner, studyId, id, raw, {});
    if (!r.ok) throw new Error(`siembra hoja ${id}: ${r.errors.join("; ")}`);
  };
  await put("5", { code: "R-Norte", direct: "Sí", hasIndicators: "Sí", hasHistory: "Sí", hasStandard: "Sí", reliability: "Alta", verifiable: "Sí" });
  await put("7", { code: "R-Norte", impLegal: "5", probability: "3", people: "1" });
  await put("8", { kind: "REAL", code: "OP-1", finding: "Hallazgo confirmado", evidence: "registro", hours: "2", impact: "4", ease: "3", effort: "2", cost: "2", riskScore: "2" });
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
