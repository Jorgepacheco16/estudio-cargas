import { Purpose } from "@/components/Purpose";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";


import { listStudies } from "@/server/studies";
import { createStudyAction, selectStudyAction } from "./actions";
const ROLE: Record<string, string> = { owner: "Propietario", editor: "Editor", analyst: "Analista", viewer: "Solo lectura" };

export const metadata = { title: "Estudio" };
export default async function Estudio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const studies = await listStudies(db, user!.id);
  const active = await activeStudyId(user!.id);


  return (
    <main>
      <div className="head">
        <div><h1>Estudio</h1><Purpose k="estudio" /><div className="sub">Sesión: {user!.email ?? "usuario"}{active ? ` · ${active.name} (${active.access?.roleName ?? ROLE[active.role] ?? active.role})` : ""}</div></div>
      </div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}

      <div className="grid-2">
        <section className="card" aria-label="Estudio activo">
          <h2>Estudio activo</h2>
          <p className="note">Todas las secciones muestran y guardan los datos del estudio activo.</p>
          {studies.length > 0 ? (
            <form action={selectStudyAction} className="stack-form">
              <div className="field">
                <label htmlFor="estudio-id">Estudio</label>
                <select id="estudio-id" name="id" defaultValue={active?.id}>{studies.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE[s.role] ?? s.role}</option>)}</select>
                <p className="hint">{active ? `Su rol en este estudio: ${active.access?.roleName ?? ROLE[active.role] ?? active.role}.` : ""}</p>
              </div>
              <div><button className="btn" type="submit">Usar este estudio</button></div>
            </form>
          ) : <div className="empty">Aún no tiene estudios. Cree el primero en el bloque de la derecha.</div>}
        </section>

        <section className="card" aria-label="Crear un estudio">
          <h2>Crear un estudio</h2>
          <p className="note">Al crear un estudio se cargan las 14 áreas operativas del Excel y los parámetros por defecto.</p>
          <form action={createStudyAction} className="stack-form">
            <div className="field">
              <label htmlFor="estudio-nombre">Nombre del nuevo estudio</label>
              <input id="estudio-nombre" name="name" required minLength={3} maxLength={120} />
              <p className="hint">Mínimo 3 caracteres.</p>
            </div>
            <div className="field">
              <label htmlFor="estudio-desc">Descripción (opcional)</label>
              <input id="estudio-desc" name="description" maxLength={300} />
              <p className="hint">Para qué se hace el estudio, centro de operaciones o período.</p>
            </div>
            <div><button className="btn solid" type="submit">Crear estudio</button></div>
          </form>
        </section>

        {active && (
          <section className="card" aria-label="Respaldo">
            <h2>Respaldo del estudio</h2>
            <p className="note">Descargue un Excel con todos los datos del estudio activo: cargos, actividades, evaluaciones y plan de acción.</p>
            <div className="stack-form"><div><a className="btn" href="/api/respaldo" download>Descargar respaldo completo (Excel)</a></div></div>
          </section>
        )}

        {active && (
          <section className="card" aria-label="Captura de datos">
            <h2>Captura de datos</h2>
            <p className="note">La aplicación es la fuente de los datos: cada dato se ingresa en su sección (Parámetros, Cargos y dotación, Actividades y Diagnóstico y rediseño) y se escribe automáticamente en la hoja de Google. Las columnas con fórmula se muestran como valores calculados, sin edición.</p>
            <div className="stack-form"><div><a className="btn solid" href="/cargos">Ir a Cargos y dotación</a></div></div>
          </section>
        )}
      </div>    </main>
  );
}

