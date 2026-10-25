import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { diffSnapshots, productivity, type SnapMetrics } from "@/domain/history";
import { optionsOf } from "@/server/capture";
import { getSnapshots, listDeviations, listMeasurements, listSnapshots, productivityInputs, timelineEvents } from "@/server/history";
import { addMeasurementAction, deleteMeasurementAction, detectAction, deviationStatusAction, explainAction, snapshotAction } from "./actions";

const VISTAS = [["linea", "Línea de tiempo"], ["productividad", "Productividad real"], ["desviaciones", "Desviaciones"]] as const;
const LANES: [string, string][] = [["app", "Aplicación"], ["sheet", "Hoja de Google"], ["import", "Importación"], ["autocorrect", "Autocorrector"], ["agent", "Agente de IA"]];
const RULES: Record<string, string> = { R1: "Estimado vs medido", R2: "Cruce de umbral", R3: "Salto sin respaldo", R4: "Pérdida de calidad", R5: "Dispersión entre sedes", R6: "Plan vencido reincidente", R7: "Más actividades incompletas", R8: "Conflictos recurrentes" };
const ST: Record<string, string> = { open: "Abierta", acknowledged: "Reconocida", dismissed: "Descartada" };
const nf = (n: number | null, d = 2) => (n === null ? "—" : n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: d }));
const when = (d: Date) => d.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
const DAY = 86400000;

export const metadata = { title: "Historia y desviaciones" };
export default async function Historia({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const vista = VISTAS.some(([v]) => v === sp.vista) ? sp.vista! : "linea";
  const study = await activeStudyId(user!.id);
  const tabs = <div className="tabs" role="tablist" aria-label="Vistas">{VISTAS.map(([v, l]) => <Link key={v} href={`/historia?vista=${v}`} role="tab" aria-selected={v === vista} className={v === vista ? "on" : ""}>{l}</Link>)}</div>;
  const head = <div className="head"><div><h1>Historia y desviaciones</h1><div className="sub">{study ? study.name : "Sin estudio"} · propuesta fuera del Excel original; los umbrales son provisionales hasta que el responsable los decida</div></div></div>;
  if (!study) return <main>{head}{tabs}<div className="empty">Cree o seleccione un estudio en la sección Estudio.</div></main>;
  const canWrite = study.role !== "viewer";
  const db = getDb();
  const banners = <>
    {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
    {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}
  </>;

  /* ───────── Línea de tiempo ───────── */
  if (vista === "linea") {
    const [snaps, tl] = await Promise.all([listSnapshots(db, user!.id, study.id), timelineEvents(db, user!.id, study.id, 90)]);
    const end = Date.now(), start = end - 90 * DAY, x = (t: number) => Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100));
    const byLane = new Map<string, Map<string, { t: number; n: number }>>();
    for (const e of tl.audit) { const day = e.at.toISOString().slice(0, 10); const m = byLane.get(e.origin) ?? new Map(); const c = m.get(day) ?? { t: Date.parse(`${day}T12:00:00Z`), n: 0 }; c.n++; m.set(day, c); byLane.set(e.origin, m); }
    const chosen = [sp.a, sp.b].filter((v): v is string => !!v);
    const pair = chosen.length === 2 ? await getSnapshots(db, user!.id, study.id, chosen) : [];
    const A = pair.find((s) => s.id === sp.a), B = pair.find((s) => s.id === sp.b);
    const diff = A && B ? diffSnapshots(A.metrics as SnapMetrics, B.metrics as SnapMetrics) : null;
    return (
      <main>{head}{tabs}{banners}
        <section className="card">
          <h2>Línea de tiempo (últimos 90 días)</h2>
          <div style={{ marginTop: 12 }}>
            {LANES.map(([k, label]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="muted">{label}</span>
                <div style={{ position: "relative", height: 24, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6 }} aria-label={`Eventos de ${label}`}>
                  {[...(byLane.get(k)?.values() ?? [])].map((c) => <span key={c.t} title={`${new Date(c.t).toISOString().slice(0, 10)}: ${c.n} cambio(s)`} style={{ position: "absolute", left: `${x(c.t)}%`, top: 4, width: Math.min(16, 6 + c.n), height: 16, borderRadius: 4, background: "var(--blue)", opacity: 0.85 }} />)}
                </div>
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="muted">Fotos</span>
              <div style={{ position: "relative", height: 24, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6 }}>
                {tl.snaps.map((s) => <span key={s.label + s.at.toISOString()} title={`${s.label} · ${when(s.at)}`} style={{ position: "absolute", left: `${x(s.at.getTime())}%`, top: 3, width: 4, height: 18, background: "var(--red)" }} />)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: 8 }}>
              <span className="muted">Plan (fin)</span>
              <div style={{ position: "relative", height: 24, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6 }}>
                {tl.plans.filter((p) => p.end).map((p) => <span key={p.code} title={`${p.code} · ${p.end} · ${p.status ?? "sin estado"}`} style={{ position: "absolute", left: `${x(Date.parse(`${p.end}T12:00:00Z`))}%`, top: 6, width: 10, height: 10, transform: "rotate(45deg)", background: p.status === "completed" ? "var(--blue)" : "var(--amber)" }} />)}
              </div>
            </div>
            <div className="muted" style={{ display: "flex", justifyContent: "space-between", marginLeft: 138, marginTop: 4 }}><span>{new Date(start).toISOString().slice(0, 10)}</span><span>{new Date(end).toISOString().slice(0, 10)}</span></div>
          </div>
          <p className="note">Cada marca azul agrupa los cambios de un día (más ancha = más cambios). Las fotos aparecen en rojo; las fechas de fin del plan, como rombos.</p>
        </section>

        <section className="card">
          <h2>Fotos del tablero ({snaps.length})</h2>
          <form action={snapshotAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
            <label className="f" style={{ flex: "1 1 260px" }}>Nombre de la foto (opcional)<input name="label" maxLength={120} placeholder="p. ej. Tras importar el Excel" /></label>
            <button className="btn solid" type="submit" disabled={!canWrite}>Tomar foto ahora</button>
          </form>
          <p className="note">Se toma una foto automática cada lunes. La foto guarda los indicadores calculados en ese momento; el recálculo desde los datos siempre es posible.</p>
          {snaps.length >= 2 && (
            <form method="get" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
              <input type="hidden" name="vista" value="linea" />
              <label className="f">Foto anterior<select name="a" defaultValue={sp.a ?? snaps[1].id}>{snaps.map((s) => <option key={s.id} value={s.id}>{s.label} · {when(s.takenAt)}</option>)}</select></label>
              <label className="f">Foto posterior<select name="b" defaultValue={sp.b ?? snaps[0].id}>{snaps.map((s) => <option key={s.id} value={s.id}>{s.label} · {when(s.takenAt)}</option>)}</select></label>
              <button className="btn" type="submit">Comparar</button>
            </form>
          )}
        </section>

        {diff && (
          <section className="card">
            <h2>Qué cambió entre las dos fotos</h2>
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
              <thead><tr><th>Indicador</th><th className="num">Antes</th><th className="num">Después</th><th className="num">Cambio</th></tr></thead>
              <tbody>{diff.indicators.filter((r) => r.from !== r.to).map((r) => <tr key={r.key}><td>{r.key}</td><td className="num">{typeof r.from === "number" ? nf(r.from) : String(r.from ?? "—")}</td><td className="num">{typeof r.to === "number" ? nf(r.to) : String(r.to ?? "—")}</td><td className="num">{r.delta === null ? "—" : nf(r.delta)}</td></tr>)}
                {diff.indicators.every((r) => r.from === r.to) && <tr><td colSpan={4} className="muted">Los indicadores no cambiaron.</td></tr>}</tbody>
            </table></div>
            <p className="note">Actividades incompletas: {diff.incomplete.from} → {diff.incomplete.to}.</p>
            {diff.areas.length > 0 && <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table><thead><tr><th>Área</th><th className="num">Horas antes</th><th className="num">Horas después</th><th className="num">% antes</th><th className="num">% después</th></tr></thead>
              <tbody>{diff.areas.map((r) => <tr key={r.area}><td>{r.area}</td><td className="num">{nf(r.hoursFrom)}</td><td className="num">{nf(r.hoursTo)}</td><td className="num">{r.pctFrom === null ? "—" : `${nf(r.pctFrom * 100, 1)} %`}</td><td className="num">{r.pctTo === null ? "—" : `${nf(r.pctTo * 100, 1)} %`}</td></tr>)}</tbody></table></div>}
            {diff.crossings.length > 0 && <p className="note">Cargos que cambiaron de nivel: {diff.crossings.map((c) => `${c.position} (${c.area}): ${c.from ?? "nuevo"} → ${c.to}`).join("; ")}.</p>}
          </section>
        )}
      </main>
    );
  }

  /* ───────── Productividad real ───────── */
  if (vista === "productividad") {
    const [inp, ms] = await Promise.all([productivityInputs(db, user!.id, study.id), listMeasurements(db, user!.id, study.id)]);
    const code = new Map(inp.rows.map((r) => [r.id, r.code]));
    return (
      <main>{head}{tabs}{banners}
        <section className="card">
          <h2>Productividad real por actividad</h2>
          <div className="banner" style={{ marginTop: 12 }}>El Excel solo trae tiempos estimados. Mientras una actividad no tenga mediciones se muestra «Sin mediciones», nunca un número. El índice (real ÷ estándar) se calcula con al menos {inp.minN} mediciones con unidades.</div>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
            <thead><tr><th>Actividad</th><th>Mediciones</th><th className="num">Estándar por hora</th><th className="num">Real por hora</th><th className="num">Índice</th><th>Lectura</th></tr></thead>
            <tbody>{inp.rows.map((r) => {
              const p = productivity({ calcMode: r.calcMode, timeAvgMin: r.timeAvgMin }, r.measures, inp.minN);
              return <tr key={r.id}><td><b>{r.code}</b> <span className="muted">{r.name.slice(0, 50)}</span></td><td>{p.n}/{r.measures.length}</td><td className="num">{nf(p.standardPerHour)}</td><td className="num">{nf(p.realPerHour)}</td><td className="num">{p.index === null ? "—" : nf(p.index)}</td><td className="muted">{p.message}</td></tr>;
            })}</tbody>
          </table></div>
        </section>
        <section className="card">
          <h2>Registrar una medición</h2>
          <form action={addMeasurementAction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginTop: 12 }}>
            <label className="f">Actividad<select name="activityId" required>{inp.rows.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label>
            <label className="f">Fecha de observación<input type="date" name="observedAt" required /></label>
            <label className="f">Unidades (o eventos) procesadas<input name="unitsProcessed" inputMode="decimal" /></label>
            <label className="f">Horas-persona medidas<input name="personHours" inputMode="decimal" required /></label>
            <label className="f">Método<select name="method" defaultValue="timed">{optionsOf("L_Fuente").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></label>
            <label className="f">Observador (opcional)<input name="observer" maxLength={120} /></label>
            <div style={{ display: "flex", alignItems: "flex-end" }}><button className="btn solid" type="submit" disabled={!canWrite}>Guardar medición</button></div>
          </form>
        </section>
        <section className="card">
          <h2>Mediciones registradas ({ms.length})</h2>
          {ms.length === 0 ? <div className="empty">Sin mediciones.</div> : <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
            <thead><tr><th>Fecha</th><th>Actividad</th><th className="num">Unidades</th><th className="num">Horas-persona</th><th>Método</th><th>Observador</th><th /></tr></thead>
            <tbody>{ms.map((m) => <tr key={m.id}><td>{when(m.observedAt)}</td><td>{code.get(m.activityId)}</td><td className="num">{nf(m.unitsProcessed === null ? null : Number(m.unitsProcessed))}</td><td className="num">{nf(Number(m.personHours))}</td><td>{optionsOf("L_Fuente").find((o) => o.code === m.method)?.label}</td><td>{m.observer ?? ""}</td>
              <td><form action={deleteMeasurementAction}><input type="hidden" name="id" value={m.id} /><button className="btn danger" type="submit" disabled={!canWrite}>Eliminar</button></form></td></tr>)}</tbody>
          </table></div>}
        </section>
      </main>
    );
  }

  /* ───────── Desviaciones ───────── */
  const devs = await listDeviations(db, user!.id, study.id);
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  return (
    <main>{head}{tabs}{banners}
      <section className="card">
        <h2>Desviaciones ({devs.filter((d) => d.status === "open").length} abiertas)</h2>
        <form action={detectAction} style={{ marginTop: 12 }}><button className="btn solid" type="submit" disabled={!canWrite}>Detectar desviaciones ahora</button></form>
        <p className="note">Ocho reglas explícitas (R1 a R8) comparan fotos, mediciones y el plan. Los umbrales (diferencia estimado vs medido, mínimo de mediciones, salto de horas y mínimo de historia) se editan en <Link href="/parametros">Parámetros</Link> y son provisionales. Una desviación descartada no vuelve a aparecer durante 30 días; una abierta o reconocida no se duplica.</p>
        {devs.length === 0 ? <div className="empty">Sin desviaciones.</div> : <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
          <thead><tr><th>Regla</th><th>Qué se detectó</th><th>Base → observado</th><th>Estado</th><th>Explicación del agente</th><th>Acciones</th></tr></thead>
          <tbody>{devs.map((d) => {
            const b = d.baseline as Record<string, unknown>, msg = String(b._message ?? ""), clean = Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith("_")));
            return (
              <tr key={d.id}>
                <td><b>{d.ruleCode}</b><div className="muted">{RULES[d.ruleCode]}</div></td><td>{msg}</td>
                <td className="muted">{JSON.stringify(clean)} → {JSON.stringify(d.observed)}</td>
                <td><span className={`pill ${d.status === "open" ? "low" : d.status === "acknowledged" ? "ok" : "nodata"}`}>{ST[d.status] ?? d.status}</span></td>
                <td style={{ maxWidth: 320 }}>{d.explanation ?? <span className="muted">Sin explicación</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <form action={deviationStatusAction} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <input type="hidden" name="id" value={d.id} />
                    {d.status !== "acknowledged" && <button className="btn" name="status" value="acknowledged" type="submit" disabled={!canWrite}>Reconocer</button>}
                    {d.status !== "dismissed" && <button className="btn danger" name="status" value="dismissed" type="submit" disabled={!canWrite}>Descartar</button>}
                    {d.status !== "open" && <button className="btn" name="status" value="open" type="submit" disabled={!canWrite}>Reabrir</button>}
                  </form>{" "}
                  <form action={explainAction} style={{ display: "inline" }}><input type="hidden" name="id" value={d.id} /><button className="btn" type="submit" disabled={!canWrite || !configured}>Explicar con IA</button></form>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>}
      </section>
    </main>
  );
}
