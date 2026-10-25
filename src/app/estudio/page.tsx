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
        <div><h1>Estudio</h1><Purpose k="estudio" /><div className="sub">Sesión: {user!.email ?? "usuario"}{active ? ` · ${active.name} (${ROLE[active.role] ?? active.role})` : ""}</div></div>
      </div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}

      <section className="card">
        <h2>Estudios</h2>
        {studies.length > 0 && (
          <form action={selectStudyAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
            <label className="f">Estudio activo
              <select name="id" defaultValue={active?.id}>{studies.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE[s.role] ?? s.role}</option>)}</select>
            </label>
            <button className="btn" type="submit">Usar este estudio</button>
          </form>
        )}
        <form action={createStudyAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <label className="f">Nuevo estudio<input name="name" required minLength={3} maxLength={120} placeholder="Nombre del estudio" /></label>
          <label className="f">Descripción (opcional)<input name="description" maxLength={300} /></label>
          <button className="btn solid" type="submit">Crear estudio</button>
        </form>
        <p className="note">Al crear un estudio se cargan las 14 áreas operativas del Excel y los parámetros por defecto.</p>
        {active && <p style={{ marginTop: 12 }}><a className="btn" href="/api/respaldo" download>Descargar respaldo completo (Excel)</a></p>}
      </section>

      {active && (
        <section className="card">
          <h2>Captura de datos</h2>
          <p className="note">La aplicación es la fuente de los datos: cada dato se ingresa en su sección (Parámetros, Cargos y dotación, Actividades y Diagnóstico y rediseño) y se escribe automáticamente en la hoja de Google. Las columnas con fórmula se muestran como valores calculados, sin edición.</p>
          <p style={{ marginTop: 12 }}><a className="btn solid" href="/cargos">Ir a Cargos y dotación</a></p>
        </section>
      )}
    </main>
  );
}

