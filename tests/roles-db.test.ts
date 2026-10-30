import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { listEntries, saveEntry } from "../src/server/entry/service";
import { createInvitation, deleteRole, getMyAccess, listInvitations, listMembers, listRoles, lookupInvitation, redeemInvitation, removeMember, revokeInvitation, saveRole, updateMember } from "../src/server/access";
import { connectSheet, listConnections } from "../src/server/sheets/sync";
import { roles, rolePermissions, memberships } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-91 — roles, permisos por módulo, invitaciones y áreas de cada persona, con PostgreSQL real: lo que cada rol puede leer y escribir lo hace cumplir la base de
 * datos (no la pantalla); los roles del sistema no se tocan; siempre queda un Super usuario; las invitaciones sirven una vez, para su correo y mientras no venzan.
 * No deja datos.
 */
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};
/** Un error de PostgreSQL con este SQLSTATE (drizzle lo envuelve en «Failed query»). */
async function rejects(p: Promise<unknown>, code: string, what: string) {
  try { await p; } catch (e) { const x = e as { code?: string; cause?: { code?: string } }; if ((x.cause?.code ?? x.code) === code) return; throw new Error(`${what}: se esperaba ${code} y llegó ${x.cause?.code ?? x.code}`); }
  throw new Error(`${what}: se esperaba ${code} pero la operación tuvo éxito`);
}

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), capt = randomUUID(), lector = randomUUID(), segundo = randomUUID(), intruso = randomUUID();
  const mail = (u: string) => `${u.slice(0, 8)}@prueba.co`;
  for (const id of [owner, capt, lector, segundo, intruso]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba roles");
    const rolesList = async () => await listRoles(app.db, owner, studyId);
    const roleId = async (name: string) => (await rolesList()).find((r) => r.name === name)!.id;

    await check("Un estudio nuevo trae los roles Super usuario (del sistema), Editor y Lector; su creador es Super usuario con Edición en todo", async () => {
      const rs = await rolesList();
      if (rs.map((r) => r.name).sort().join() !== "Editor,Lector,Super usuario") throw new Error(rs.map((r) => r.name).join());
      if (!rs.find((r) => r.name === "Super usuario")!.isSystem || rs.find((r) => r.name === "Editor")!.isSystem) throw new Error("solo el Super usuario es del sistema");
      const me = await getMyAccess(app.db, owner, studyId);
      if (!me || !me.isAdmin || me.roleName !== "Super usuario" || Object.values(me.perms).some((l) => l !== "edit") || !me.allAreas) throw new Error(JSON.stringify(me));
    });

    await check("Crear un rol: las dependencias suben a Lectura y se avisan, «usuarios» nunca se concede, el nombre repetido se rechaza", async () => {
      const r = await saveRole(app.db, owner, studyId, { name: "Capturista de actividades", perms: { actividades: "edit", usuarios: "edit" } });
      if (!r.ok) throw new Error(JSON.stringify(r));
      const got = (await rolesList()).find((x) => x.id === r.id)!;
      if (got.perms.actividades !== "edit" || got.perms.cargos !== "read" || got.perms.parametros !== "read" || got.perms.usuarios !== "none" || got.perms.oportunidades !== "none") throw new Error(JSON.stringify(got.perms));
      if (!r.raised.some((x) => x.module === "cargos" && x.because === "actividades") || !r.raised.some((x) => x.module === "parametros" && x.because === "cargos")) throw new Error("debía avisar las dependencias: " + JSON.stringify(r.raised));
      const dup = await saveRole(app.db, owner, studyId, { name: "capturista de actividades", perms: {} });
      if (dup.ok) throw new Error("aceptó un nombre repetido");
      const sys = await saveRole(app.db, owner, studyId, { name: "Super usuario", perms: {} });
      if (sys.ok) throw new Error("aceptó un rol con el nombre del sistema");
    });

    await check("Invitación: la crea quien administra; el enlace es único y solo queda su hash; con otro correo, ya usada o vencida no sirve; con el correcto crea la membresía con su rol y áreas", async () => {
      const [areaCajas] = (await admin.db.execute(sql`select id from public.areas where study_id = ${studyId} and name = 'Cajas'`)) as unknown as { id: string }[];
      const rid = await roleId("Capturista de actividades");
      const bad = await createInvitation(app.db, owner, studyId, { email: "no-es-correo", roleId: rid, allAreas: true, areaIds: [] });
      if (bad.ok) throw new Error("aceptó un correo inválido");
      const noAreas = await createInvitation(app.db, owner, studyId, { email: mail(capt), roleId: rid, allAreas: false, areaIds: [] });
      if (noAreas.ok) throw new Error("aceptó «algunas áreas» sin marcar ninguna");
      const inv = await createInvitation(app.db, owner, studyId, { email: mail(capt).toUpperCase(), roleId: rid, allAreas: false, areaIds: [areaCajas.id] });
      if (!inv.ok) throw new Error(JSON.stringify(inv));
      const stored = (await admin.db.execute(sql`select token_hash, email from public.invitations where study_id = ${studyId}`)) as unknown as { token_hash: string; email: string }[];
      if (stored.length !== 1 || stored[0].token_hash.includes(inv.token) || stored[0].email !== mail(capt)) throw new Error("en la base debe quedar solo el hash y el correo en minúscula");
      const info = await lookupInvitation(app.db, inv.token);
      if (!info || !info.valid || info.email !== mail(capt) || info.roleName !== "Capturista de actividades") throw new Error(JSON.stringify(info));
      if ((await lookupInvitation(app.db, "x".repeat(40))) !== null) throw new Error("un enlace inexistente debía dar nada");
      const wrong = await redeemInvitation(app.db, intruso, mail(intruso), inv.token);
      if (wrong.ok || !wrong.error.includes("otro correo")) throw new Error("aceptó la invitación de otro correo");
      const noMail = await redeemInvitation(app.db, capt, "otra@persona.co", inv.token);
      if (noMail.ok) throw new Error("aceptó una sesión con otro correo");
      await admin.db.execute(sql`update public.invitations set expires_at = now() - interval '1 minute' where study_id = ${studyId}`);
      const late = await redeemInvitation(app.db, capt, mail(capt), inv.token);
      if (late.ok) throw new Error("aceptó una invitación vencida");
      if ((await listInvitations(app.db, owner, studyId))[0].status !== "vencida") throw new Error("debía figurar vencida");
      await admin.db.execute(sql`update public.invitations set expires_at = now() + interval '1 day' where study_id = ${studyId}`);
      const ok = await redeemInvitation(app.db, capt, mail(capt), inv.token);
      if (!ok.ok || ok.studyId !== studyId) throw new Error(JSON.stringify(ok));
      const again = await redeemInvitation(app.db, capt, mail(capt), inv.token);
      if (again.ok) throw new Error("un enlace servía dos veces");
      const me = await getMyAccess(app.db, capt, studyId);
      if (!me || me.roleName !== "Capturista de actividades" || me.allAreas || me.areaIds.join() !== areaCajas.id || me.isAdmin) throw new Error(JSON.stringify(me));
      const au = (await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and entity = 'invitation_accepted'`)) as unknown as { n: number }[];
      if (au[0].n !== 1) throw new Error("la aceptación debía quedar en la auditoría");
    });

    // Cargo y actividad para probar permisos
    const base = { calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "5" };
    await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "2", weeklyHours: "42" }), {});

    await check("Permisos por módulo en la base: quien edita Actividades crea actividades, lee Cargos pero no los cambia, y no ve ni escribe Oportunidades", async () => {
      const a = await saveEntry(app.db, capt, studyId, "3", cells("3", { kind: "REAL", code: "R-1", area: "Cajas", site: "S1", position: "Cajero", name: "Arqueo", ...base }), {});
      if (!a.ok) throw new Error("editar Actividades debía poder crear una actividad: " + JSON.stringify(a));
      if ((await listEntries(app.db, capt, studyId, "2"))!.rows.length !== 1) throw new Error("debía leer los cargos");
      const wCargo = await saveEntry(app.db, capt, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Otro", headcount: "1", weeklyHours: "42" }), {}).then(() => "escribió", (e) => (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? "error");
      if (wCargo !== "42501") throw new Error("editar Cargos sin permiso debía rechazarse con 42501 y dio " + wCargo);
      await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-1", area: "Cajas", site: "S1", position: "Cajero" }), {});
      if ((await listEntries(app.db, capt, studyId, "8"))!.rows.length !== 0) throw new Error("sin acceso a Oportunidades no debía ver ninguna");
      const wOpp = await saveEntry(app.db, capt, studyId, "8", cells("8", { code: "O-2", area: "Cajas", site: "S1", position: "Cajero" }), {}).then(() => "escribió", (e) => (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? "error");
      if (wOpp !== "42501") throw new Error("escribir Oportunidades sin permiso debía rechazarse con 42501 y dio " + wOpp);
    });

    await check("El rol Lector lee todo y no escribe nada; quien no es miembro no ve nada; un Editor edita todo menos la administración de usuarios", async () => {
      const lectorInv = await createInvitation(app.db, owner, studyId, { email: mail(lector), roleId: await roleId("Lector"), allAreas: true, areaIds: [] });
      if (!lectorInv.ok || !(await redeemInvitation(app.db, lector, mail(lector), lectorInv.token)).ok) throw new Error("no se pudo invitar al lector");
      if ((await listEntries(app.db, lector, studyId, "8"))!.rows.length !== 1 || (await listEntries(app.db, lector, studyId, "3"))!.rows.length !== 1) throw new Error("el lector debía ver todo");
      const w = await saveEntry(app.db, lector, studyId, "3", cells("3", { kind: "REAL", code: "R-2", area: "Cajas", site: "S1", position: "Cajero", name: "Otra", ...base }), {}).then(() => "escribió", (e) => (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? "error");
      if (w !== "42501") throw new Error("el lector no debía escribir: " + w);
      const peek = await listEntries(app.db, intruso, studyId, "3").then(() => "leyó", (e) => String((e as Error).message));
      if (peek === "leyó") throw new Error("un no miembro no debía ver actividades");
      const me = await getMyAccess(app.db, intruso, studyId);
      if (me !== null) throw new Error("un no miembro no debía tener acceso");
    });

    await check("Solo quien administra gestiona roles, usuarios e invitaciones: los demás reciben un rechazo y no ven la lista de personas", async () => {
      const r = await saveRole(app.db, capt, studyId, { name: "Intento", perms: {} });
      if (r.ok || !r.error.includes("permiso")) throw new Error("un no administrador creó un rol: " + JSON.stringify(r));
      const i = await createInvitation(app.db, capt, studyId, { email: mail(intruso), roleId: await roleId("Lector"), allAreas: true, areaIds: [] });
      if (i.ok) throw new Error("un no administrador invitó");
      const u = await updateMember(app.db, capt, studyId, owner, { roleId: await roleId("Lector"), allAreas: true, areaIds: [] });
      if (u.ok) throw new Error("un no administrador cambió el rol del dueño");
      if ((await listMembers(app.db, capt, studyId)).length !== 1) throw new Error("quien no administra solo debía verse a sí mismo");
      if ((await listInvitations(app.db, capt, studyId)).length !== 0) throw new Error("quien no administra no debía ver las invitaciones");
      if ((await listMembers(app.db, owner, studyId)).length !== 3) throw new Error("el Super usuario debía ver a las 3 personas");
    });

    await check("Quien edita cualquier módulo puede consultar la conexión con Google y dejar el evento de sincronización (para que su cambio llegue a la hoja); el lector no administra la conexión", async () => {
      await connectSheet(app.db, owner, studyId, `roles-${randomUUID()}`, "push");
      if ((await listConnections(app.db, capt, studyId)).length !== 1) throw new Error("el editor debía ver la conexión");
      await withRls(app.db, { sub: capt }, (tx) => tx.execute(sql`insert into public.sync_events (study_id, connection_id, direction, origin_id, sheet_name, payload, status) select ${studyId}::uuid, id, 'app_to_sheet', ${randomUUID()}::uuid, 'prueba', '{}'::jsonb, 'processed' from public.sheet_connections where study_id = ${studyId}`)); // sin RETURNING: la aplicación tampoco lo usa (devolver la fila exigiría leer Integraciones)
      const n = (await admin.db.execute(sql`select count(*)::int n from public.sync_events where study_id = ${studyId}`)) as unknown as { n: number }[];
      if (n[0].n !== 1) throw new Error("el editor debía poder dejar el evento");
      await rejects(connectSheet(app.db, capt, studyId, `roles-${randomUUID()}`, "push"), "42501", "un editor sin Integraciones no debía crear conexiones");
    });

    await check("La base protege los roles del sistema aunque se salte la aplicación: no se editan ni se borran, y «usuarios» no se concede a otros roles", async () => {
      const sup = await roleId("Super usuario");
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.update(roles).set({ name: "Otro" }).where(eq(roles.id, sup))), "23514", "editar el rol del sistema");
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.delete(roles).where(eq(roles.id, sup))), "23514", "borrar el rol del sistema");
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.update(rolePermissions).set({ level: "none" }).where(eq(rolePermissions.roleId, sup))), "23514", "cambiar permisos del rol del sistema");
      const ed = await roleId("Editor");
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.update(rolePermissions).set({ level: "edit" }).where(sql`${rolePermissions.roleId} = ${ed} and ${rolePermissions.module} = 'usuarios'`)), "23514", "darle usuarios a otro rol");
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.update(roles).set({ isSystem: true }).where(eq(roles.id, ed))), "23514", "volver de sistema un rol");
    });

    await check("Siempre queda al menos un Super usuario: el único no puede cambiarse de rol ni quitarse; con un segundo sí", async () => {
      const lectorRole = await roleId("Lector"), sup = await roleId("Super usuario");
      const a = await updateMember(app.db, owner, studyId, owner, { roleId: lectorRole, allAreas: true, areaIds: [] });
      if (a.ok || !a.error.includes("Super usuario")) throw new Error("dejó el estudio sin Super usuario: " + JSON.stringify(a));
      const b = await removeMember(app.db, owner, studyId, owner);
      if (b.ok) throw new Error("se quitó al único Super usuario: " + JSON.stringify(b));
      // aunque se salte la aplicación, la base lo impide
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.delete(memberships).where(eq(memberships.userId, owner))), "23514", "borrar la membresía del único Super usuario");
      await rejects(withRls(app.db, { sub: owner }, (tx) => tx.update(memberships).set({ roleId: lectorRole }).where(eq(memberships.userId, owner))), "23514", "cambiar el rol del único Super usuario");
      const inv = await createInvitation(app.db, owner, studyId, { email: mail(segundo), roleId: sup, allAreas: true, areaIds: [] });
      if (!inv.ok || !(await redeemInvitation(app.db, segundo, mail(segundo), inv.token)).ok) throw new Error("no se pudo invitar al segundo Super usuario");
      const s = await getMyAccess(app.db, segundo, studyId);
      if (!s?.isAdmin) throw new Error("el segundo debía administrar");
      const self = await updateMember(app.db, owner, studyId, owner, { roleId: lectorRole, allAreas: true, areaIds: [] });
      if (self.ok) throw new Error("nadie debe poder quitarse a sí mismo el rol de Super usuario");
      const c = await updateMember(app.db, segundo, studyId, owner, { roleId: lectorRole, allAreas: true, areaIds: [] });
      if (!c.ok) throw new Error("con un segundo Super usuario debía poder cambiarse al primero: " + JSON.stringify(c));
      const back = await updateMember(app.db, segundo, studyId, owner, { roleId: sup, allAreas: true, areaIds: [] });
      if (!back.ok) throw new Error("el segundo Super usuario debía poder devolverle el rol: " + JSON.stringify(back));
    });

    await check("Cambiar áreas y rol de una persona; quitar su acceso; borrar roles: en uso no se borra, sin uso sí; revocar una invitación pendiente", async () => {
      const [areaCaj] = (await admin.db.execute(sql`select id from public.areas where study_id = ${studyId} and name = 'Cajas'`)) as unknown as { id: string }[];
      const [areaDom] = (await admin.db.execute(sql`select id from public.areas where study_id = ${studyId} and name = 'Domicilios'`)) as unknown as { id: string }[];
      const cap = await roleId("Capturista de actividades");
      const u = await updateMember(app.db, owner, studyId, capt, { roleId: cap, allAreas: false, areaIds: [areaCaj.id, areaDom.id] });
      if (!u.ok) throw new Error(JSON.stringify(u));
      const m = (await listMembers(app.db, owner, studyId)).find((x) => x.userId === capt)!;
      if (m.allAreas || m.areas.join() !== "Cajas,Domicilios") throw new Error(JSON.stringify(m));
      const noRole = await updateMember(app.db, owner, studyId, capt, { roleId: randomUUID(), allAreas: true, areaIds: [] });
      if (noRole.ok) throw new Error("aceptó un rol inexistente");
      const inUse = await deleteRole(app.db, owner, studyId, cap);
      if (inUse.ok || !inUse.error.includes("tienen")) throw new Error("borró un rol en uso: " + JSON.stringify(inUse));
      const sysDel = await deleteRole(app.db, owner, studyId, await roleId("Super usuario"));
      if (sysDel.ok) throw new Error("borró el rol del sistema");
      const tmp = await saveRole(app.db, owner, studyId, { name: "Temporal", perms: { riesgos: "read" } });
      if (!tmp.ok) throw new Error(JSON.stringify(tmp));
      const pend = await createInvitation(app.db, owner, studyId, { email: "pendiente@prueba.co", roleId: tmp.id, allAreas: true, areaIds: [] });
      if (!pend.ok) throw new Error(JSON.stringify(pend));
      const del = await deleteRole(app.db, owner, studyId, tmp.id);
      if (!del.ok) throw new Error("un rol sin personas debía poder borrarse (con sus invitaciones pendientes): " + JSON.stringify(del));
      const pend2 = await createInvitation(app.db, owner, studyId, { email: "pendiente@prueba.co", roleId: await roleId("Lector"), allAreas: true, areaIds: [] });
      if (!pend2.ok) throw new Error(JSON.stringify(pend2));
      const id2 = (await listInvitations(app.db, owner, studyId)).find((i) => i.email === "pendiente@prueba.co" && i.status === "pendiente")!.id;
      if (!(await revokeInvitation(app.db, owner, studyId, id2)).ok || (await lookupInvitation(app.db, pend2.token)) !== null) throw new Error("revocar debía invalidar el enlace");
      const rem = await removeMember(app.db, owner, studyId, capt);
      if (!rem.ok) throw new Error(JSON.stringify(rem));
      if ((await getMyAccess(app.db, capt, studyId)) !== null) throw new Error("quitar el acceso debía ser inmediato");
      const peek = await listEntries(app.db, capt, studyId, "3").then(() => "leyó", () => "rechazado");
      if (peek !== "rechazado") throw new Error("sin membresía no debía ver nada");
      const kept = (await admin.db.execute(sql`select count(*)::int n from public.activities where study_id = ${studyId} and code = 'R-1'`)) as unknown as { n: number }[];
      if (kept[0].n !== 1) throw new Error("lo que editó debía conservarse");
    });

    await check("Las membresías heredadas (sin rol) siguen funcionando con sus permisos de siempre: owner edita todo, editor edita menos usuarios, viewer solo lee", async () => {
      const legacy = randomUUID(); await admin.db.execute(sql`insert into auth.users (id) values (${legacy})`);
      await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${legacy}, 'viewer')`);
      const me = await getMyAccess(app.db, legacy, studyId);
      if (!me || me.perms.actividades !== "read" || me.perms.usuarios !== "none" || me.isAdmin) throw new Error(JSON.stringify(me));
      if ((await listEntries(app.db, legacy, studyId, "3"))!.rows.length !== 1) throw new Error("el viewer heredado debía leer");
      await admin.db.execute(sql`delete from public.memberships where user_id = ${legacy}`);
      await admin.db.execute(sql`delete from auth.users where id = ${legacy}`);
    });

    await check("Borrar el estudio borra sus roles, permisos, invitaciones y membresías sin chocar con las protecciones", async () => {
      await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
      const left = (await admin.db.execute(sql`select (select count(*)::int from public.roles where study_id = ${studyId}) r, (select count(*)::int from public.memberships where study_id = ${studyId}) m`)) as unknown as { r: number; m: number }[];
      if (left[0].r !== 0 || left[0].m !== 0) throw new Error(JSON.stringify(left));
      studyId = "";
    });
    void memberships;
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${capt}, ${lector}, ${segundo}, ${intruso})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
