/**
 * Roles, usuarios e invitaciones (D-91). Todo corre con withRls(): la base de datos hace cumplir quién puede qué. Las pantallas de administración son solo del
 * Super usuario (módulo «usuarios»); cualquier miembro puede consultar sus propios permisos.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../db/client";
import { areas, auditLog, invitations, memberAreas, memberships, rolePermissions, roles } from "../db/schema";
import { DEFAULT_ROLES, MODULES, SUPER_ROLE, allPermissions, emptyPermissions, normalizePermissions, type AppModule, type Level, type Permissions } from "../domain/access";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 7;

/** Mensaje de una excepción de PostgreSQL (drizzle la envuelve en «Failed query»). */
export function pgMessage(e: unknown): { code?: string; message: string } {
  const x = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  return { code: x?.cause?.code ?? x?.code, message: x?.cause?.message ?? x?.message ?? "error" };
}

const audit = (tx: Tx, studyId: string, sub: string, action: string, entity: string, entityId: string | null, diff: Record<string, { from: unknown; to: unknown }> | null) =>
  tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action, entity, entityId, diff });

/* ───────── Permisos de quien está en sesión ───────── */
export interface MyAccess { roleId: string | null; roleName: string; perms: Permissions; allAreas: boolean; areaIds: string[]; isAdmin: boolean }

/** Nivel de acceso de las membresías heredadas (sin role_id): mismas reglas que private.module_level. */
export function legacyPerms(role: string): Permissions {
  const p = role === "owner" ? allPermissions("edit") : role === "viewer" ? allPermissions("read") : allPermissions("edit");
  if (role !== "owner") p.usuarios = "none";
  return p;
}

export async function getMyAccess(db: Db, sub: string, studyId: string): Promise<MyAccess | null> {
  return withRls(db, { sub }, async (tx) => {
    const [m] = await tx.select({ role: memberships.role, roleId: memberships.roleId, allAreas: memberships.allAreas }).from(memberships).where(and(eq(memberships.studyId, studyId), eq(memberships.userId, sub)));
    if (!m) return null;
    const areaIds = m.allAreas ? [] : (await tx.select({ id: memberAreas.areaId }).from(memberAreas).where(and(eq(memberAreas.studyId, studyId), eq(memberAreas.userId, sub)))).map((r) => r.id);
    if (!m.roleId) { const perms = legacyPerms(m.role); return { roleId: null, roleName: m.role === "owner" ? SUPER_ROLE : m.role === "viewer" ? "Lector" : "Editor", perms, allAreas: m.allAreas, areaIds, isAdmin: perms.usuarios === "edit" }; }
    const [r] = await tx.select({ name: roles.name }).from(roles).where(and(eq(roles.id, m.roleId), eq(roles.studyId, studyId)));
    const perms = emptyPermissions();
    for (const p of await tx.select({ module: rolePermissions.module, level: rolePermissions.level }).from(rolePermissions).where(and(eq(rolePermissions.roleId, m.roleId), eq(rolePermissions.studyId, studyId)))) perms[p.module as AppModule] = p.level as Level;
    return { roleId: m.roleId, roleName: r?.name ?? "", perms, allAreas: m.allAreas, areaIds, isAdmin: perms.usuarios === "edit" };
  });
}

/* ───────── Roles ───────── */
/** Crea los roles iniciales de un estudio nuevo y devuelve su id por nombre. Lo usa createStudy (el creador es, a la vez, el primer Super usuario). */
export async function seedRoles(tx: Tx, studyId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const [row] = await tx.insert(roles).values({ studyId, name: r.name, isSystem: r.system }).returning({ id: roles.id });
    ids[r.name] = row.id;
    await tx.insert(rolePermissions).values(MODULES.map((m) => ({ roleId: row.id, studyId, module: m, level: r.perms[m] })));
  }
  return ids;
}

export interface RoleView { id: string; name: string; isSystem: boolean; perms: Permissions; members: number; invitations: number }
export async function listRoles(db: Db, sub: string, studyId: string): Promise<RoleView[]> {
  return withRls(db, { sub }, async (tx) => {
    const rs = await tx.select().from(roles).where(eq(roles.studyId, studyId)).orderBy(asc(roles.isSystem), asc(roles.name));
    const perms = await tx.select().from(rolePermissions).where(eq(rolePermissions.studyId, studyId));
    const ms = await tx.select({ roleId: memberships.roleId }).from(memberships).where(eq(memberships.studyId, studyId));
    const inv = await tx.select({ roleId: invitations.roleId }).from(invitations).where(and(eq(invitations.studyId, studyId), isNull(invitations.usedAt), gt(invitations.expiresAt, sql`now()`)));
    return rs.map((r) => {
      const p = emptyPermissions();
      for (const x of perms.filter((y) => y.roleId === r.id)) p[x.module as AppModule] = x.level as Level;
      return { id: r.id, name: r.name, isSystem: r.isSystem, perms: p, members: ms.filter((m) => m.roleId === r.id).length, invitations: inv.filter((i) => i.roleId === r.id).length };
    });
  });
}

export type RoleResult = { ok: true; id: string; raised: { module: AppModule; to: Level; because: AppModule }[] } | { ok: false; error: string };
/** Crea (sin id) o edita un rol. El módulo «usuarios» no se puede dar a otros roles; las dependencias entre módulos se suben a Lectura y se avisan. */
export async function saveRole(db: Db, sub: string, studyId: string, input: { id?: string; name: string; perms: Partial<Record<AppModule, Level>> }): Promise<RoleResult> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) return { ok: false, error: "El nombre del rol debe tener entre 1 y 60 caracteres." };
  if (name.toLowerCase() === SUPER_ROLE.toLowerCase() && !input.id) return { ok: false, error: `«${SUPER_ROLE}» es un rol del sistema; use otro nombre.` };
  const { perms, raised } = normalizePermissions({ ...input.perms, usuarios: "none" });
  try {
    return await withRls(db, { sub }, async (tx): Promise<RoleResult> => {
      let id = input.id;
      const same = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.studyId, studyId), sql`lower(btrim(${roles.name})) = ${name.toLowerCase()}`));
      if (same.some((r) => r.id !== id)) return { ok: false, error: "Ya existe un rol con ese nombre." };
      if (id) {
        const [cur] = await tx.select().from(roles).where(and(eq(roles.id, id), eq(roles.studyId, studyId)));
        if (!cur) return { ok: false, error: "El rol ya no existe." };
        if (cur.isSystem) return { ok: false, error: `El rol «${cur.name}» es del sistema: no se puede modificar.` };
        await tx.update(roles).set({ name }).where(and(eq(roles.id, id), eq(roles.studyId, studyId)));
        await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, id), eq(rolePermissions.studyId, studyId)));
      } else {
        const [row] = await tx.insert(roles).values({ studyId, name }).returning({ id: roles.id });
        id = row.id;
      }
      await tx.insert(rolePermissions).values(MODULES.map((m) => ({ roleId: id!, studyId, module: m, level: perms[m] })));
      await audit(tx, studyId, sub, input.id ? "update" : "insert", "role", id!, { name: { from: null, to: name }, permisos: { from: null, to: MODULES.filter((m) => perms[m] !== "none").map((m) => `${m}:${perms[m]}`).join(", ") } });
      return { ok: true, id: id!, raised };
    });
  } catch (e) {
    const m = pgMessage(e);
    if (m.code === "23505") return { ok: false, error: "Ya existe un rol con ese nombre." };
    if (m.code === "42501") return { ok: false, error: "No tiene permiso para administrar roles." };
    if (m.code === "23514") return { ok: false, error: m.message };
    throw e;
  }
}

export async function deleteRole(db: Db, sub: string, studyId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await withRls(db, { sub }, async (tx) => {
      const [cur] = await tx.select().from(roles).where(and(eq(roles.id, id), eq(roles.studyId, studyId)));
      if (!cur) return { ok: false as const, error: "El rol ya no existe." };
      if (cur.isSystem) return { ok: false as const, error: `El rol «${cur.name}» es del sistema: no se puede borrar.` };
      const used = (await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.studyId, studyId), eq(memberships.roleId, id)))).length;
      if (used > 0) return { ok: false as const, error: `El rol lo tienen ${used} persona(s). Cámbieles el rol antes de borrarlo.` };
      await tx.delete(invitations).where(and(eq(invitations.studyId, studyId), eq(invitations.roleId, id), isNull(invitations.usedAt)));
      await tx.delete(roles).where(and(eq(roles.id, id), eq(roles.studyId, studyId)));
      await audit(tx, studyId, sub, "delete", "role", id, { name: { from: cur.name, to: null } });
      return { ok: true as const };
    });
  } catch (e) {
    const m = pgMessage(e);
    if (m.code === "23503") return { ok: false, error: "El rol está en uso (personas o invitaciones ya aceptadas). Cámbieles el rol antes de borrarlo." };
    if (m.code === "42501") return { ok: false, error: "No tiene permiso para administrar roles." };
    throw e;
  }
}

/** Guarda el correo de quien administra en su propia membresía (las membresías creadas antes de D-91 no lo tienen y auth.users no se puede leer desde la aplicación). */
export async function rememberOwnEmail(db: Db, sub: string, studyId: string, email: string | null): Promise<void> {
  if (!email) return;
  await withRls(db, { sub }, async (tx) => {
    const [m] = await tx.select({ email: memberships.email }).from(memberships).where(and(eq(memberships.studyId, studyId), eq(memberships.userId, sub)));
    if (m && !m.email) await tx.update(memberships).set({ email: email.toLowerCase() }).where(and(eq(memberships.studyId, studyId), eq(memberships.userId, sub)));
  }).catch(() => undefined);
}

/* ───────── Personas ───────── */
export interface MemberView { userId: string; email: string | null; roleId: string | null; roleName: string; allAreas: boolean; areas: string[]; isSelf: boolean; since: Date }
export async function listMembers(db: Db, sub: string, studyId: string): Promise<MemberView[]> {
  return withRls(db, { sub }, async (tx) => {
    const ms = await tx.select().from(memberships).where(eq(memberships.studyId, studyId)).orderBy(asc(memberships.createdAt));
    const rs = new Map((await tx.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.studyId, studyId))).map((r) => [r.id, r.name]));
    const as = new Map((await tx.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.studyId, studyId))).map((a) => [a.id, a.name]));
    const ma = await tx.select().from(memberAreas).where(eq(memberAreas.studyId, studyId));
    return ms.map((m) => ({
      userId: m.userId, email: m.email, roleId: m.roleId, roleName: m.roleId ? rs.get(m.roleId) ?? "" : m.role === "owner" ? SUPER_ROLE : m.role === "viewer" ? "Lector" : "Editor",
      allAreas: m.allAreas, areas: ma.filter((x) => x.userId === m.userId).map((x) => as.get(x.areaId) ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b, "es")), isSelf: m.userId === sub, since: m.createdAt,
    }));
  });
}

type Res = { ok: true } | { ok: false; error: string };
const friendly = (e: unknown, fallback: string): Res => {
  const m = pgMessage(e);
  if (m.code === "23514") return { ok: false, error: m.message };
  if (m.code === "42501") return { ok: false, error: "No tiene permiso para administrar usuarios." };
  throw e instanceof Error ? e : new Error(fallback);
};

async function checkRoleAndAreas(tx: Tx, studyId: string, roleId: string, allAreas: boolean, areaIds: string[]): Promise<string | null> {
  const [r] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.id, roleId), eq(roles.studyId, studyId)));
  if (!r) return "El rol elegido ya no existe.";
  if (!allAreas) {
    if (areaIds.length === 0) return "Marque al menos un área, o elija «Todas las áreas».";
    const ok = await tx.select({ id: areas.id }).from(areas).where(and(eq(areas.studyId, studyId), inArray(areas.id, areaIds)));
    if (ok.length !== new Set(areaIds).size) return "Alguna de las áreas elegidas ya no existe.";
  }
  return null;
}
const isSuper = async (tx: Tx, studyId: string, roleId: string) => (await tx.select({ l: rolePermissions.level }).from(rolePermissions).where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.studyId, studyId), eq(rolePermissions.module, "usuarios"))))[0]?.l === "edit";

/** Cambia el rol y las áreas de una persona. */
export async function updateMember(db: Db, sub: string, studyId: string, userId: string, input: { roleId: string; allAreas: boolean; areaIds: string[] }): Promise<Res> {
  try {
    return await withRls(db, { sub }, async (tx): Promise<Res> => {
      const bad = await checkRoleAndAreas(tx, studyId, input.roleId, input.allAreas, input.areaIds);
      if (bad) return { ok: false, error: bad };
      const [cur] = await tx.select().from(memberships).where(and(eq(memberships.studyId, studyId), eq(memberships.userId, userId)));
      if (!cur) return { ok: false, error: "La persona ya no tiene acceso a este estudio." };
      if (userId === sub && !(await isSuper(tx, studyId, input.roleId))) return { ok: false, error: "No puede quitarse a sí mismo el rol de Super usuario: pídaselo a otro Super usuario." };
      const legacy = (await isSuper(tx, studyId, input.roleId)) ? "owner" : "editor";
      await tx.update(memberships).set({ roleId: input.roleId, allAreas: input.allAreas, role: legacy }).where(and(eq(memberships.studyId, studyId), eq(memberships.userId, userId)));
      await tx.delete(memberAreas).where(and(eq(memberAreas.studyId, studyId), eq(memberAreas.userId, userId)));
      if (!input.allAreas) await tx.insert(memberAreas).values([...new Set(input.areaIds)].map((areaId) => ({ studyId, userId, areaId })));
      await audit(tx, studyId, sub, "update", "membership", cur.id, { rol: { from: cur.roleId, to: input.roleId }, areas: { from: cur.allAreas ? "todas" : "algunas", to: input.allAreas ? "todas" : `${new Set(input.areaIds).size} área(s)` } });
      return { ok: true };
    });
  } catch (e) { return friendly(e, "No se pudo guardar"); }
}

/** Quita el acceso de una persona (lo que editó se conserva). Siempre debe quedar al menos un Super usuario. */
export async function removeMember(db: Db, sub: string, studyId: string, userId: string): Promise<Res> {
  try {
    if (userId === sub) return { ok: false, error: "No puede quitarse su propio acceso: pídaselo a otro Super usuario." };
    return await withRls(db, { sub }, async (tx): Promise<Res> => {
      const gone = await tx.delete(memberships).where(and(eq(memberships.studyId, studyId), eq(memberships.userId, userId))).returning({ id: memberships.id });
      if (!gone.length) return { ok: false, error: "La persona ya no tiene acceso a este estudio." };
      await audit(tx, studyId, sub, "delete", "membership", gone[0].id, { acceso: { from: "con acceso", to: "sin acceso" } });
      return { ok: true };
    });
  } catch (e) { return friendly(e, "No se pudo quitar el acceso"); }
}

/* ───────── Invitaciones ───────── */
export interface InvitationView { id: string; email: string; roleName: string; allAreas: boolean; areaCount: number; expiresAt: Date; usedAt: Date | null; createdAt: Date; status: "pendiente" | "usada" | "vencida" }
export async function listInvitations(db: Db, sub: string, studyId: string): Promise<InvitationView[]> {
  return withRls(db, { sub }, async (tx) => {
    const rs = new Map((await tx.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.studyId, studyId))).map((r) => [r.id, r.name]));
    const rows = await tx.select().from(invitations).where(eq(invitations.studyId, studyId)).orderBy(sql`${invitations.createdAt} desc`);
    const now = Date.now();
    return rows.map((i) => ({ id: i.id, email: i.email, roleName: rs.get(i.roleId) ?? "", allAreas: i.allAreas, areaCount: i.areaIds.length, expiresAt: i.expiresAt, usedAt: i.usedAt, createdAt: i.createdAt, status: i.usedAt ? "usada" as const : i.expiresAt.getTime() <= now ? "vencida" as const : "pendiente" as const }));
  });
}

/** Crea una invitación y devuelve el enlace (token) UNA sola vez: en la base solo queda su hash. */
export async function createInvitation(db: Db, sub: string, studyId: string, input: { email: string; roleId: string; allAreas: boolean; areaIds: string[] }): Promise<{ ok: true; token: string; expiresAt: Date } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Escriba un correo válido." };
  try {
    return await withRls(db, { sub }, async (tx) => {
      const bad = await checkRoleAndAreas(tx, studyId, input.roleId, input.allAreas, input.areaIds);
      if (bad) return { ok: false as const, error: bad };
      const already = (await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.studyId, studyId), sql`lower(${memberships.email}) = ${email}`))).length;
      if (already) return { ok: false as const, error: "Esa persona ya tiene acceso: cámbiele el rol en la lista de usuarios." };
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);
      // Una invitación nueva para el mismo correo reemplaza a las pendientes anteriores (solo sirve el último enlace).
      await tx.delete(invitations).where(and(eq(invitations.studyId, studyId), eq(invitations.email, email), isNull(invitations.usedAt)));
      const [row] = await tx.insert(invitations).values({ studyId, email, roleId: input.roleId, allAreas: input.allAreas, areaIds: input.allAreas ? [] : [...new Set(input.areaIds)], tokenHash: hashToken(token), expiresAt, createdBy: sub }).returning({ id: invitations.id });
      await audit(tx, studyId, sub, "insert", "invitation", row.id, { correo: { from: null, to: email }, rol: { from: null, to: input.roleId } });
      return { ok: true as const, token, expiresAt };
    });
  } catch (e) { const r = friendly(e, "No se pudo crear la invitación"); return { ok: false, error: (r as { error: string }).error }; }
}

export async function revokeInvitation(db: Db, sub: string, studyId: string, id: string): Promise<Res> {
  try {
    return await withRls(db, { sub }, async (tx): Promise<Res> => {
      const gone = await tx.delete(invitations).where(and(eq(invitations.id, id), eq(invitations.studyId, studyId), isNull(invitations.usedAt))).returning({ email: invitations.email });
      if (!gone.length) return { ok: false, error: "La invitación ya no existe o ya fue usada." };
      await audit(tx, studyId, sub, "delete", "invitation", id, { correo: { from: gone[0].email, to: null } });
      return { ok: true };
    });
  } catch (e) { return friendly(e, "No se pudo revocar"); }
}

/** Datos mínimos de una invitación para la página del enlace (todavía sin sesión). Usa la función segura invitation_lookup. */
export async function lookupInvitation(db: Db, token: string): Promise<{ email: string; roleName: string; studyName: string; valid: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const rows = (await db.execute(sql`select email, role_name, study_name, valid from public.invitation_lookup(${hashToken(token)})`)) as unknown as { email: string; role_name: string; study_name: string; valid: boolean }[];
  return rows[0] ? { email: rows[0].email, roleName: rows[0].role_name, studyName: rows[0].study_name, valid: rows[0].valid } : null;
}

/** Acepta la invitación con la sesión actual: la base comprueba que el correo de la sesión es el invitado y que el enlace sirve. */
export async function redeemInvitation(db: Db, sub: string, email: string, token: string): Promise<{ ok: true; studyId: string } | { ok: false; error: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, error: "La invitación no es válida, ya se usó o venció." };
  try {
    const rows = await withRls(db, { sub, email }, (tx) => tx.execute(sql`select private.redeem_invitation(${hashToken(token)}) as study_id`)) as unknown as { study_id: string }[];
    return { ok: true, studyId: rows[0].study_id };
  } catch (e) {
    const m = pgMessage(e);
    if (m.code === "P0001" || m.code === "28000") return { ok: false, error: m.message };
    throw e;
  }
}
