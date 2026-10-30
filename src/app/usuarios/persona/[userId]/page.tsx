import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listAreas } from "@/server/studies";
import { listMembers, listRoles } from "@/server/access";
import { summarizePermissions } from "@/domain/access";
import { AreaPicker } from "@/components/usuarios/AreaPicker";
import { updateMemberAction } from "../../actions";

export const metadata = { title: "Editar persona" };
export default async function EditarPersona({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study?.access?.isAdmin) redirect("/sin-acceso?m=usuarios");
  const db = getDb();
  const [members, roles, areas] = await Promise.all([listMembers(db, user!.id, study!.id), listRoles(db, user!.id, study!.id), listAreas(db, user!.id, study!.id)]);
  const m = members.find((x) => x.userId === userId);
  if (!m) notFound();
  const selected = areas.filter((a) => m!.areas.includes(a.name)).map((a) => a.id);
  return (
    <main>
      <div className="head"><div><h1>Editar persona</h1><div className="sub">{m!.name ? `${m!.name} · ` : ""}{m!.email ?? "Sin correo registrado"}{m!.isSelf ? " · usted" : ""}</div></div><div className="tools"><Link className="btn" href="/usuarios?vista=personas">← Volver a personas</Link></div></div>
      <form action={updateMemberAction} className="entry-form">
        <input type="hidden" name="persona" value={m!.userId} />
        <section className="card">
          <div className="form-grid">
            <div className="field span-two"><label htmlFor="p-rol">Rol</label>
              <select id="p-rol" name="rol" defaultValue={m!.roleId ?? ""} disabled={m!.isSelf} required>
                {!m!.roleId && <option value="" disabled>(sin rol: elija uno)</option>}
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name} — {summarizePermissions(r.perms)}</option>)}
              </select>
              {m!.isSelf && <p className="hint">Su propio rol no se cambia desde aquí: pídaselo a otro Super usuario.</p>}
            </div>
          </div>
          <AreaPicker areas={areas} allAreas={m!.allAreas} selected={selected} disabled={m!.isSelf} />
          {!m!.isSelf && <div className="form-actions" style={{ position: "static", borderTop: 0, padding: 0 }}><button className="btn solid" type="submit">Guardar cambios</button><Link className="btn" href="/usuarios?vista=personas">Cancelar</Link></div>}
        </section>
      </form>
    </main>
  );
}
