import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { addActivity, addPosition, createStudy } from "../src/server/studies";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/** Fase 6: matriz de RLS sobre TODAS las tablas del esquema public. No deja datos. */
type R = Record<string, unknown>;
const rows = (x: unknown) => x as R[];

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), outsider = randomUUID();
  for (const id of [owner, outsider]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    const tables = rows(await admin.db.execute(sql`
      select c.relname as name, c.relrowsecurity as rls,
        exists (select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname and k.column_name='study_id') as has_study
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname not like '\_\_drizzle%' order by 1`));
    await check(`Las ${tables.length} tablas de public tienen RLS activo`, () => {
      const off = tables.filter((t) => !t.rls).map((t) => t.name);
      if (off.length) throw new Error(`sin RLS: ${off.join(", ")}`);
    });

    studyId = await createStudy(app.db, owner, "Estudio matriz RLS");
    const pos = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "S", position: "P", dataKind: "demo", headcount: 1, weeklyHours: 40 });
    await addActivity(app.db, owner, studyId, { code: "M-1", name: "x", positionId: pos, dataKind: "demo", calcMode: "per_event", scope: "per_employee", executions: 1, period: "day", unitsPerExecution: null, timeAvgMin: 5, planning: "planned" });

    const count = (sub: string, t: string, by: string) => withRls(app.db, { sub }, async (tx) =>
      Number(rows(await tx.execute(sql.raw(`select count(*)::int n from public."${t}" where ${by} = '${studyId}'`)))[0].n));

    await check("Un usuario ajeno ve 0 filas del estudio en cada tabla; el dueño ve sus datos", async () => {
      const seen: string[] = [];
      for (const t of tables) {
        const by = t.has_study ? "study_id" : t.name === "studies" ? "id" : "";
        if (!by) continue; // tablas sin study_id propio se cubren con las demás por clave foránea
        if ((await count(outsider, String(t.name), by)) !== 0) throw new Error(`${t.name}: el ajeno ve filas`);
        if ((await count(owner, String(t.name), by)) > 0) seen.push(String(t.name));
      }
      for (const must of ["studies", "memberships", "areas", "positions", "activities", "study_parameters"]) if (!seen.includes(must)) throw new Error(`el dueño no ve ${must}`);
    });

    await check("Un ajeno no puede borrar filas de ninguna tabla con study_id", async () => {
      for (const t of tables.filter((x) => x.has_study)) {
        const name = String(t.name);
        // Denegado por privilegio (p. ej. audit_log es de solo anexar) o por RLS (0 filas): ambos son correctos.
        let gone = 0;
        try { gone = rows(await withRls(app.db, { sub: outsider }, (tx) => tx.execute(sql.raw(`delete from public."${name}" where study_id = '${studyId}' returning 1`)))).length; } catch { gone = 0; }
        if (gone) throw new Error(`${name}: el ajeno borró filas`);
      }
      const still = await count(owner, "activities", "study_id");
      if (still !== 1) throw new Error("se perdió la actividad");
    });

    await check("app_user no es superusuario ni tiene BYPASSRLS", async () => {
      const r = rows(await admin.db.execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'`))[0];
      if (!r || r.rolsuper || r.rolbypassrls) throw new Error(JSON.stringify(r));
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${outsider})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
