import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * Matriz de permisos (brief §18.1 «roles × tablas × operaciones»), en dos niveles:
 * 1) estática: las políticas de cada una de las tablas de public tienen exactamente la regla esperada por operación;
 * 2) de comportamiento: owner, editor, analyst, viewer y ajeno ejecutan SELECT/INSERT/UPDATE/DELETE reales y el resultado coincide con la matriz.
 */
type Row = Record<string, unknown>;
const rows = (x: unknown) => x as Row[];
const CMDS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const users = { owner: randomUUID(), editor: randomUUID(), analyst: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  for (const id of Object.values(users)) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    const pol = rows(await admin.db.execute(sql`select tablename, cmd, roles::text as roles, coalesce(qual,'') q, coalesce(with_check,'') wc from pg_policies where schemaname = 'public'`));
    const tables = rows(await admin.db.execute(sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_\_drizzle%' order by 1`)).map((t) => String(t.name));
    const of = (t: string, cmd: string) => pol.filter((p) => p.tablename === t && p.cmd === cmd);
    const text = (t: string, cmd: string) => of(t, cmd).map((p) => `${p.q} ${p.wc}`).join(" ");

    await check(`Estática · las ${tables.length} tablas tienen política para cada operación con la regla esperada (can_read / can_write / is_owner), solo para «authenticated»`, () => {
      const bad: string[] = [];
      for (const t of tables) {
        for (const cmd of CMDS) {
          const ps = of(t, cmd);
          if (t === "audit_log" && (cmd === "UPDATE" || cmd === "DELETE")) { if (ps.length) bad.push(`${t}.${cmd} debería no existir (bitácora de solo anexar)`); continue; }
          if (ps.length === 0) { bad.push(`${t}.${cmd} sin política`); continue; }
          if (ps.some((p) => p.roles !== "{authenticated}")) bad.push(`${t}.${cmd} aplica a otro rol`);
          // D-91: por módulo, can_read_m / can_write_m contienen can_read / can_write; la administración (usuarios, roles, invitaciones, áreas de cada persona) es solo de quien administra (is_owner).
          const want = ["memberships", "invitations", "member_areas"].includes(t) ? "is_owner" : ["roles", "role_permissions"].includes(t) ? (cmd === "SELECT" ? "can_read" : "is_owner") : t === "studies" ? "" : cmd === "SELECT" ? "can_read" : "can_write";
          if (want && !text(t, cmd).includes(want)) bad.push(`${t}.${cmd}: esperaba ${want}, tiene «${text(t, cmd).slice(0, 80)}»`);
        }
      }
      if (bad.length) throw new Error(bad.join("; "));
    });

    await check("Estática · la bitácora (audit_log) no admite UPDATE ni DELETE ni siquiera por privilegio, y exige que el actor sea quien escribe", async () => {
      const g = rows(await admin.db.execute(sql`select has_table_privilege('authenticated','public.audit_log','UPDATE') u, has_table_privilege('authenticated','public.audit_log','DELETE') d, has_table_privilege('authenticated','public.audit_log','INSERT') i`))[0];
      if (g.u || g.d || !g.i) throw new Error(JSON.stringify(g));
      if (!text("audit_log", "INSERT").includes("actor_id")) throw new Error("el INSERT no ata el actor al usuario");
    });

    await check("Estática · app_user no puede saltarse RLS: sin SUPERUSER, BYPASSRLS ni pertenencia a roles con esos atributos; las tablas tienen RLS forzado", async () => {
      const r = rows(await admin.db.execute(sql`select rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = 'app_user'`))[0];
      if (r.rolsuper || r.rolbypassrls || r.rolinherit) throw new Error(JSON.stringify(r));
      const off = rows(await admin.db.execute(sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_\_drizzle%' and not c.relforcerowsecurity`)).map((x) => x.relname);
      if (off.length) throw new Error(`RLS no forzado en: ${off.join(", ")}`);
    });

    studyId = await createStudy(app.db, users.owner, "Estudio matriz de permisos");
    for (const r of ["editor", "analyst", "viewer"] as const) await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${users[r]}, ${r})`);
    const exec = (who: keyof typeof users, q: ReturnType<typeof sql>) => withRls(app.db, { sub: users[who] }, async (tx) => rows(await tx.execute(q)));
    const outcome = async (who: keyof typeof users, q: ReturnType<typeof sql>): Promise<"ok" | "denegado" | "0 filas"> => {
      try { const r = await exec(who, q); return r.length ? "ok" : "0 filas"; } catch (e) { const c = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code; if (c === "42501") return "denegado"; throw e; }
    };

    const matrix: Record<string, Record<(typeof CMDS)[number], Record<keyof typeof users, "ok" | "denegado" | "0 filas">>> = {};
    const W = { owner: "ok", editor: "ok", analyst: "ok", viewer: "denegado", outsider: "denegado" } as const;
    const WR = { owner: "ok", editor: "ok", analyst: "ok", viewer: "0 filas", outsider: "0 filas" } as const;
    const RD = { owner: "ok", editor: "ok", analyst: "ok", viewer: "ok", outsider: "0 filas" } as const;
    matrix.areas = { SELECT: RD, INSERT: W, UPDATE: WR, DELETE: WR };

    await check("Comportamiento · tabla «areas»: roles × operaciones (owner, editor y analyst escriben; viewer solo lee; ajeno no ve nada)", async () => {
      const bad: string[] = [];
      for (const who of Object.keys(users) as (keyof typeof users)[]) {
        const name = `Área ${who} ${randomUUID().slice(0, 6)}`;
        const got = {
          INSERT: await outcome(who, sql`insert into public.areas (study_id, name, sort_order) values (${studyId}, ${name}, 99) returning id`),
          SELECT: await outcome(who, sql`select id from public.areas where study_id = ${studyId} limit 1`),
          UPDATE: await outcome(who, sql`update public.areas set sort_order = 98 where study_id = ${studyId} and name = ${name} returning id`),
          DELETE: await outcome(who, sql`delete from public.areas where study_id = ${studyId} and name = ${name} returning id`),
        };
        // El INSERT de quien no puede escribir se deniega (42501), así que UPDATE/DELETE de su propia fila no existe: para ellos se prueba sobre una fila del dueño.
        if (!["owner", "editor", "analyst"].includes(who)) {
          got.UPDATE = await outcome(who, sql`update public.areas set sort_order = 98 where study_id = ${studyId} and name = 'Cajas' returning id`);
          got.DELETE = await outcome(who, sql`delete from public.areas where study_id = ${studyId} and name = 'Cajas' returning id`);
        }
        for (const cmd of CMDS) if (got[cmd] !== matrix.areas[cmd][who]) bad.push(`${who}.${cmd}: obtuvo ${got[cmd]}, esperaba ${matrix.areas[cmd][who]}`);
      }
      if (bad.length) throw new Error(bad.join("; "));
      const still = rows(await admin.db.execute(sql`select count(*)::int n from public.areas where study_id = ${studyId} and name = 'Cajas'`))[0].n;
      if (still !== 1) throw new Error("un rol sin permiso borró datos");
    });

    await check("Comportamiento · membresías: solo el propietario agrega, cambia o quita miembros; nadie se autoasigna propietario", async () => {
      const bad: string[] = [];
      for (const who of ["editor", "analyst", "viewer", "outsider"] as const) {
        const r1 = await outcome(who, sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${users[who]}, 'owner') on conflict do nothing returning id`);
        if (r1 === "ok") bad.push(`${who} se autoasignó propietario`);
        const r2 = await outcome(who, sql`update public.memberships set role = 'owner' where study_id = ${studyId} and user_id = ${users[who]} returning id`);
        if (r2 === "ok") bad.push(`${who} subió su propio rol`);
        const r3 = await outcome(who, sql`delete from public.memberships where study_id = ${studyId} and user_id = ${users.viewer} returning id`);
        if (r3 === "ok" && who !== "viewer") bad.push(`${who} quitó a otro miembro`);
      }
      const roles = rows(await admin.db.execute(sql`select user_id, role from public.memberships where study_id = ${studyId}`));
      if (roles.some((m) => m.role === "owner" && m.user_id !== users.owner)) bad.push("hay un propietario no autorizado");
      if (bad.length) throw new Error(bad.join("; "));
    });

    await check("Comportamiento · bitácora: un usuario no puede escribir a nombre de otro ni editar o borrar la bitácora; el viewer la lee", async () => {
      const ins = (who: keyof typeof users, actor: string) => outcome(who, sql`insert into public.audit_log (study_id, actor_id, origin, action, entity) values (${studyId}, ${actor}, 'app', 'insert', 'prueba') returning id`);
      if ((await ins("editor", users.editor)) !== "ok") throw new Error("el editor no pudo escribir su propia entrada");
      if ((await ins("editor", users.owner)) === "ok") throw new Error("el editor escribió a nombre del propietario");
      if ((await ins("viewer", users.viewer)) === "ok") throw new Error("el viewer escribió en la bitácora");
      for (const who of ["owner", "editor"] as const) {
        if ((await outcome(who, sql`update public.audit_log set action = 'x' where study_id = ${studyId} returning id`)) === "ok") throw new Error(`${who} editó la bitácora`);
        if ((await outcome(who, sql`delete from public.audit_log where study_id = ${studyId} returning id`)) === "ok") throw new Error(`${who} borró la bitácora`);
      }
      if ((await outcome("viewer", sql`select id from public.audit_log where study_id = ${studyId} limit 1`)) !== "ok") throw new Error("el viewer no puede leer la bitácora");
    });

    await check("Comportamiento · un estudio ajeno es invisible en todas las tablas con study_id para viewer y ajeno (0 filas), y el dueño sí ve sus datos", async () => {
      const bad: string[] = [];
      for (const t of tables) {
        const has = rows(await admin.db.execute(sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = ${t} and column_name = 'study_id'`)).length > 0;
        if (!has) continue;
        const q = sql.raw(`select 1 from public."${t}" where study_id = '${studyId}' limit 1`);
        if ((await outcome("outsider", q)) === "ok") bad.push(`ajeno ve ${t}`);
      }
      if (bad.length) throw new Error(bad.join("; "));
      if ((await outcome("owner", sql`select 1 from public.study_parameters where study_id = ${studyId}`)) !== "ok") throw new Error("el dueño no ve sus parámetros");
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${sql.join(Object.values(users).map((u) => sql`${u}`), sql`, `)})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
