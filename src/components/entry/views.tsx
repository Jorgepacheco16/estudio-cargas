import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { EntryForm } from "@/components/EntryForm";
import { entryDef, type EntryId } from "@/server/entry/defs";
import { entryOptions, getEntry, inputValue, listEntries } from "@/server/entry/service";
import { basePath } from "@/lib/entry-routes";
import { deleteEntryAction } from "@/app/entrada/actions";
import { formProps } from "@/app/entrada/form-props";

async function session() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  return { user: user!, study };
}

/** Texto de ayuda de cada sección con entradas: para qué sirve y qué falta para que se llene (estado vacío). */
const EMPTY: Record<string, string> = {
  "2": "Aquí se registran los cargos y su dotación: cuántas personas ocupan cada cargo y su jornada semanal. Con esos datos se calcula la capacidad disponible.",
  "3": "Aquí se registra cada actividad concreta de un cargo con su frecuencia y tiempo. Para que sume carga necesita el cargo (de Cargos y dotación) y los datos de tiempo.",
  "5": "Aquí se evalúa qué tan medible es cada actividad. Primero registre actividades; luego evalúe la que quiera.",
  "6": "Aquí se evalúa si la actividad corresponde al propósito del cargo y a sus competencias. Primero registre actividades.",
  "7": "Aquí se registran los riesgos si una actividad no se ejecuta o depende de pocas personas. Primero registre actividades.",
  "8": "Aquí se registran las oportunidades de mejora, con su impacto y facilidad, para priorizarlas. Puede asociarlas a una actividad.",
  "9": "Aquí se propone cómo redistribuir funciones de un cargo y qué carga tendría después. Primero registre el cargo en Cargos y dotación.",
  "10": "Aquí se programan las acciones de mejora con fechas, responsable y meta, y se sigue su cumplimiento.",
};

/** Lista de los registros de una sección con su botón «Agregar» (siempre visible) y las acciones editar / eliminar. Va dentro de la página de la sección. */
export async function EntrySection({ hoja, sp }: { hoja: EntryId; sp: Record<string, string | undefined> }) {
  const def = entryDef(hoja)!;
  const viewer = await getUser();
  if (!viewer) return <section className="card" aria-label={`Registros de ${def.short}`}><h2>Registros capturados</h2><div className="empty">Inicie sesión para ver y capturar los registros de esta sección. <Link href="/login">Ingresar</Link></div></section>; // las vistas de demostración son públicas
  const { user, study } = await session();
  const base = basePath(hoja);
  const canWrite = !!study && study.role !== "viewer";
  const rows = study ? (await listEntries(getDb(), user.id, study.id, hoja))?.rows ?? [] : [];
  const listCols = def.listFields.map((f) => def.fields.find((x) => x.field === f)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <section className="card" id="registros" aria-label={`Registros de ${def.short}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <h2>Registros capturados ({rows.length})</h2>
        {canWrite && <Link className="btn solid" href={`${base}/nuevo`}>+ Agregar registro</Link>}
      </div>
      {sp.ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)", marginTop: 12 }}>{sp.ok}</div>}
      {sp.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)", marginTop: 12 }}>{sp.error}</div>}
      {!study ? <div className="empty">Para capturar datos primero cree o seleccione un estudio en <Link href="/estudio">Estudio</Link>.</div>
        : rows.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0 }}>Aún no hay registros en esta sección.</p>
            <p className="note">{EMPTY[hoja]}</p>
            {canWrite && <p><Link className="btn solid" href={`${base}/nuevo`}>Agregar el primer registro</Link></p>}
          </div>
        ) : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
            <table>
              <thead><tr>{listCols.map((c) => <th key={c.col}>{c.header}</th>)}{def.computed.map((c) => <th key={c.col} className="calc" title="Calculado por la hoja (no editable)">{c.header} 🔒</th>)}<th>Acciones</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  {listCols.map((c) => <td key={c.col}>{inputValue(def, c.field, r.cells[c.col])}</td>)}
                  {def.computed.map((c) => { const v = r.computed[c.col]; return <td key={c.col} className="calc">{v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("es-CO", { maximumFractionDigits: 4 }) : String(v)}</td>; })}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link className="btn" href={`${base}/${r.id}`}>{canWrite ? "Editar" : "Ver"}</Link>{" "}
                    {canWrite && <form action={deleteEntryAction} style={{ display: "inline" }}><input type="hidden" name="hoja" value={def.id} /><input type="hidden" name="recId" value={r.id} /><button className="btn danger" type="submit">Eliminar</button></form>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      <p className="note">🔒 Columna con fórmula en el libro: se muestra el valor calculado y no se puede editar. Lo que se guarda aquí se escribe también en la hoja de Google.</p>
    </section>
  );
}

export async function EntryNew({ hoja }: { hoja: EntryId }) {
  const def = entryDef(hoja)!;
  const { user, study } = await session();
  if (!study) redirect("/estudio");
  const lookups = await entryOptions(getDb(), user.id, study!.id);
  return (
    <main>
      <div className="head"><div><h1>Nuevo registro · {def.short}</h1><div className="sub">Los campos con * son obligatorios. Lo que deje vacío se guarda vacío.</div></div><div className="tools"><Link className="btn" href={basePath(hoja)}>← Volver a {def.short}</Link></div></div>
      <EntryForm hoja={def.id} base={basePath(hoja)} {...formProps(def)} lookups={lookups} canWrite={study!.role !== "viewer"} />
    </main>
  );
}

export async function EntryEdit({ hoja, id }: { hoja: EntryId; id: string }) {
  const def = entryDef(hoja)!;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { user, study } = await session();
  if (!study) redirect("/estudio");
  const found = await getEntry(getDb(), user.id, study!.id, hoja, id);
  if (!found) notFound();
  const lookups = await entryOptions(getDb(), user.id, study!.id);
  return (
    <main>
      <div className="head"><div><h1>Editar registro · {def.short}</h1><div className="sub">Al guardar, la hoja de Google se actualiza con estos valores.</div></div><div className="tools"><Link className="btn" href={basePath(hoja)}>← Volver a {def.short}</Link></div></div>
      <EntryForm key={found!.row.version} hoja={def.id} base={basePath(hoja)} coverage={hoja === "2" && found!.row.positionId ? { cargoId: found!.row.positionId, afterCol: "J" } : undefined} recId={id} version={found!.row.version} {...formProps(def, found!.row)} lookups={lookups} canWrite={study!.role !== "viewer"} />
    </main>
  );
}