import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { allEntryDefs } from "@/server/entry/defs";
import { listConnections } from "@/server/sheets/sync";

export default async function Datos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  const conn = study ? (await listConnections(getDb(), user!.id, study.id)).find((c) => c.mode === "push" || c.mode === "bidirectional") : undefined;
  return (
    <main>
      <div className="head"><div><h1>Datos de entrada (se retira en el paso 2)</h1><div className="sub">{study ? study.name : "Sin estudio activo"} · la aplicación es la fuente: todo lo que se captura aquí se escribe en la hoja de Google</div></div></div>
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      {!study && <div className="banner">Cree o seleccione un estudio en <Link href="/estudio">Estudio</Link>.</div>}
      {study && !conn && <div className="banner">No hay una hoja de Google conectada en modo «la app alimenta la hoja». Los datos se guardan en la app; conecte la hoja en <Link href="/integraciones">Integraciones</Link>.</div>}
      {study && (
        <section className="card">
          <h2>Hojas del libro con casillas de entrada</h2>
          <p className="note">Cada casilla amarilla del libro tiene su campo aquí, con el mismo encabezado y la misma lista desplegable. Las columnas con fórmula (grises) se muestran como valores calculados, sin edición.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginTop: 12 }}>
            <Link className="card" href="/datos/parametros"><b>Parámetros y áreas</b><div className="muted">Supuestos, pesos, umbrales y lista de áreas</div></Link>
            {allEntryDefs().map((d) => (
              <Link key={d.id} className="card" href={`/datos/${d.id}`}><b>{d.short}</b><div className="muted">{d.fields.length} campos de entrada · {d.computed.length} calculados</div></Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
