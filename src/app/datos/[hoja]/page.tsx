import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { entryDef, type EntryId } from "@/server/entry/defs";
import { inputValue, listEntries } from "@/server/entry/service";
import { deleteEntryAction } from "../actions";

export default async function Hoja({ params, searchParams }: { params: Promise<{ hoja: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hoja } = await params;
  if (hoja === "parametros") return notFound();
  const def = entryDef(hoja);
  if (!def) notFound();
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  const canWrite = study!.role !== "viewer";
  const data = await listEntries(getDb(), user!.id, study!.id, def!.id as EntryId);
  const rows = data?.rows ?? [];
  const listCols = def!.listFields.map((f) => def!.fields.find((x) => x.field === f)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <main>
      <div className="head">
        <div><h1>{def!.short}</h1><div className="sub">{def!.title}</div></div>
        <div className="tools">{canWrite && <Link className="btn solid" href={`/datos/${def!.id}/nuevo`}>Nuevo registro</Link>}<Link className="btn" href="/datos">Todas las hojas</Link></div>
      </div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      <section className="card">
        {def!.note && <p className="note">{def!.note}</p>}
        {rows.length === 0 ? <div className="empty">Aún no hay registros en esta hoja.</div> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
            <table>
              <thead><tr>{listCols.map((c) => <th key={c.col}>{c.header}</th>)}{def!.computed.map((c) => <th key={c.col} title="Calculado por la hoja (no editable)">{c.header} 🔒</th>)}<th>Acciones</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  {listCols.map((c) => <td key={c.col}>{inputValue(def!, c.field, r.cells[c.col])}</td>)}
                  {def!.computed.map((c) => { const v = r.computed[c.col]; return <td key={c.col} className="muted">{v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("es-CO", { maximumFractionDigits: 4 }) : String(v)}</td>; })}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link className="btn" href={`/datos/${def!.id}/${r.id}`}>{canWrite ? "Editar" : "Ver"}</Link>{" "}
                    {canWrite && <form action={deleteEntryAction} style={{ display: "inline" }}><input type="hidden" name="hoja" value={def!.id} /><input type="hidden" name="recId" value={r.id} /><button className="btn danger" type="submit">Eliminar</button></form>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="note">🔒 Columna con fórmula en el libro: se muestra el valor calculado y no se puede editar.</p>
      </section>
    </main>
  );
}
