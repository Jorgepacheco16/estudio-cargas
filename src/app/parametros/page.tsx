import { Purpose } from "@/components/Purpose";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { ParamsForm } from "@/components/ParamsForm";
import { SHEETS, listRows, optionsOf, toFormValue } from "@/server/capture";
import { listAreas } from "@/server/studies";
import { addAreaAction, removeAreaAction } from "@/app/entrada/actions";

export const metadata = { title: "Parámetros" };
export default async function Parametros({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  const def = SHEETS[0], db = getDb();
  const [rows, areas] = await Promise.all([listRows(db, user!.id, study!.id, def), listAreas(db, user!.id, study!.id)]);
  const row = rows[0];
  const canWrite = study!.role !== "viewer";
  const fields = def.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, options: f.kind === "list" ? optionsOf(f.list!) : [] }));
  const initial = Object.fromEntries(def.fields.map((f) => [f.key, row ? toFormValue(f, row[f.key]) : ""]));
  return (
    <main>
      <div className="head"><div><h1>Parámetros</h1><Purpose k="parametros" /><div className="sub">Supuestos, pesos, umbrales y lista de áreas · {study!.name}</div></div></div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      <section className="card">
        <h2>Supuestos del estudio</h2>
        {row && <ParamsForm fields={fields} initial={initial} version={row.version} canWrite={canWrite} />}
        <p className="note">🔒 Semanas por mes ({row ? Number(row.weeksPerMonth).toLocaleString("es-CO", { maximumFractionDigits: 4 }) : "—"}) es una fórmula del libro (52/12): se muestra, no se edita.</p>
      </section>
      <section className="card">
        <h2>Áreas ({areas.length})</h2>
        <p className="note">Esta lista alimenta la lista desplegable «Área» de las hojas del libro. Un área debe existir aquí antes de usarla.</p>
        <ul style={{ margin: "8px 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {areas.map((a) => (
            <li key={a.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span>{a.name}</span>
              {canWrite && <form action={removeAreaAction}><input type="hidden" name="name" value={a.name} /><button className="btn danger" type="submit" aria-label={`Quitar ${a.name}`}>Quitar</button></form>}
            </li>
          ))}
        </ul>
        {canWrite && <form action={addAreaAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}><label className="f">Nueva área<input name="name" required maxLength={120} /></label><button className="btn solid" type="submit">Agregar área</button></form>}
      </section>
    </main>
  );
}
