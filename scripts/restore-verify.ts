/**
 * Prueba de restauración (brief F6), paso 3: sobre la base RESTAURADA desde pg_dump comprueba que
 *  1) cada tabla tiene exactamente las mismas filas que el origen;  2) las políticas RLS y el RLS forzado siguen presentes;
 *  3) el aislamiento por usuario funciona (dueño ve, viewer lee pero no escribe, ajeno no ve nada);  4) los resultados calculados son idénticos (indicadores del estudio).
 * Variables: RESTORE_ADMIN_URL y RESTORE_APP_URL (base restaurada); restore-expected.json (guardado al sembrar el origen).
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { loadDashboard } from "../src/server/dashboard-data";
import { check, rejects, summary } from "../tests/helpers";

const exp = JSON.parse(readFileSync("restore-expected.json", "utf8")) as { studyId: string; owner: string; viewer: string; outsider: string; kpis: Record<string, number | null>; counts: Record<string, number>; policies: number };

async function main() {
  const admin = createDb(process.env.RESTORE_ADMIN_URL!, 2), app = createDb(process.env.RESTORE_APP_URL!, 4);
  try {
    await check(`La copia restaurada tiene las mismas filas en las ${Object.keys(exp.counts).length} tablas`, async () => {
      const bad: string[] = [];
      for (const [t, n] of Object.entries(exp.counts)) {
        const got = Number(((await admin.db.execute(sql.raw(`select count(*)::int n from public."${t}"`))) as unknown as { n: number }[])[0].n);
        if (got !== n) bad.push(`${t}: original ${n}, restaurada ${got}`);
      }
      if (bad.length) throw new Error(bad.join("; "));
    });
    await check("Las políticas RLS y el RLS forzado se restauraron", async () => {
      const p = Number(((await admin.db.execute(sql`select count(*)::int n from pg_policies where schemaname = 'public'`)) as unknown as { n: number }[])[0].n);
      if (p !== exp.policies) throw new Error(`políticas: original ${exp.policies}, restaurada ${p}`);
      const off = (await admin.db.execute(sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity`)) as unknown as { relname: string }[];
      if (off.length) throw new Error(`sin RLS forzado: ${off.map((x) => x.relname).join(", ")}`);
    });
    await check("Las funciones de seguridad y las funciones sin sesión (SECURITY DEFINER) siguen existiendo", async () => {
      const f = (await admin.db.execute(sql`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('private','public')`)) as unknown as { n: number }[];
      if (Number(f[0].n) < 8) throw new Error(`funciones SECURITY DEFINER: ${f[0].n}`);
    });
    await check("Aislamiento tras restaurar: el dueño ve su estudio, el ajeno no ve nada y el viewer no puede escribir", async () => {
      const seen = async (sub: string) => Number(((await withRls(app.db, { sub }, (tx) => tx.execute(sql`select count(*)::int n from public.activities where study_id = ${exp.studyId}`))) as unknown as { n: number }[])[0].n);
      if ((await seen(exp.owner)) !== 2 || (await seen(exp.viewer)) !== 2) throw new Error("el dueño y el viewer deben ver las 2 actividades");
      if ((await seen(exp.outsider)) !== 0) throw new Error("el ajeno ve datos");
      await rejects(withRls(app.db, { sub: exp.viewer }, (tx) => tx.execute(sql`insert into public.areas (study_id, name, sort_order) values (${exp.studyId}, 'No debe', 99)`)), "42501");
    });
    await check("Los resultados calculados desde la copia restaurada son idénticos a los del original (indicadores del estudio)", async () => {
      const k = (await loadDashboard(app.db, exp.owner, exp.studyId, "all")).analysis.kpis;
      for (const [key, v] of Object.entries(exp.kpis)) if (JSON.stringify(k[key as keyof typeof k]) !== JSON.stringify(v)) throw new Error(`${key}: original ${JSON.stringify(v)}, restaurada ${JSON.stringify(k[key as keyof typeof k])}`);
    });
  } finally { await admin.client.end(); await app.client.end(); }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
