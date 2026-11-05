"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { VIEWAS_COOKIE, signViewAs, viewAsConfigured } from "@/lib/viewas";
import { LEVELS, MODULES, MODULE_LABEL, isLevel, type AppModule, type Level } from "@/domain/access";
import { adminSetPassword, createInvitation, deleteRole, listMembers, removeMember, revokeInvitation, saveRole, updateMember } from "@/server/access";
import { generateTempPassword, hashPassword } from "@/lib/temp-password";
import { isBlocked, recordFailure } from "@/lib/ratelimit";

/** Acciones de «Usuarios y roles» (D-91). Solo el Super usuario las ejecuta; además la base de datos las hace cumplir. */
export interface InviteState { ok?: boolean; error?: string; link?: string; email?: string; expires?: string }

export interface PasswordState { ok?: boolean; error?: string; temp?: string; email?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const back = (vista: string, kind: "ok" | "error", msg: string): never => redirect(`/usuarios?vista=${vista}&${kind}=${encodeURIComponent(msg)}`);

async function admin() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  if (!study!.access?.isAdmin || user!.viewAs) redirect("/sin-acceso?m=usuarios");
  return { user: user!, study: study! };
}
/** «Todas las áreas» o las marcadas. */
const areasOf = (fd: FormData) => ({ allAreas: str(fd, "alcance") !== "algunas", areaIds: fd.getAll("area").map(String).filter((x) => UUID.test(x)) });

export async function inviteAction(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const { user, study } = await admin();
  const roleId = str(fd, "rol");
  if (!UUID.test(roleId)) return { error: "Elija el rol de la persona." };
  const r = await createInvitation(getDb(), user.id, study.id, { email: str(fd, "correo", 254), roleId, ...areasOf(fd) });
  if (!r.ok) return { error: r.error };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return { ok: true, email: str(fd, "correo", 254).toLowerCase(), link: `${origin}/invitacion/${r.token}`, expires: r.expiresAt.toISOString() };
}

export async function revokeInvitationAction(fd: FormData) {
  const { user, study } = await admin();
  const r = await revokeInvitation(getDb(), user.id, study.id, str(fd, "id"));
  back("personas", r.ok ? "ok" : "error", r.ok ? "Invitación revocada: el enlace ya no sirve." : r.error);
}

export async function updateMemberAction(fd: FormData) {
  const { user, study } = await admin();
  const target = str(fd, "persona"), roleId = str(fd, "rol");
  if (!UUID.test(target) || !UUID.test(roleId)) back("personas", "error", "Faltan datos de la persona o del rol.");
  const r = await updateMember(getDb(), user.id, study.id, target, { roleId, ...areasOf(fd) });
  back("personas", r.ok ? "ok" : "error", r.ok ? "Cambios guardados." : r.error);
}

export async function removeMemberAction(fd: FormData) {
  const { user, study } = await admin();
  const target = str(fd, "persona");
  if (!UUID.test(target)) back("personas", "error", "Falta la persona.");
  const r = await removeMember(getDb(), user.id, study.id, target);
  back("personas", r.ok ? "ok" : "error", r.ok ? "Acceso retirado. Lo que la persona editó se conserva." : r.error);
}

export async function saveRoleAction(fd: FormData) {
  const { user, study } = await admin();
  const id = str(fd, "id") || undefined;
  if (id && !UUID.test(id)) back("roles", "error", "Rol no válido.");
  const perms: Partial<Record<AppModule, Level>> = {};
  for (const m of MODULES) { const v = str(fd, `perm_${m}`); if (isLevel(v)) perms[m] = v; }
  const r = await saveRole(getDb(), user.id, study.id, { id, name: str(fd, "nombre", 60), perms });
  if (!r.ok) return back("roles", "error", r.error);
  const raised = r.raised.length ? ` Se subió a Lectura lo que otros módulos necesitan: ${[...new Set(r.raised.map((x) => `${MODULE_LABEL[x.module]} (por ${MODULE_LABEL[x.because]})`))].join(", ")}.` : "";
  back("roles", "ok", `Rol guardado.${raised}`);
}

export async function deleteRoleAction(fd: FormData) {
  const { user, study } = await admin();
  const r = await deleteRole(getDb(), user.id, study.id, str(fd, "id"));
  back("roles", r.ok ? "ok" : "error", r.ok ? "Rol eliminado." : r.error);
}

/** «Ver como»: el Super usuario ve la aplicación como la vería esa persona, solo lectura, 30 minutos. */
export async function viewAsAction(fd: FormData) {
  const { user, study } = await admin();
  const target = str(fd, "persona");
  if (!UUID.test(target) || target === user.id) back("personas", "error", "Elija a otra persona para ver la aplicación como ella.");
  if (!viewAsConfigured()) back("personas", "error", "«Ver como» no está disponible en este entorno (falta GUEST_SESSION_SECRET).");
  const member = (await listMembers(getDb(), user.id, study.id)).find((m) => m.userId === target);
  if (!member) back("personas", "error", "Esa persona no tiene acceso a este estudio.");
  const c = signViewAs(user.id, target);
  (await cookies()).set(VIEWAS_COOKIE, c.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: c.maxAge });
  redirect("/");
}

export async function exitViewAsAction() {
  (await cookies()).delete(VIEWAS_COOKIE);
  redirect("/usuarios?vista=personas");
}
void LEVELS;

/**
 * El Super usuario cambia la clave de otra persona (D-94). La aplicación genera una clave temporal, la cifra y solo el cifrado llega a la base (función segura, sin la
 * llave de servicio). La clave en texto se devuelve UNA vez a quien la pidió para que se la pase a la persona; no se guarda ni se audita. Cuenta cada cambio contra un
 * límite (20 por minuto) para frenar abusos de una sesión robada.
 */
export async function resetPasswordAction(_prev: PasswordState, fd: FormData): Promise<PasswordState> {
  const { user, study } = await admin();
  const target = str(fd, "persona");
  if (!UUID.test(target)) return { error: "Falta la persona." };
  const key = `resetpw:${user.id}`;
  if (isBlocked(key, 20)) return { error: "Demasiados cambios seguidos. Espere un minuto." };
  recordFailure(key, 60_000);
  const temp = generateTempPassword();
  const r = await adminSetPassword(getDb(), user.id, study.id, target, await hashPassword(temp));
  if (!r.ok) return { error: r.error };
  const email = (await listMembers(getDb(), user.id, study.id)).find((m) => m.userId === target)?.email ?? undefined;
  return { ok: true, temp, email };
}
