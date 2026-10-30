import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { LEVEL_LABEL, MODULES, MODULE_LABEL } from "@/domain/access";
import { saveNameAction } from "./actions";

export const metadata = { title: "Mi cuenta" };
export default async function Cuenta({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  const sp = await searchParams;
  const a = study?.access ?? null;
  return (
    <main>
      <div className="head"><div><h1>Mi cuenta</h1><div className="sub">Cómo se le ve en la aplicación y qué puede hacer</div></div></div>
      {sp.ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      <section className="card" aria-label="Mi nombre">
        <h2>Mi nombre</h2>
        <p className="note">Es el nombre con el que aparece en el encabezado y en la lista de usuarios. Su correo ({user!.email ?? "sin correo"}) no cambia.</p>
        {study ? (
          <form action={saveNameAction} className="stack-form">
            <div className="field"><label htmlFor="c-nombre">Nombre</label><input id="c-nombre" name="nombre" maxLength={80} defaultValue={a?.displayName ?? ""} placeholder="Ej.: Ana Pérez" autoComplete="name" disabled={!!user!.viewAs} /></div>
            <div className="form-actions" style={{ position: "static", borderTop: 0, padding: 0 }}><button className="btn solid" type="submit" disabled={!!user!.viewAs}>Guardar nombre</button></div>
          </form>
        ) : <div className="empty">Aún no tiene un estudio asignado.</div>}
      </section>
      {a && (
        <section className="card" aria-label="Mi acceso">
          <h2>Mi acceso</h2>
          <p>Rol: <b>{a.roleName}</b> · Áreas: <b>{a.allAreas ? "todas" : "solo las que le asignaron"}</b></p>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Mis permisos">
            <table><thead><tr><th>Módulo</th><th>Nivel</th></tr></thead>
              <tbody>{MODULES.filter((m) => m !== "usuarios").map((m) => <tr key={m}><td>{MODULE_LABEL[m]}</td><td>{LEVEL_LABEL[a.perms[m]]}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
