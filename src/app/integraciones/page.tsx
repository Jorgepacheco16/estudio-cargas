import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listConnections, openIssues, recentEvents } from "@/server/sheets/sync";
import { connectAction, previewAction, syncAction } from "./actions";

const MODE: Record<string, string> = { off: "Apagada", push: "Solo app → hoja", pull: "Solo hoja → app", bidirectional: "Bidireccional" };
const when = (d: Date | null) => (d ? d.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }) : "—");

export default async function Integraciones({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const study = await activeStudyId(user!.id);
  const db = getDb();
  const [conns, events, issues] = study ? await Promise.all([listConnections(db, user!.id, study.id), recentEvents(db, user!.id, study.id), openIssues(db, user!.id, study.id)]) : [[], [], []];
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? (() => { try { return (JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string }).client_email ?? null; } catch { return null; } })() : null;
  const isOwner = study?.role === "owner";

  return (
    <main>
      <div className="head"><div><h1>Integraciones</h1><div className="sub">Google Sheets · la aplicación manda; la hoja es una vista de captura{study ? ` · ${study.name}` : ""}</div></div></div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
      {!study ? <div className="empty">Cree o seleccione un estudio en la sección Estudio.</div> : (
        <>
          <section className="card">
            <h2>Hoja conectada</h2>
            {conns.length === 0 ? <div className="empty">Aún no hay una hoja conectada.</div> : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Hoja</th><th>Modo</th><th>Última sincronización</th><th>Estado</th></tr></thead>
                <tbody>{conns.map((c) => <tr key={c.id}><td className="muted">{c.spreadsheetId.slice(0, 12)}…</td><td>{MODE[c.mode] ?? c.mode}</td><td>{when(c.lastSyncAt)}</td><td>{c.status}</td></tr>)}</tbody>
              </table></div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <form action={previewAction}><button className="btn" type="submit" disabled={conns.length === 0}>Vista previa (no cambia nada)</button></form>
              <form action={syncAction}><button className="btn solid" type="submit" disabled={conns.length === 0 || study.role === "viewer"}>Sincronizar ahora</button></form>
            </div>
            <p className="note">Sincronizar lee la hoja, aplica los cambios (con control de versión), vincula las filas idénticas y escribe en la hoja lo que solo existe en la app. Las filas distintas se reportan como conflicto y no se sobrescriben.</p>
          </section>

          <section className="card">
            <h2>Conectar una hoja</h2>
            <ol className="note" style={{ paddingLeft: 18 }}>
              <li>Use una hoja nativa de Google (si es un .xlsx, abra «Archivo → Guardar como hoja de cálculo de Google»).</li>
              <li>Compártala como <b>Editor</b> con la cuenta de servicio{email ? <>: <b>{email}</b></> : " (falta GOOGLE_SERVICE_ACCOUNT_JSON en el servidor)"}.</li>
              <li>Pegue aquí su dirección y elija el modo.</li>
            </ol>
            <form action={connectAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
              <label className="f" style={{ flex: "1 1 320px" }}>Dirección de la hoja<input name="sheet" required placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
              <label className="f">Modo<select name="mode" defaultValue="bidirectional"><option value="bidirectional">Bidireccional</option><option value="pull">Solo hoja → app</option><option value="push">Solo app → hoja</option><option value="off">Apagada</option></select></label>
              <button className="btn solid" type="submit" disabled={!isOwner}>Conectar</button>
            </form>
            {!isOwner && <p className="note">Solo el propietario del estudio puede conectar o cambiar la hoja.</p>}
          </section>

          <section className="card">
            <h2>Cambios en vivo (Apps Script)</h2>
            <p className="note">Para que las ediciones en la hoja lleguen a la aplicación en segundos: abra la hoja → Extensiones → Apps Script, pegue el código descargado, defina la propiedad <b>WEBHOOK_SECRET</b> (el mismo valor de SHEETS_WEBHOOK_SECRET del servidor) y cree los activadores <b>onEditInstalled</b> (al editar) y <b>onChangeInstalled</b> (al cambiar). Sin esto la aplicación igual se actualiza con «Sincronizar ahora» y con la reconciliación diaria.</p>
            <a className="btn" href="/api/sheets/script" download>Descargar Code.gs</a>
          </section>

          <section className="card">
            <h2>Eventos recientes ({events.length})</h2>
            {events.length === 0 ? <div className="empty">Sin eventos.</div> : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Cuándo</th><th>Sentido</th><th>Hoja</th><th>Estado</th><th>Detalle</th></tr></thead>
                <tbody>{events.map((e) => <tr key={e.id}><td>{when(e.createdAt)}</td><td>{e.direction === "sheet_to_app" ? "Hoja → app" : "App → hoja"}</td><td>{e.sheetName}</td><td><span className={`pill ${e.status === "error" ? "overload" : e.status === "processed" ? "ok" : "low"}`}>{e.status}</span></td><td className="muted">{e.error ?? ""}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>

          <section className="card">
            <h2>Calidad de datos · hallazgos abiertos ({issues.length})</h2>
            {issues.length === 0 ? <div className="empty">Sin hallazgos abiertos.</div> : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>Regla</th><th>Gravedad</th><th>Hoja · fila</th><th>Mensaje</th></tr></thead>
                <tbody>{issues.map((i) => { const v = (i.suggestedValue ?? {}) as { sheet?: string; row?: number; message?: string }; return <tr key={i.id}><td>{i.ruleCode}</td><td>{i.severity}</td><td>{v.sheet} · {v.row}</td><td>{v.message}</td></tr>; })}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
