import { sql, eq, and } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import * as s from "../src/db/schema";
import { URL_ADMIN, URL_APP, check, summary, rejects, refuseHostedDb } from "./helpers";

refuseHostedDb(); // esta prueba hace TRUNCATE de studies y auth.users

const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222", U3 = "33333333-3333-4333-8333-333333333333", U4 = "44444444-4444-4444-8444-444444444444";
const admin = createDb(URL_ADMIN, 1), app = createDb(URL_APP, 1); // max=1 fuerza la reutilización de la MISMA conexión (prueba de no-fuga)

async function seed() {
  const a = admin.db;
  await a.execute(sql`truncate table public.studies cascade`); await a.execute(sql`truncate table auth.users cascade`);
  for (const id of [U1, U2, U3, U4]) await a.execute(sql`insert into auth.users (id) values (${id})`);
  const [A] = await a.insert(s.studies).values({ name: "Estudio A", createdBy: U1 }).returning();
  const [B] = await a.insert(s.studies).values({ name: "Estudio B", createdBy: U2 }).returning();
  await a.insert(s.memberships).values([{ studyId: A.id, userId: U1, role: "owner" }, { studyId: A.id, userId: U3, role: "viewer" }, { studyId: B.id, userId: U2, role: "owner" }]);
  const mk = async (study: typeof A, name: string) => {
    const [area] = await a.insert(s.areas).values({ studyId: study.id, name: "Cajas" }).returning();
    const [site] = await a.insert(s.sites).values({ studyId: study.id, name: "Sede 1" }).returning();
    const [pos] = await a.insert(s.positions).values({ studyId: study.id, areaId: area.id, siteId: site.id, name }).returning();
    const [act] = await a.insert(s.activities).values({ studyId: study.id, code: "ACT-1", positionId: pos.id, name: "Actividad" }).returning();
    return { area, site, pos, act };
  };
  return { A, B, a: await mk(A, "Cargo A"), b: await mk(B, "Cargo B") };
}

(async () => {
  const d = await seed();
  console.log("Pruebas de seguridad y consistencia (PostgreSQL real + Drizzle):");
  await check("El rol de la app NO puede leer tablas directamente (mínimo privilegio)", () => rejects(app.db.select().from(s.studies), "42501"));
  await check("Un owner solo ve sus estudios (A, no B)", async () => {
    const r = await withRls(app.db, { sub: U1 }, (tx) => tx.select().from(s.studies));
    if (r.length !== 1 || r[0].id !== d.A.id) throw new Error(`vio ${r.length} estudios`);
  });
  await check("Un usuario sin membresía no ve actividades de ningún estudio", async () => {
    const r = await withRls(app.db, { sub: U4 }, (tx) => tx.select().from(s.activities)); if (r.length !== 0) throw new Error(`vio ${r.length}`);
  });
  await check("Un viewer puede leer actividades de su estudio", async () => {
    const r = await withRls(app.db, { sub: U3 }, (tx) => tx.select().from(s.activities)); if (r.length !== 1) throw new Error(`vio ${r.length}`);
  });
  await check("Un viewer NO puede insertar actividades (42501)", () => rejects(withRls(app.db, { sub: U3 }, (tx) => tx.insert(s.activities).values({ studyId: d.A.id, code: "X-1", positionId: d.a.pos.id, name: "x" })), "42501"));
  await check("Un viewer NO puede actualizar (0 filas afectadas)", async () => {
    const r = await withRls(app.db, { sub: U3 }, (tx) => tx.update(s.activities).set({ name: "hack" }).where(eq(s.activities.id, d.a.act.id)).returning()); if (r.length !== 0) throw new Error("actualizó");
  });
  await check("Un owner de A NO puede escribir en el estudio B (42501)", () => rejects(withRls(app.db, { sub: U1 }, (tx) => tx.insert(s.activities).values({ studyId: d.B.id, code: "X-2", positionId: d.b.pos.id, name: "x" })), "42501"));
  await check("Un owner crea un estudio y su membresía (INSERT … RETURNING) y otro usuario no lo ve", async () => {
    const created = await withRls(app.db, { sub: U1 }, async (tx) => {
      const [st] = await tx.insert(s.studies).values({ name: "Nuevo", createdBy: U1 }).returning();
      await tx.insert(s.memberships).values({ studyId: st.id, userId: U1, role: "owner" }); return st;
    });
    const seen = await withRls(app.db, { sub: U2 }, (tx) => tx.select().from(s.studies).where(eq(s.studies.id, created.id))); if (seen.length) throw new Error("U2 lo vio");
  });
  await check("No se puede autoasignar como owner de un estudio ajeno (42501)", () => rejects(withRls(app.db, { sub: U4 }, (tx) => tx.insert(s.memberships).values({ studyId: d.A.id, userId: U4, role: "owner" })), "42501"));
  await check("Sin fuga: tras la transacción la misma conexión vuelve a app_user sin claims", async () => {
    await withRls(app.db, { sub: U1 }, (tx) => tx.select().from(s.studies));
    const r: any = await app.db.execute(sql`select current_user as u, current_setting('request.jwt.claims', true) as c`);
    const row = r[0]; if (row.u !== "app_user" || (row.c ?? "") !== "") throw new Error(JSON.stringify(row));
  });
  await check("Si la consulta falla, la transacción se revierte y el rol también (sin fuga)", async () => {
    await rejects(withRls(app.db, { sub: U3 }, (tx) => tx.insert(s.activities).values({ studyId: d.A.id, code: "X-3", positionId: d.a.pos.id, name: "x" })), "42501");
    const r: any = await app.db.execute(sql`select current_user as u`); if (r[0].u !== "app_user") throw new Error(r[0].u);
  });
  await check("Contraste: la conexión admin (postgres) SÍ salta RLS y ve todos los estudios", async () => {
    const r = await admin.db.select().from(s.studies); if (r.length < 3) throw new Error(`vio ${r.length}`);
  });
  await check("Concurrencia optimista: UPDATE con version correcta incrementa; con version vieja afecta 0 filas", async () => {
    const act = d.a.act;
    const r1 = await withRls(app.db, { sub: U1 }, (tx) => tx.update(s.activities).set({ name: "v2" }).where(and(eq(s.activities.id, act.id), eq(s.activities.version, 1))).returning());
    if (r1.length !== 1 || r1[0].version !== 2) throw new Error("no incrementó");
    const r2 = await withRls(app.db, { sub: U1 }, (tx) => tx.update(s.activities).set({ name: "v3" }).where(and(eq(s.activities.id, act.id), eq(s.activities.version, 1))).returning());
    if (r2.length !== 0) throw new Error("aceptó versión vieja");
  });
  await check("FK compuesta: una actividad no puede apuntar a un cargo de OTRO estudio (23503)", () => rejects(admin.db.insert(s.activities).values({ studyId: d.A.id, code: "X-4", positionId: d.b.pos.id, name: "x" }), "23503"));
  await check("Código de actividad único por estudio (23505)", () => rejects(admin.db.insert(s.activities).values({ studyId: d.A.id, code: "ACT-1", positionId: d.a.pos.id, name: "dup" }), "23505"));
  await check("CHECK de rango: % de reproceso 1.5 es rechazado (23514)", () => rejects(admin.db.insert(s.activities).values({ studyId: d.A.id, code: "X-5", positionId: d.a.pos.id, name: "x", reworkPct: "1.5" }), "23514"));
  await check("Auditoría solo se agrega: un writer inserta y NO puede borrar", async () => {
    await withRls(app.db, { sub: U1 }, (tx) => tx.insert(s.auditLog).values({ studyId: d.A.id, actorId: U1, origin: "app", action: "update", entity: "activities", diff: { name: { from: "a", to: "b" } } }));
    await rejects(withRls(app.db, { sub: U1 }, (tx) => tx.delete(s.auditLog)), "42501");
  });
  await admin.client.end(); await app.client.end(); summary();
})();
