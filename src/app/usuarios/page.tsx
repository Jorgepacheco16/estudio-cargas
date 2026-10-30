import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listAreas } from "@/server/studies";
import { legacyPerms, listInvitations, listMembers, listRoles, rememberOwnEmail, type MemberView, type RoleView } from "@/server/access";
import { LEVEL_LABEL, MODULES, MODULE_LABEL, allPermissions, summarizePermissions, type Level, type Permissions } from "@/domain/access";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PagedTable } from "@/components/PagedTable";
import { InviteForm } from "@/components/usuarios/InviteForm";
import { deleteRoleAction, removeMemberAction, revokeInvitationAction, viewAsAction } from "./actions";

export const metadata = { title: "Usuarios y roles" };
const VISTAS = [["personas", "Personas"], ["roles", "Roles"], ["permisos", "Cuadro de permisos"]] as const;
const when = (d: Date) => d.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" });

function permsOf(m: MemberView, roles: Map<string, RoleView>): Permissions {
  if (m.roleId && roles.has(m.roleId)) return roles.get(m.roleId)!.perms;
  return m.roleName === "Super usuario" ? allPermissions("edit") : legacyPerms(m.roleName === "Lector" ? "viewer" : "editor");
}
const Pill = ({ level }: { level: Level }) => <span className={`pill ${level === "edit" ? "ok" : level === "read" ? "low" : "nodata"}`} style={{ whiteSpace: "nowrap" }}>{LEVEL_LABEL[level]}</span>;
const areasText = (m: MemberView) => (m.allAreas ? "Todas las áreas" : m.areas.length ? m.areas.join(", ") : "Ninguna");

export default async function Usuarios({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  if (!study!.access?.isAdmin) redirect("/sin-acceso?m=usuarios");
  const sp = await searchParams;
  const vista = VISTAS.some(([v]) => v === sp.vista) ? sp.vista! : "personas";
  const db = getDb();
  await rememberOwnEmail(db, user!.id, study!.id, user!.email);
  const [roles, members, invites, areas] = await Promise.all([listRoles(db, user!.id, study!.id), listMembers(db, user!.id, study!.id), listInvitations(db, user!.id, study!.id), listAreas(db, user!.id, study!.id)]);
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const pending = invites.filter((i) => i.status === "pendiente");

  return (
    <main>
      <div className="head"><div><h1>Usuarios y roles</h1><div className="sub">Quién entra a la aplicación y qué puede hacer · {study!.name}</div></div></div>
      {sp.ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      <div className="tabs" role="tablist" aria-label="Vistas">{VISTAS.map(([v, l]) => <Link key={v} href={`/usuarios?vista=${v}`} role="tab" aria-selected={v === vista} className={v === vista ? "on" : ""}>{l}</Link>)}</div>

      {vista === "personas" && (
        <>
          <section className="card" aria-label="Personas con acceso">
            <h2>Personas con acceso ({members.length})</h2>
            <p className="note">Cada persona tiene un rol (qué módulos ve y edita) y unas áreas. Para cambiarlos, abra «Editar».</p>
            <PagedTable
              head={<tr><th>Persona</th><th>Rol</th><th>Áreas</th><th>Desde</th><th>Acciones</th></tr>}
              rows={members.map((m) => (
                <tr key={m.userId}>
                  <td><b>{m.name ?? m.email ?? "—"}</b>{m.name && m.email && <div className="muted">{m.email}</div>}{m.isSelf && <span className="muted"> · usted</span>}</td>
                  <td>{m.roleName}</td>
                  <td>{areasText(m)}</td>
                  <td>{when(m.since)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link className="btn" href={`/usuarios/persona/${m.userId}`}>Editar</Link>{" "}
                    {!m.isSelf && <form action={viewAsAction} style={{ display: "inline" }}><input type="hidden" name="persona" value={m.userId} /><button className="btn" type="submit" title="Ver la aplicación como la vería esta persona (solo lectura)">Ver como</button></form>}{" "}
                    {!m.isSelf && <form action={removeMemberAction} style={{ display: "inline" }}><input type="hidden" name="persona" value={m.userId} /><ConfirmButton title="¿Quitar el acceso de esta persona?" message={<>Dejará de poder entrar a este estudio: <b>{m.email ?? "esta persona"}</b>. Lo que editó se conserva.</>} confirmLabel="Quitar acceso">Quitar acceso</ConfirmButton></form>}
                  </td>
                </tr>
              ))}
            />
          </section>

          <section className="card" aria-label="Invitar a una persona">
            <h2>Invitar a una persona</h2>
            <p className="note">Escriba su correo, elija el rol y las áreas. La aplicación genera un enlace de un solo uso que usted le envía; con él la persona crea su clave (o entra con Google si su correo es de Google).</p>
            <InviteForm roles={roles.map((r) => ({ id: r.id, name: r.name, summary: summarizePermissions(r.perms) }))} areas={areas} />
          </section>

          <section className="card" aria-label="Invitaciones">
            <h2>Invitaciones ({pending.length} pendiente{pending.length === 1 ? "" : "s"})</h2>
            {invites.length === 0 ? <div className="empty">Aún no hay invitaciones.</div> : (
              <PagedTable
                head={<tr><th>Correo</th><th>Rol</th><th>Estado</th><th>Vence</th><th>Acciones</th></tr>}
                rows={invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td><td>{i.roleName}</td>
                    <td><span className={`pill ${i.status === "pendiente" ? "low" : i.status === "usada" ? "ok" : "nodata"}`}>{i.status === "pendiente" ? "Pendiente" : i.status === "usada" ? "Aceptada" : "Vencida"}</span></td>
                    <td>{i.usedAt ? `Aceptada el ${when(i.usedAt)}` : when(i.expiresAt)}</td>
                    <td>{i.status !== "usada" && <form action={revokeInvitationAction}><input type="hidden" name="id" value={i.id} /><ConfirmButton title="¿Revocar esta invitación?" message={<>El enlace enviado a <b>{i.email}</b> dejará de servir.</>} confirmLabel="Revocar">Revocar</ConfirmButton></form>}</td>
                  </tr>
                ))}
              />
            )}
          </section>
        </>
      )}

      {vista === "roles" && (
        <section className="card" aria-label="Roles">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
            <h2>Roles ({roles.length})</h2>
            <Link className="btn solid" href="/usuarios/roles/nuevo">+ Nuevo rol</Link>
          </div>
          <p className="note">Un rol define, para cada módulo, si la persona no tiene acceso, solo lee o puede editar. Al cambiar un rol quedan actualizadas todas las personas que lo tienen. «Super usuario» es del sistema: no se modifica ni se borra.</p>
          <PagedTable
            head={<tr><th>Rol</th><th>Qué permite</th><th>Personas</th><th>Invitaciones</th><th>Acciones</th></tr>}
            rows={roles.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b>{r.isSystem && <span className="muted"> · del sistema</span>}</td>
                <td>{summarizePermissions(r.perms)}</td>
                <td className="num">{r.members}</td><td className="num">{r.invitations}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.isSystem ? <span className="muted">No se modifica</span> : (
                    <>
                      <Link className="btn" href={`/usuarios/roles/${r.id}`}>Editar</Link>{" "}
                      <form action={deleteRoleAction} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><ConfirmButton title="¿Eliminar este rol?" message={<>Se eliminará el rol <b>{r.name}</b>. Si lo tiene alguna persona, primero cámbiele el rol.</>}>Eliminar</ConfirmButton></form>
                    </>
                  )}
                </td>
              </tr>
            ))}
          />
        </section>
      )}

      {vista === "permisos" && (
        <section className="card" aria-label="Cuadro de permisos">
          <h2>Cuadro de permisos</h2>
          <p className="note">Lo que cada persona puede hacer en cada módulo, según su rol, y las áreas en que puede trabajar. Para ver la aplicación tal como la ve una persona, use «Ver como» en la lista de personas.</p>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Cuadro de permisos desplazable">
            <table style={{ minWidth: 1100 }}>
              <thead><tr><th>Persona</th><th>Rol</th>{MODULES.filter((m) => m !== "usuarios").map((m) => <th key={m}>{MODULE_LABEL[m]}</th>)}<th>Áreas</th></tr></thead>
              <tbody>
                {members.map((m) => {
                  const p = permsOf(m, rolesById);
                  return <tr key={m.userId}><td><b>{m.name ?? m.email ?? "—"}</b>{m.name && m.email && <div className="muted">{m.email}</div>}</td><td>{m.roleName}</td>{MODULES.filter((x) => x !== "usuarios").map((x) => <td key={x}><Pill level={p[x]} /></td>)}<td>{areasText(m)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
