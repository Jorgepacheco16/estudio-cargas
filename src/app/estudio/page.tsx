import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listAreas, listActivityVersions, listPositions, listStudies, loadStudyData } from "@/server/studies";
import { analyze } from "@/domain/summary";
import { addActivityAction, addPositionAction, createStudyAction, selectStudyAction, updateTimeAction } from "./actions";

const ROLE: Record<string, string> = { owner: "Propietario", editor: "Editor", analyst: "Analista", viewer: "Solo lectura" };

export default async function Estudio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const studies = await listStudies(db, user!.id);
  const active = await activeStudyId(user!.id);
  const canWrite = active ? active.role !== "viewer" : false;

  let areas: { id: string; name: string }[] = [], positions: Awaited<ReturnType<typeof listPositions>> = [];
  let rows: { code: string; name: string; status: string; hours: number | null; id: string; version: number; time: number | null }[] = [];
  if (active) {
    const [areaList, positionList, d, versionList] = await Promise.all([listAreas(db, user!.id, active.id), listPositions(db, user!.id, active.id), loadStudyData(db, user!.id, active.id), listActivityVersions(db, user!.id, active.id)]);
    areas = areaList; positions = positionList;
    const a = analyze(d.staff, d.acts, d.params, d.thresholds, "all");
    const versions = new Map(versionList.map((v) => [v.code, v]));
    rows = a.activities.map((x) => {
      const v = versions.get(x.code)!;
      return { code: x.code, name: `${x.position} · ${x.site}`, status: x.status, hours: x.hoursWeek, id: v.id, version: v.version, time: d.acts.find((y) => y.code === x.code)?.timeAvgMin ?? null };
    });
  }

  return (
    <main>
      <div className="head">
        <div><h1>Estudio</h1><div className="sub">Sesión: {user!.email ?? "usuario"}{active ? ` · ${active.name} (${ROLE[active.role] ?? active.role})` : ""}</div></div>
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
      </section>

      {active && (
        <>
          <section className="card">
            <h2>Cargo y dotación</h2>
            {!canWrite && <div className="banner" style={{ marginTop: 12 }}>Su rol es de solo lectura: no puede modificar este estudio.</div>}
            <form action={addPositionAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 12 }}>
              <label className="f">Área<select name="area" required>{areas.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}</select></label>
              <label className="f">Sede<input name="site" required maxLength={120} /></label>
              <label className="f">Cargo<input name="position" required maxLength={160} /></label>
              <label className="f">Tipo de dato<select name="dataKind" defaultValue="real"><option value="real">REAL</option><option value="demo">DEMO</option></select></label>
              <label className="f">Cantidad de colaboradores<input name="headcount" inputMode="decimal" /></label>
              <label className="f">Jornada semanal (h)<input name="weeklyHours" inputMode="decimal" /></label>
              <div style={{ display: "flex", alignItems: "flex-end" }}><button className="btn solid" type="submit" disabled={!canWrite}>Guardar cargo</button></div>
            </form>
            <p className="note">{positions.length} cargo(s) registrados. Repetir área, sede, cargo y tipo agrega otra fila de dotación al mismo cargo, como en el Excel.</p>
          </section>

          <section className="card">
            <h2>Nueva actividad</h2>
            <form action={addActivityAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 12 }}>
              <label className="f">Código<input name="code" required maxLength={40} /></label>
              <label className="f">Nombre de la actividad<input name="name" required maxLength={300} /></label>
              <label className="f">Cargo responsable
                <select name="positionId" required>{positions.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.site} ({p.area})</option>)}</select></label>
              <label className="f">Tipo de dato<select name="dataKind" defaultValue="real"><option value="real">REAL</option><option value="demo">DEMO</option></select></label>
              <label className="f">Modalidad de cálculo<select name="calcMode" defaultValue=""><option value="">(sin definir)</option><option value="per_event">Por evento</option><option value="per_unit">Por unidad</option></select></label>
              <label className="f">Alcance<select name="scope" defaultValue=""><option value="">(sin definir)</option><option value="per_employee">Por colaborador</option><option value="position_total">Total del cargo</option></select></label>
              <label className="f">Ejecuciones por período<input name="executions" inputMode="decimal" /></label>
              <label className="f">Período<select name="period" defaultValue=""><option value="">(sin definir)</option><option value="day">Día</option><option value="week">Semana</option><option value="fortnight">Quincena</option><option value="month">Mes</option><option value="quarter">Trimestre</option><option value="year">Año</option></select></label>
              <label className="f">Unidades por ejecución<input name="unitsPerExecution" inputMode="decimal" /></label>
              <label className="f">Tiempo promedio (min)<input name="timeAvgMin" inputMode="decimal" /></label>
              <label className="f">Planificada<select name="planning" defaultValue=""><option value="">(sin definir)</option><option value="planned">Planificada</option><option value="unplanned">No planificada</option></select></label>
              <div style={{ display: "flex", alignItems: "flex-end" }}><button className="btn solid" type="submit" disabled={!canWrite || positions.length === 0}>Guardar actividad</button></div>
            </form>
            <p className="note">Los campos vacíos se guardan vacíos: la aplicación no inventa valores. Una actividad incompleta muestra qué le falta y no suma carga.</p>
          </section>

          <section className="card">
            <h2>Actividades del estudio ({rows.length})</h2>
            {rows.length === 0 ? <div className="empty">Aún no hay actividades.</div> : (
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
                <table>
                  <thead><tr><th>Código</th><th>Cargo · sede</th><th>Estado de captura</th><th className="num">Horas/sem</th><th>Tiempo promedio (min)</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><b>{r.code}</b></td><td>{r.name}</td>
                        <td><span className={`pill ${r.status === "OK" ? "ok" : "low"}`}>{r.status === "OK" ? "OK" : "Incompleta"}</span>{r.status === "OK" ? "" : <span className="muted">{r.status}</span>}</td>
                        <td className="num">{r.hours === null ? "—" : r.hours.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>
                          <form action={updateTimeAction} style={{ display: "flex", gap: 6 }}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="version" value={r.version} />
                            <input name="timeAvgMin" defaultValue={r.time ?? ""} inputMode="decimal" style={{ width: 90 }} aria-label={`Tiempo promedio de ${r.code}`} />
                            <button className="btn" type="submit" disabled={!canWrite}>Guardar</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
