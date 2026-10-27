import Link from "next/link";
import { redirect } from "next/navigation";
import { activeStudyId } from "@/data/source";
import { getUser } from "@/lib/supabase/server";
import { basePath } from "@/lib/entry-routes";
import { BULK_MAX_ROWS } from "@/server/entry/bulk-file";
import { entryDef, type EntryId } from "@/server/entry/defs";
import { BulkUpload } from "@/components/entry/BulkUpload";

/** Pantalla de carga masiva de una sección (D-72): descargar plantilla, subir el archivo, revisar y aplicar. */
export async function BulkPage({ hoja }: { hoja: EntryId }) {
  const def = entryDef(hoja)!;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  const base = basePath(hoja);
  if (study!.role === "viewer") redirect(`${base}?error=${encodeURIComponent("Su rol es de solo lectura: no puede cargar datos.")}`);
  return (
    <main>
      <div className="head">
        <div><h1>Carga masiva · {def.short}</h1><div className="sub">Estudio: {study!.name} · máximo {BULK_MAX_ROWS[hoja]} filas por carga</div></div>
        <div className="tools"><Link className="btn" href={base}>← Volver a {def.short}</Link></div>
      </div>
      <section className="card">
        <h2>Cómo funciona</h2>
        <ol style={{ margin: "0 0 12px", paddingLeft: 20 }}>
          <li>Descargue la plantilla y diligénciela (una fila por registro; los campos con * son obligatorios).{hoja === "2" ? " Los turnos de cada cargo van en la hoja «Turnos» y la descripción de la operación en una columna de «Datos»." : hoja === "3" ? " Los turnos de cada actividad se escriben por su nombre (o «Todos los turnos»)." : " Los códigos de actividad que cite deben existir ya en la aplicación."}</li>
          <li>Súbala aquí: la aplicación la <b>revisa sin guardar nada</b> y le dice qué se crearía, qué se actualizaría y qué errores hay.</li>
          <li>Si todo está bien, aplique la carga. Es <b>todo o nada</b>: con un solo error no se guarda nada. Si hay registros que ya existen, deberá marcar «Actualizar existentes».</li>
        </ol>
        <a className="btn solid" href={`/api/plantilla/${hoja}`}>Descargar plantilla de {def.short.toLowerCase()}</a>
      </section>
      <BulkUpload hoja={hoja} base={base} title={def.short} />
    </main>
  );
}
