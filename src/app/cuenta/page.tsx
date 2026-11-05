import { redirect } from "next/navigation";
import { getUser, hasPasswordLogin } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { LEVEL_LABEL, MODULES, MODULE_LABEL } from "@/domain/access";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password-change";
import { changePasswordAction, saveNameAction } from "./actions";

export const metadata = { title: "Mi cuenta" };
export default async function Cuenta({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  const sp = await searchParams;
  const a = study?.access ?? null;
  const withPassword = await hasPasswordLogin();
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
      <section className="card" aria-label="Mi clave">
        <h2>Mi clave</h2>
        {withPassword ? (
          <>
            <p className="note">Para cambiarla escriba la clave actual y la nueva ({PASSWORD_MIN} a {PASSWORD_MAX} caracteres).</p>
            <form action={changePasswordAction} className="stack-form">
              <div className="field"><label htmlFor="c-actual">Clave actual</label><input id="c-actual" name="actual" type="password" autoComplete="current-password" required disabled={!!user!.viewAs} /></div>
              <div className="field"><label htmlFor="c-nueva">Clave nueva</label><input id="c-nueva" name="nueva" type="password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" required disabled={!!user!.viewAs} /></div>
              <div className="field"><label htmlFor="c-repetir">Repita la clave nueva</label><input id="c-repetir" name="repetir" type="password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" required disabled={!!user!.viewAs} /></div>
              <div className="form-actions" style={{ position: "static", borderTop: 0, padding: 0 }}><button className="btn solid" type="submit" disabled={!!user!.viewAs}>Cambiar clave</button></div>
            </form>
          </>
        ) : <p className="note">Usted entra con Google, por eso esta cuenta no tiene una clave en la aplicación. Su clave es la de su cuenta de Google.</p>}
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
