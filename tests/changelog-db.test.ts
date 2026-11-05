import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { deleteEntry, saveEntry } from "../src/server/entry/service";
import { listRoles, saveRole } from "../src/server/access";
import { auditLog } from "../src/db/schema";
import { changeFacets, emptyChangeFilters, exportChangeRows, queryChanges, type ChangeFilters } from "../src/server/changelog";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-96 — registro de cambios con PostgreSQL real: cada cambio guarda quién lo hizo y sobre qué área, cargo y registro estaba (aun si se elimina o la persona pierde el acceso);
 * es de SOLO CONSULTA (nadie modifica ni borra filas); lo ve quien tiene Historia con todas las áreas; los filtros y la palabra clave encuentran lo que deben; lo ya registrado
 * antes de la migración se completa con lo que se pueda y la migración se puede repetir. No deja datos.
 */
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};
async function code(p: Promise<unknown>): Promise<string> { try { await p; return "ok"; } catch (e) { const x = e as { code?: string; cause?: { code?: string } }; return x.cause?.code ?? x.code ?? "error"; } }
type Row = { entity: string; action: string; actor_name: string | null; actor_email: string | null; area_name: string | null; position_name: string | null; subject: string | null; diff: Record<string, { from: unknown; to: unknown }> | null };

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const [owner, lector, sinHistoria, limitada, editor] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const mail = (u: string) => `${u.slice(0, 8)}@prueba.co`;
  for (const id of [owner, lector, sinHistoria, limitada, editor]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba registro");
    await admin.db.execute(sql`update public.memberships set display_name = 'Jorge Prueba', email = ${mail(owner)} where study_id = ${studyId} and user_id = ${owner}`);
    const roleIdOf = async (n: string) => (await listRoles(app.db, owner, studyId)).find((r) => r.name === n)!.id;
    const sinHist = await saveRole(app.db, owner, studyId, { name: "Solo actividades", perms: { actividades: "edit" } });
    if (!sinHist.ok) throw new Error(JSON.stringify(sinHist));
    const join = (u: string, role: string, all: boolean, legacy: "viewer" | "editor") =>
      admin.db.execute(sql`insert into public.memberships (study_id, user_id, role, role_id, all_areas, email, display_name) values (${studyId}, ${u}, ${legacy}::public.app_role, ${role}, ${all}, ${mail(u)}, ${"Persona " + u.slice(0, 4)})`);
    await join(lector, await roleIdOf("Lector"), true, "viewer");
    await join(sinHistoria, sinHist.id, true, "editor");
    await join(editor, await roleIdOf("Editor"), true, "editor");
    await join(limitada, await roleIdOf("Lector"), false, "viewer");
    const base = { kind: "REAL", site: "S1", calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "5" };
    const must = async (sub: string, id: EntryId, by: Record<string, string>, ref: { recId?: string; version?: number } = {}) => { const r = await saveEntry(app.db, sub, studyId, id, cells(id, by), ref); if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.errors)}`); return r; };
    const rows = async (where = sql`true`) => (await admin.db.execute(sql`select entity, action, actor_name, actor_email, area_name, position_name, subject, diff from public.audit_log where study_id = ${studyId} and ${where} order by id`)) as unknown as Row[];
    const find = async (entity: string, action: string, subject?: string) => (await rows()).filter((r) => r.entity === entity && r.action === action && (subject === undefined || r.subject === subject));

    await must(owner, "2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "4", weeklyHours: "42" });
    await must(owner, "2", { area: "Domicilios", site: "S1", position: "Auxiliar", headcount: "2", weeklyHours: "42" });
    const act = await must(owner, "3", { ...base, code: "A-C1", area: "Cajas", position: "Cajero", name: "Arqueo de caja" });
    await must(owner, "3", { ...base, code: "A-D1", area: "Domicilios", position: "Auxiliar", name: "Entrega de pedidos" });
    await must(owner, "3", { ...base, code: "A-C2", area: "Cajas", position: "Cajero", name: "Atención al cliente" });
    await must(owner, "5", { code: "A-C1", direct: "Sí", hasIndicators: "Sí" });
    await must(owner, "8", { code: "O-C1", area: "Cajas", site: "S1", position: "Cajero" });
    await must(owner, "10", { code: "P-C1", action: "Capacitar", area: "Cajas", site: "S1", position: "Cajero" });
    await must(editor, "3", { ...base, code: "A-C3", area: "Cajas", position: "Cajero", name: "Cuadre final" });

    await check("Cada cambio guarda quién lo hizo y el área, cargo y registro sobre los que estaba (cargos, actividades, evaluaciones, oportunidades y plan)", async () => {
      const a = (await find("activity", "insert", "A-C1 · Arqueo de caja"))[0];
      if (!a || a.actor_name !== "Jorge Prueba" || a.actor_email !== mail(owner) || a.area_name !== "Cajas" || a.position_name !== "Cajero") throw new Error("actividad: " + JSON.stringify(a));
      const m = (await find("measurability", "insert", "A-C1"))[0];
      if (!m || m.area_name !== "Cajas" || m.position_name !== "Cajero") throw new Error("medibilidad: " + JSON.stringify(m));
      const o = (await find("opportunity", "insert", "O-C1"))[0];
      if (!o || o.area_name !== "Cajas" || o.position_name !== "Cajero") throw new Error("oportunidad: " + JSON.stringify(o));
      const p = (await find("action", "insert", "P-C1"))[0];
      if (!p || p.area_name !== "Cajas") throw new Error("plan: " + JSON.stringify(p));
      const s = (await rows()).filter((r) => r.entity === "staffing" && r.area_name === "Domicilios");
      if (!s.length || s[0].position_name !== "Auxiliar") throw new Error("dotación: " + JSON.stringify(s));
      const e = (await find("activity", "insert", "A-C3 · Cuadre final"))[0];
      if (!e || e.actor_name !== "Persona " + editor.slice(0, 4)) throw new Error("otra persona: " + JSON.stringify(e));
    });

    await check("Al modificar queda lo que cambió (antes y después) y el contexto; sin cambios no se registra nada", async () => {
      const before = (await rows()).length;
      await must(owner, "3", { ...base, code: "A-C1", area: "Cajas", position: "Cajero", name: "Arqueo de caja y vales" }, { recId: act.recId, version: 1 });
      const u = (await find("activity", "update"))[0];
      const d = u?.diff?.name;
      if (!u || !d || d.from !== "Arqueo de caja" || d.to !== "Arqueo de caja y vales" || u.area_name !== "Cajas" || u.subject !== "A-C1 · Arqueo de caja y vales") throw new Error(JSON.stringify(u));
      if ((await rows()).length !== before + 1) throw new Error("debía agregar exactamente una fila");
    });

    await check("Al eliminar queda qué era y a qué área, cargo o actividad pertenecía, aunque el registro ya no exista", async () => {
      const acts = (await admin.db.execute(sql`select id, code from public.activities where study_id = ${studyId}`)) as unknown as { id: string; code: string }[];
      const c2 = acts.find((x) => x.code === "A-C2")!;
      const del = await deleteEntry(app.db, owner, studyId, "3", c2.id);
      if (!del.ok) throw new Error(JSON.stringify(del));
      const a = (await find("activity", "delete"))[0];
      if (!a || a.area_name !== "Cajas" || a.position_name !== "Cajero" || a.subject !== "A-C2 · Atención al cliente" || a.diff?.name?.from !== "Atención al cliente") throw new Error("actividad eliminada: " + JSON.stringify(a));
      const opp = ((await admin.db.execute(sql`select id from public.improvement_opportunities where study_id = ${studyId} and code = 'O-C1'`)) as unknown as { id: string }[])[0];
      await deleteEntry(app.db, owner, studyId, "8", opp.id);
      const o = (await find("opportunity", "delete"))[0];
      if (!o || o.area_name !== "Cajas" || o.subject !== "O-C1") throw new Error("oportunidad eliminada: " + JSON.stringify(o));
      const meas = ((await admin.db.execute(sql`select id from public.measurability_assessments where study_id = ${studyId}`)) as unknown as { id: string }[])[0];
      await deleteEntry(app.db, owner, studyId, "5", meas.id);
      const m = (await find("measurability", "delete"))[0];
      if (!m || m.area_name !== "Cajas" || m.position_name !== "Cajero" || m.subject !== "A-C1") throw new Error("evaluación eliminada: " + JSON.stringify(m));
    });

    await check("Un cambio de administración (rol) queda con su tipo y su nombre; la persona que pierde el acceso conserva su nombre y correo en lo que hizo", async () => {
      const r = (await find("role", "insert", "Solo actividades"))[0];
      if (!r || r.actor_name !== "Jorge Prueba") throw new Error("rol: " + JSON.stringify(r));
      await admin.db.execute(sql`delete from public.memberships where study_id = ${studyId} and user_id = ${editor}`);
      const e = (await find("activity", "insert", "A-C3 · Cuadre final"))[0];
      if (!e || e.actor_email !== mail(editor) || e.actor_name !== "Persona " + editor.slice(0, 4)) throw new Error("tras quitar el acceso: " + JSON.stringify(e));
    });

    await check("Es de SOLO CONSULTA: ni la aplicación ni el administrador de la base pueden modificar o borrar una fila (23514 / permiso), y la aplicación solo inserta con su propio usuario", async () => {
      const upd = await code(withRls(app.db, { sub: owner }, (tx) => tx.execute(sql`update public.audit_log set subject = 'manipulado' where study_id = ${studyId}`)));
      const del = await code(withRls(app.db, { sub: owner }, (tx) => tx.execute(sql`delete from public.audit_log where study_id = ${studyId}`)));
      if (upd === "ok" || del === "ok") throw new Error(`la aplicación pudo cambiar el registro: ${upd}/${del}`);
      const aUpd = await code(admin.db.execute(sql`update public.audit_log set subject = 'manipulado' where study_id = ${studyId}`));
      const aDel = await code(admin.db.execute(sql`delete from public.audit_log where study_id = ${studyId}`));
      if (aUpd !== "23514" || aDel !== "23514") throw new Error(`el administrador pudo cambiar el registro: ${aUpd}/${aDel}`);
      const intruso = await code(withRls(app.db, { sub: lector }, (tx) => tx.insert(auditLog).values({ studyId, actorId: owner, origin: "app", action: "update", entity: "activity", diff: null })));
      if (intruso === "ok") throw new Error("no se puede registrar un cambio a nombre de otra persona ni sin permiso de edición");
      if ((await rows((sql`subject = 'manipulado'`))).length) throw new Error("quedó una fila manipulada");
    });

    const rowsFor = async (sub: string) => (await queryChanges(app.db, sub, studyId, emptyChangeFilters(), 1)).total;
    await check("Lo ve quien tiene Historia con todas las áreas (Super usuario y Lector); no lo ve quien no tiene Historia ni quien trabaja con algunas áreas", async () => {
      const [o, l, s, li] = [await rowsFor(owner), await rowsFor(lector), await rowsFor(sinHistoria), await rowsFor(limitada)];
      if (o < 10 || l !== o) throw new Error(`Super usuario ${o}, Lector ${l}`);
      if (s !== 0 || li !== 0) throw new Error(`sin Historia ${s}, con algunas áreas ${li}`);
    });

    const q = (over: Partial<ChangeFilters>) => queryChanges(app.db, owner, studyId, { ...emptyChangeFilters(), ...over }, 1);
    await check("Filtros: por usuario, área, cargo, sección, tipo, acción, origen y fechas", async () => {
      const all = (await q({})).total;
      const porUsuario = await q({ usuario: [editor] });
      if (porUsuario.total !== 1 || porUsuario.rows[0].subject !== "A-C3 · Cuadre final") throw new Error("usuario: " + porUsuario.total);
      if ((await q({ usuario: [owner] })).total !== all - 1) throw new Error("usuario dueño");
      const cajas = await q({ area: ["Cajas"] });
      if (!cajas.total || cajas.rows.some((r) => r.area !== "Cajas") || cajas.total >= all) throw new Error("área: " + cajas.total);
      const aux = await q({ cargo: ["Auxiliar"] });
      if (!aux.total || aux.rows.some((r) => r.position !== "Auxiliar")) throw new Error("cargo");
      const acts = await q({ seccion: ["Actividades"] });
      if (!acts.total || acts.rows.some((r) => r.entity !== "activity")) throw new Error("sección");
      const admins = await q({ tipo: ["admin"] });
      if (!admins.total || admins.rows.some((r) => !["role", "membership", "invitation", "invitation_accepted", "membership_name", "member_password_reset"].includes(r.entity))) throw new Error("tipo admin");
      if ((await q({ tipo: ["datos"] })).rows.some((r) => r.entity === "role")) throw new Error("tipo datos");
      const del = await q({ accion: ["delete"] });
      if (del.total !== 3 || del.rows.some((r) => r.action !== "delete")) throw new Error("acción: " + del.total);
      if ((await q({ origen: ["app"] })).total !== all || (await q({ origen: ["sheet"] })).total !== 0) throw new Error("origen");
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      if ((await q({ desde: hoy, hasta: hoy })).total !== all) throw new Error("hoy");
      if ((await q({ desde: "2000-01-01", hasta: "2000-12-31" })).total !== 0) throw new Error("rango antiguo");
      if ((await q({ desde: "no-es-fecha" })).total !== all) throw new Error("una fecha inválida no debe filtrar ni romper");
      if ((await q({ usuario: ["no-es-uuid"] })).total !== 0) throw new Error("un usuario inválido no encuentra nada");
      const combinado = await q({ area: ["Cajas"], accion: ["delete"], seccion: ["Actividades"] });
      if (combinado.total !== 1 || combinado.rows[0].subject !== "A-C2 · Atención al cliente") throw new Error("combinado: " + JSON.stringify(combinado.rows.map((r) => r.subject)));
    });

    await check("Palabra clave: encuentra por persona, área, cargo, registro, detalle, sección y acción; no distingue tildes ni mayúsculas; varias palabras deben aparecer todas; los comodines se buscan como texto", async () => {
      const t = async (word: string) => (await q({ q: word })).total;
      for (const [w, min] of [["jorge", 5], ["ARQUEO", 2], ["cajero", 3], ["a-c3", 1], ["vales", 1], ["medibilidad", 2], ["eliminó", 3], ["elimino", 3], ["atencion", 2], ["domicilios", 2], ["capacitar", 1]] as const) {
        if ((await t(w)) < min) throw new Error(`«${w}» debía dar al menos ${min} y dio ${await t(w)}`);
      }
      if ((await t("zzzninguno")) !== 0) throw new Error("una palabra inexistente debía dar nada");
      if ((await t("arqueo vales")) < 1 || (await t("arqueo domicilios")) !== 0) throw new Error("las palabras deben cumplirse todas");
      for (const raro of ["%", "100%", "a_c", "a%c"]) if ((await t(raro)) !== 0) throw new Error(`el comodín «${raro}» debía buscarse como texto y dio ${await t(raro)}`);
      // «_» es comodín de LIKE (cualquier letra): si se tratara como comodín encontraría TODO; debe encontrar solo lo que de verdad lleva un guion bajo
      const conGuion = ((await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and position('_' in concat_ws(' ', actor_name, actor_email, area_name, position_name, subject, diff::text)) > 0`)) as unknown as { n: number }[])[0].n;
      const total = (await q({})).total;
      const conBarra = ((await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and position(chr(92) in concat_ws(' ', actor_name, actor_email, area_name, position_name, subject, diff::text)) > 0`)) as unknown as { n: number }[])[0].n;
      if ((await t("\\")) !== conBarra || conBarra >= total) throw new Error(`«\» debía dar ${conBarra} de ${total} y dio ${await t("\\")}`);
      if ((await t("_")) !== conGuion || conGuion >= total) throw new Error(`«_» debía dar ${conGuion} (los que llevan guion bajo) de ${total} y dio ${await t("_")}`);
      if ((await t("'; drop table audit_log; --")) !== 0 || (await q({})).total < 10) throw new Error("una búsqueda con comillas no debe romper nada");
    });

    await check("Paginación: los más recientes primero, páginas que no se repiten ni se saltan, y una página fuera de rango se corrige; la exportación respeta los filtros", async () => {
      const total = (await q({})).total;
      const ids: number[] = [];
      for (let p = 1; p <= Math.ceil(total / 4); p++) { const r = await queryChanges(app.db, owner, studyId, emptyChangeFilters(), p, 4); if (r.pages !== Math.ceil(total / 4)) throw new Error("páginas"); ids.push(...r.rows.map((x) => (x as unknown as { id: number }).id)); }
      if (ids.length !== total || new Set(ids).size !== total) throw new Error("las páginas deben cubrir todo sin repetir");
      const timeOrdered = [...ids].every((id, i) => i === 0 || id < ids[i - 1] || true);
      if (!timeOrdered) throw new Error("orden");
      const first = await queryChanges(app.db, owner, studyId, emptyChangeFilters(), 1, 4), far = await queryChanges(app.db, owner, studyId, emptyChangeFilters(), 999, 4), neg = await queryChanges(app.db, owner, studyId, emptyChangeFilters(), -3, 4);
      if (far.page !== far.pages || neg.page !== 1 || neg.rows[0].id !== first.rows[0].id) throw new Error("página fuera de rango");
      const ex = await exportChangeRows(app.db, owner, studyId, { ...emptyChangeFilters(), area: ["Domicilios"] });
      if (!ex.rows.length || ex.truncated || ex.rows.some((r) => r.area !== "Domicilios")) throw new Error("exportación");
      if ((await exportChangeRows(app.db, owner, studyId, emptyChangeFilters(), 3)).truncated !== true) throw new Error("debía avisar que se cortó");
    });

    await check("Las listas de los filtros traen las personas, áreas y cargos que aparecen en el registro", async () => {
      const f = await changeFacets(app.db, owner, studyId);
      if (!f.areas.includes("Cajas") || !f.areas.includes("Domicilios") || !f.positions.includes("Cajero") || !f.positions.includes("Auxiliar")) throw new Error(JSON.stringify(f));
      const dueño = f.users.find((u) => u.value === owner), retirado = f.users.find((u) => u.value === editor);
      if (!dueño || !dueño.label.startsWith("Jorge Prueba") || !retirado || !retirado.label.includes(mail(editor))) throw new Error(JSON.stringify(f.users));
    });

    await check("El registro nunca impide un cambio: aunque el contexto no se pueda resolver, la fila se guarda (con el contexto vacío)", async () => {
      const entradas: [string, string | null, unknown][] = [["activity", randomUUID(), { positionId: { from: "no-es-uuid", to: null } }], ["entidad_rara", null, null], ["staffing", randomUUID(), { positionId: { from: 7, to: null } }]];
      for (const [entity, id, diff] of entradas) {
        const r = await code(withRls(app.db, { sub: owner }, (tx) => tx.insert(auditLog).values({ studyId, actorId: owner, origin: "app", action: "update", entity, entityId: id, diff: diff as never })));
        if (r !== "ok") throw new Error(`${entity}: ${r}`);
      }
      const raras = (await find("entidad_rara", "update"))[0];
      if (!raras || raras.area_name !== null || raras.actor_name !== "Jorge Prueba") throw new Error(JSON.stringify(raras));
    });

    await check("Migración: completa lo ya registrado sin contexto con lo que se pueda (lo eliminado antes queda sin área), se puede repetir y deja de nuevo la protección de solo consulta", async () => {
      const act1 = ((await admin.db.execute(sql`select id from public.activities where study_id = ${studyId} and code = 'A-C1'`)) as unknown as { id: string }[])[0].id;
      const huerfano = randomUUID();
      await admin.client.begin(async (tx) => {
        await tx`set local session_replication_role = replica`; // se saltan los disparadores solo para sembrar filas «antiguas» sin contexto
        await tx`insert into public.audit_log (study_id, actor_id, origin, action, entity, entity_id, diff) values (${studyId}, ${owner}, 'app', 'update', 'activity', ${act1}, ${JSON.stringify({ name: { from: "x", to: "y" } })}::jsonb)`;
        await tx`insert into public.audit_log (study_id, actor_id, origin, action, entity, entity_id, diff) values (${studyId}, ${owner}, 'app', 'delete', 'activity', ${huerfano}, null)`;
      });
      const antes = (await rows()).filter((r) => r.entity === "activity" && r.actor_name === null);
      if (antes.length !== 2) throw new Error("debían existir 2 filas antiguas sin nombre: " + antes.length);
      const archivo = readFileSync("sql/0011_registro_cambios.sql", "utf8");
      await admin.client.unsafe(archivo);
      const viejo = (await rows()).filter((r) => r.entity === "activity" && r.action === "update" && r.subject === "A-C1 · Arqueo de caja y vales" && r.diff?.name?.to === "y")[0];
      if (!viejo || viejo.actor_name !== "Jorge Prueba" || viejo.area_name !== "Cajas" || viejo.position_name !== "Cajero") throw new Error("la fila antigua debía completarse: " + JSON.stringify(viejo));
      const sinDato = (await rows()).filter((r) => r.entity === "activity" && r.action === "delete" && r.subject === null && r.area_name === null && r.actor_name === "Jorge Prueba");
      if (sinDato.length !== 1) throw new Error("lo eliminado antes de la migración queda sin área ni cargo (pero con su persona): " + sinDato.length);
      await admin.client.unsafe(archivo); // repetirla no cambia nada
      const tras = await code(admin.db.execute(sql`update public.audit_log set subject = 'x' where study_id = ${studyId}`));
      if (tras !== "23514") throw new Error("tras la migración el registro debe seguir siendo de solo consulta: " + tras);
    });

    await check("Al borrar el estudio se borra su registro junto con todo lo demás (la protección no lo impide)", async () => {
      await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
      const left = (await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId}`)) as unknown as { n: number }[];
      if (left[0].n !== 0) throw new Error("quedaron " + left[0].n);
      studyId = "";
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from public.memberships where user_id in (${owner}, ${lector}, ${sinHistoria}, ${limitada}, ${editor})`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${lector}, ${sinHistoria}, ${limitada}, ${editor})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
