import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { listRoles, saveRole } from "../src/server/access";
import { listOrdersTx, saveDayOrder, MAX_ORDERS_PER_STUDY } from "../src/server/schedule-order";
import { orderKey } from "../src/domain/schedule";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-104 — orden guardado de las tareas del Reparto semanal, con PostgreSQL real. Es una preferencia de esa vista: lo ve quien tiene «Resultados» (Lectura o Edición), lo cambia quien lo
 * tiene en Edición, nadie ajeno al estudio lo ve, no se puede escribir a nombre de otra persona, las restricciones de la tabla rechazan datos malos y no toca el estudio. No deja datos.
 */
const KEY = "real|cajas|co1|cajero";
const base = { positionKey: KEY, week: "common" as const, person: 1, weekday: 0 };
/** SQLSTATE de un error de PostgreSQL (drizzle lo envuelve en «Failed query»). */
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { const x = e as { code?: string; cause?: { code?: string } }; return x.cause?.code ?? x.code ?? "error"; }
}

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), lee = randomUUID(), edita = randomUUID(), sin = randomUUID(), ajeno = randomUUID(), otroDueno = randomUUID();
  for (const id of [owner, lee, edita, sin, ajeno, otroDueno]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "", otroEstudio = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba orden del reparto");
    otroEstudio = await createStudy(app.db, otroDueno, "Otro estudio");
    const roleId = async (name: string) => (await listRoles(app.db, owner, studyId)).find((r) => r.name === name)!.id;
    const r1 = await saveRole(app.db, owner, studyId, { name: "Lee resultados", perms: { resultados: "read" } });
    const r2 = await saveRole(app.db, owner, studyId, { name: "Edita resultados", perms: { resultados: "edit" } });
    if (!r1.ok || !r2.ok) throw new Error("no se pudieron crear los roles de prueba");
    for (const [u, name] of [[lee, "Lee resultados"], [edita, "Edita resultados"], [sin, "Editor"]] as const) {
      await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role, role_id) values (${studyId}, ${u}, 'viewer', ${await roleId(name)})`);
    }
    const leer = (who: string, study = studyId) => withRls(app.db, { sub: who }, (tx) => listOrdersTx(tx, study));
    const contar = async (tabla: string) => Number(((await admin.db.execute(sql.raw(`select count(*)::int n from public.${tabla} where study_id = '${studyId}'`))) as unknown as { n: number }[])[0].n);

    await check("La tabla tiene la seguridad por filas activada y forzada, sus cuatro políticas y sus restricciones", async () => {
      const t = (await admin.db.execute(sql`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.schedule_orders'::regclass`)) as unknown as { relrowsecurity: boolean; relforcerowsecurity: boolean }[];
      if (!t[0].relrowsecurity || !t[0].relforcerowsecurity) throw new Error("RLS no activada o no forzada");
      const pol = (await admin.db.execute(sql`select cmd from pg_policies where schemaname = 'public' and tablename = 'schedule_orders' order by cmd`)) as unknown as { cmd: string }[];
      if (pol.map((p) => p.cmd).join() !== "DELETE,INSERT,SELECT,UPDATE") throw new Error("políticas: " + pol.map((p) => p.cmd).join());
      const ck = (await admin.db.execute(sql`select conname from pg_constraint where conrelid = 'public.schedule_orders'::regclass order by conname`)) as unknown as { conname: string }[];
      for (const c of ["schedule_orders_uq", "schedule_orders_week_ck", "schedule_orders_person_ck", "schedule_orders_day_ck", "schedule_orders_codes_ck", "schedule_orders_key_ck", "schedule_orders_study_id_studies_id_fk"]) if (!ck.some((x) => x.conname === c)) throw new Error("falta " + c);
    });

    await check("El Super usuario guarda un orden, lo cambia (se reemplaza, no se duplica) y, al volver al sugerido (lista vacía), se quita", async () => {
      const a = await saveDayOrder(app.db, owner, studyId, { ...base, codes: ["E-3", "E-1"] });
      if (!a.ok || a.removed) throw new Error(JSON.stringify(a));
      const m = await leer(owner), k = orderKey(KEY, "common", 1, 0);
      if (m.size !== 1 || m.get(k)?.codes.join() !== "E-3,E-1" || !/^\d{4}-\d\d-\d\dT/.test(m.get(k)!.at)) throw new Error(JSON.stringify([...m]));
      const b = await saveDayOrder(app.db, owner, studyId, { ...base, codes: ["E-1", "E-3", "E-9"] });
      if (!b.ok || (await leer(owner)).size !== 1 || (await leer(owner)).get(k)!.codes.join() !== "E-1,E-3,E-9") throw new Error("debía reemplazar el orden");
      // otra persona, otro día, otra semana y otro cargo son órdenes distintos
      for (const o of [{ ...base, person: 2 }, { ...base, weekday: 3 }, { ...base, week: "periodic" as const }, { ...base, positionKey: "real|cajas|co1|auxiliar" }]) if (!(await saveDayOrder(app.db, owner, studyId, { ...o, codes: ["X-1"] })).ok) throw new Error("no guardó " + JSON.stringify(o));
      if ((await leer(owner)).size !== 5) throw new Error("debían ser 5 órdenes distintos: " + (await leer(owner)).size);
      const c = await saveDayOrder(app.db, owner, studyId, { ...base, codes: [] });
      if (!c.ok || !c.removed || (await leer(owner)).size !== 4 || (await leer(owner)).has(k)) throw new Error("debía quitar el orden");
    });

    await check("Quien tiene «Resultados» en Lectura lo ve pero no lo cambia (la base lo rechaza); en Edición lo cambia y queda como autor", async () => {
      const visto = await leer(lee);
      if (visto.size !== 4) throw new Error("con Lectura debía ver los 4 órdenes: " + visto.size);
      const w = await saveDayOrder(app.db, lee, studyId, { ...base, codes: ["Z-1"] });
      if (w.ok) throw new Error("con Lectura no debía poder guardar");
      if (await code(withRls(app.db, { sub: lee }, (tx) => tx.execute(sql`insert into public.schedule_orders (study_id, position_key, week_kind, person, day, codes, updated_by) values (${studyId}, 'x', 'common', 1, 0, array['A'], ${lee})`))) !== "42501") throw new Error("la base debía rechazar con 42501");
      const del = (await withRls(app.db, { sub: lee }, (tx) => tx.execute(sql`delete from public.schedule_orders where study_id = ${studyId} returning id`))) as unknown as unknown[];
      if (del.length !== 0 || (await leer(owner)).size !== 4) throw new Error("con Lectura no debía borrar nada");
      const e = await saveDayOrder(app.db, edita, studyId, { ...base, codes: ["B-1", "A-1"] });
      if (!e.ok) throw new Error("con Edición debía poder guardar: " + JSON.stringify(e));
      const autor = (await admin.db.execute(sql`select updated_by from public.schedule_orders where study_id = ${studyId} and position_key = ${KEY} and person = 1 and day = 0 and week_kind = 'common'`)) as unknown as { updated_by: string }[];
      if (autor[0].updated_by !== edita) throw new Error("el autor debía ser quien guardó");
    });

    await check("No se puede escribir a nombre de otra persona: la base rechaza un updated_by que no es el de quien escribe", async () => {
      const c = await code(withRls(app.db, { sub: edita }, (tx) => tx.execute(sql`insert into public.schedule_orders (study_id, position_key, week_kind, person, day, codes, updated_by) values (${studyId}, 'otro', 'common', 1, 0, array['A'], ${owner})`)));
      if (c !== "42501") throw new Error("debía rechazar con 42501 y dio " + c);
      const u = await code(withRls(app.db, { sub: edita }, (tx) => tx.execute(sql`update public.schedule_orders set updated_by = ${owner} where study_id = ${studyId} returning id`)));
      if (u !== "42501") throw new Error("no debía poder cambiar el autor a otra persona (42501) y dio " + u);
    });

    await check("Sin «Resultados» (rol Editor) y fuera del estudio no se ve nada ni se escribe; otro estudio no ve el nuestro", async () => {
      for (const quien of [sin, ajeno, otroDueno]) {
        if ((await leer(quien)).size !== 0) throw new Error("no debía ver órdenes ajenos");
        const w = await saveDayOrder(app.db, quien, studyId, { ...base, codes: ["Q-1"] });
        if (w.ok) throw new Error("no debía poder guardar");
      }
      if ((await leer(otroDueno, otroEstudio)).size !== 0) throw new Error("el otro estudio no tiene órdenes");
      if (!(await saveDayOrder(app.db, otroDueno, otroEstudio, { ...base, codes: ["P-1"] })).ok || (await leer(otroDueno, otroEstudio)).size !== 1) throw new Error("el otro estudio guarda lo suyo");
      if ((await leer(owner)).size !== 5 && (await leer(owner)).size !== 4) throw new Error("lo del otro estudio no debe mezclarse");
      for (const q of [...(await leer(owner)).values()]) if (q.codes.includes("P-1")) throw new Error("se mezclaron estudios");
    });

    await check("Datos malos: la validación y las restricciones de la tabla los rechazan y no se guarda nada", async () => {
      const antes = (await leer(owner)).size;
      const malos: unknown[] = [
        { ...base, week: "otra" }, { ...base, person: 0 }, { ...base, person: 201 }, { ...base, weekday: 7 }, { ...base, weekday: -1 }, { ...base, positionKey: "" }, { ...base, positionKey: "x".repeat(401) },
        { ...base, codes: ["A", "A"] }, { ...base, codes: [""] }, { ...base, codes: ["x".repeat(61)] }, { ...base, codes: Array.from({ length: 101 }, (_, i) => `C-${i}`) }, { ...base, codes: ["a\nb"] }, { ...base, codes: "A" }, null, "texto", {},
      ];
      for (const m of malos) if ((await saveDayOrder(app.db, owner, studyId, m)).ok) throw new Error("debía rechazar " + JSON.stringify(m)?.slice(0, 80));
      if ((await leer(owner)).size !== antes) throw new Error("no debía guardar nada");
      const sqlMalo = (v: string) => code(admin.db.execute(sql.raw(`insert into public.schedule_orders (study_id, position_key, week_kind, person, day, codes, updated_by) values ('${studyId}', 'k', ${v}, '${owner}')`)));
      for (const [valores, ck] of [["'x', 1, 0, array['A']", "23514"], ["'common', 0, 0, array['A']", "23514"], ["'common', 1, 9, array['A']", "23514"], ["'common', 1, 0, array[]::text[]", "23514"]] as const) {
        const c = await sqlMalo(valores); if (c !== ck) throw new Error(`${valores}: se esperaba ${ck} y dio ${c}`);
      }
    });

    await check("Guardar un orden no toca el estudio: ninguna actividad, cargo ni registro de cambios se modifica", async () => {
      const antes = [await contar("activities"), await contar("positions"), await contar("audit_log")];
      for (let i = 0; i < 5; i++) await saveDayOrder(app.db, owner, studyId, { ...base, person: 10 + i, codes: ["N-1", "N-2"] });
      await saveDayOrder(app.db, owner, studyId, { ...base, person: 10, codes: [] });
      const despues = [await contar("activities"), await contar("positions"), await contar("audit_log")];
      if (antes.join() !== despues.join()) throw new Error(`el estudio cambió: ${antes} → ${despues}`);
    });

    await check("Tope por estudio: al llegar al máximo no se guardan órdenes nuevos, pero sí se puede cambiar uno que ya existe", async () => {
      const hoy = Number(((await admin.db.execute(sql`select count(*)::int n from public.schedule_orders where study_id = ${studyId}`)) as unknown as { n: number }[])[0].n);
      await admin.db.execute(sql`insert into public.schedule_orders (study_id, position_key, week_kind, person, day, codes, updated_by) select ${studyId}, 'relleno-' || g, 'common', 1, 0, array['A'], ${owner} from generate_series(1, ${MAX_ORDERS_PER_STUDY - hoy}) g`);
      const nuevo = await saveDayOrder(app.db, owner, studyId, { ...base, positionKey: "uno-mas", codes: ["Z-9"] });
      if (nuevo.ok || !/máximo/.test(nuevo.error)) throw new Error("debía rechazar uno nuevo: " + JSON.stringify(nuevo));
      const cambio = await saveDayOrder(app.db, owner, studyId, { ...base, positionKey: "relleno-1", codes: ["Z-8", "Z-7"] });
      if (!cambio.ok) throw new Error("cambiar uno existente siempre se puede");
      await admin.db.execute(sql`delete from public.schedule_orders where study_id = ${studyId} and position_key like 'relleno-%'`);
    });

    await check("Borrar el estudio borra sus órdenes guardados", async () => {
      await admin.db.execute(sql`delete from public.studies where id = ${otroEstudio}`);
      const n = Number(((await admin.db.execute(sql`select count(*)::int n from public.schedule_orders where study_id = ${otroEstudio}`)) as unknown as { n: number }[])[0].n);
      otroEstudio = "";
      if (n !== 0) throw new Error("quedaron órdenes huérfanos: " + n);
    });
  } finally {
    for (const s of [studyId, otroEstudio]) if (s) await admin.db.execute(sql`delete from public.studies where id = ${s}`);
    await admin.db.execute(sql`delete from public.memberships where user_id in (${lee}, ${edita}, ${sin})`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${lee}, ${edita}, ${sin}, ${ajeno}, ${otroDueno})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
