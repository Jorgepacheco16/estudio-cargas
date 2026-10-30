import Link from "next/link";
import { LEVELS, LEVEL_LABEL, MODULES, MODULE_LABEL, REQUIRES, type AppModule, type Level, type Permissions } from "@/domain/access";
import { saveRoleAction } from "@/app/usuarios/actions";

/** Formulario de un rol: nombre y, por módulo, Sin acceso · Lectura · Edición. «Usuarios y roles» no se concede a otros roles. */
export function RoleForm({ id, name = "", perms }: { id?: string; name?: string; perms?: Permissions }) {
  const mods = MODULES.filter((m) => m !== "usuarios");
  return (
    <form action={saveRoleAction} className="entry-form">
      {id && <input type="hidden" name="id" value={id} />}
      <section className="card">
        <div className="form-grid">
          <div className="field span-two"><label htmlFor="rol-nombre">Nombre del rol <span className="req" title="Obligatorio">*</span></label><input id="rol-nombre" name="nombre" required maxLength={60} defaultValue={name} placeholder="Ej.: Capturista de actividades" /></div>
        </div>
        <p className="note">Para cada módulo elija el nivel de acceso. <b>Edición</b> incluye <b>Lectura</b>. Si un módulo necesita leer otro (por ejemplo, Medibilidad necesita leer Actividades), al guardar se sube a Lectura automáticamente y se le avisa.</p>
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Niveles por módulo">
          <table>
            <thead><tr><th>Módulo</th>{LEVELS.map((l) => <th key={l} style={{ textAlign: "center" }}>{LEVEL_LABEL[l]}</th>)}<th>Necesita</th></tr></thead>
            <tbody>
              {mods.map((m) => {
                const cur: Level = perms?.[m] ?? "none";
                const needs = Object.keys(REQUIRES[m] ?? {}).map((d) => MODULE_LABEL[d as AppModule]).join(", ");
                return (
                  <tr key={m}>
                    <td><b>{MODULE_LABEL[m]}</b></td>
                    {LEVELS.map((l) => <td key={l} style={{ textAlign: "center" }}><input type="radio" name={`perm_${m}`} value={l} defaultChecked={cur === l} aria-label={`${MODULE_LABEL[m]}: ${LEVEL_LABEL[l]}`} /></td>)}
                    <td className="muted">{needs ? `Lectura de ${needs}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="form-actions" style={{ position: "static", borderTop: 0, padding: 0 }}><button className="btn solid" type="submit">Guardar rol</button><Link className="btn" href="/usuarios?vista=roles">Cancelar</Link></div>
      </section>
    </form>
  );
}
