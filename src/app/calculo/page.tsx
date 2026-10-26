import { Purpose } from "@/components/Purpose";
import Link from "next/link";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId, loadAnalysis, parseMode } from "@/data/source";
import { ExportButtons, ModeForm, fmt, fmtPct } from "@/components/Tools";
import { CALC_4A, calcValue, compare4a, type Compare4a } from "@/domain/calc4a";
import { googleGateway } from "@/server/sheets/gateway";
import { read4a } from "@/server/sheets/read4a";
import { listConnections } from "@/server/sheets/sync";
import { listActivityNames } from "@/server/studies";

export const metadata = { title: "Cálculo de tiempos" };
export default async function Calculo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const loaded = await loadAnalysis(parseMode(sp.modo));
  const { analysis: a, mode } = loaded;
  const occ = (x: (typeof a.activities)[number]) => a.positions.find((p) => p.dataKind === x.dataKind && p.area === x.area && p.site === x.site && p.position === x.position)?.occupants ?? 0;

  /* Comparación opcional con lo que calculó la hoja «4a_Calculo_tiempos» de Google (solo lectura). */
  let cmp: Compare4a | null = null, cmpError = "", hasSheet = false;
  if (loaded.source === "estudio") {
    const u = await getUser(); const s = u ? await activeStudyId(u.id) : null;
    const conn = u && s ? (await listConnections(getDb(), u.id, s.id)).find((c) => c.mode !== "off") : undefined;
    hasSheet = !!conn;
    if (conn && sp.comparar === "1") {
      try { cmp = compare4a(a.activities, occ, await read4a(googleGateway(conn.spreadsheetId))); } catch { cmpError = "No se pudo leer la hoja de Google. Verifique que siga compartida con la cuenta de servicio."; }
    }
  }
  /* Nombre de cada actividad (solo en un estudio real; los datos de demostración traen únicamente el código). */
  let names = new Map<string, string>();
  if (loaded.source === "estudio") { const u = await getUser(); const s = u ? await activeStudyId(u.id) : null; if (u && s) names = await listActivityNames(getDb(), u.id, s.id); }
  const done = a.activities.filter((x) => x.complete), pending = a.activities.filter((x) => !x.complete);
  const totalWeek = done.reduce((s, x) => s + (x.hoursWeek ?? 0), 0), totalMonth = done.reduce((s, x) => s + (x.hoursMonth ?? 0), 0);
  const rows = sp.orden === "horas" ? [...a.activities].sort((x, y) => (y.hoursWeek ?? -1) - (x.hoursWeek ?? -1)) : a.activities;
  const bad = new Map((cmp?.diffs ?? []).map((d) => [d.code.toLowerCase(), d.fields]));
  const qs = `modo=${mode}`;

  return (
    <main>
      <div className="head">
        <div><h1>Cálculo de tiempos</h1><Purpose k="calculo" /><div className="sub">{loaded.label} · horas por semana de cada actividad según los datos de Actividades</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="calculo" mode={mode} /></div>
      </div>

      {hasSheet && (
        <details className="adv" open={sp.comparar === "1"}><summary>Detalle avanzado: comparar con la hoja de Google</summary><div className="adv-body"><section className="card" aria-label="Comparación con la hoja de Google">
          <h2>Comparación con el cálculo de tiempos de la hoja de Google</h2>
          <p className="note">La aplicación calcula con su propio motor. Aquí se lee, sin modificar nada, lo que calculó la hoja de Google y se compara actividad por actividad y columna por columna.</p>
          <Link className="btn" href={`/calculo?${qs}&comparar=1`} style={{ marginTop: 8 }}>Comparar ahora con la hoja de Google</Link>
          {cmpError && <div className="banner" style={{ marginTop: 12, background: "var(--red-soft)", color: "var(--red-dark)" }}>{cmpError}</div>}
          {cmp && (
            <div className="banner" style={{ marginTop: 12, ...(cmp.diffs.length || cmp.missingInSheet.length ? {} : { background: "var(--blue-soft)", color: "var(--blue)" }) }}>
              {cmp.diffs.length === 0 && cmp.missingInSheet.length === 0
                ? `Coincide: ${cmp.same} de ${cmp.compared} actividades tienen exactamente los mismos valores en las ${CALC_4A.length} columnas calculadas.`
                : `${cmp.same} de ${cmp.compared} coinciden · ${cmp.diffs.length} con diferencias (marcadas abajo) · ${cmp.missingInSheet.length} no están en la hoja de Google.`}
            </div>
          )}
        </section></div></details>
      )}

      <section className="grid-kpi" aria-label="Resumen del cálculo">
        <div className="card"><div className="lbl">Actividades registradas</div><div className="kpi">{a.activities.length}</div><div className="note">En el modo de análisis seleccionado</div></div>
        <div className="card"><div className="lbl">Con datos completos</div><div className="kpi">{done.length} <small>de {a.activities.length}</small></div><div className="note">Solo estas suman horas</div></div>
        <div className="card"><div className="lbl">Horas por semana</div><div className="kpi">{fmt(totalWeek, 2)}</div><div className="note">Suma de las actividades completas</div></div>
        <div className="card"><div className="lbl">Horas por mes</div><div className="kpi">{fmt(totalMonth, 2)}</div><div className="note">Equivalente mensual de las horas por semana</div></div>
      </section>

      {pending.length > 0 && (
        <div className="banner" role="status"><span>{pending.length === 1 ? "1 actividad está incompleta" : `${pending.length} actividades están incompletas`}: no suman horas hasta que se completen sus datos (se muestran con «—» y lo que les falta). Complételas en <Link href="/actividades"><u>Actividades</u></Link>.</span></div>
      )}

      <section className="card" aria-label="Horas por actividad">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <h2>Horas por actividad</h2>
          <div className="tabs" style={{ margin: 0 }} role="group" aria-label="Orden de la tabla">
            <Link href={`/calculo?${qs}`} className={sp.orden === "horas" ? "" : "on"}>Por código</Link>
            <Link href={`/calculo?${qs}&orden=horas`} className={sp.orden === "horas" ? "on" : ""}>Por horas (mayor a menor)</Link>
          </div>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Cada fila es una actividad. «Veces por semana» es cuántas veces se hace; «Horas por semana» es el tiempo total que consume en la sede, sumando a todas las personas que la ejecutan.</p>
        {a.activities.length === 0 ? <div className="empty">Aún no hay actividades en este modo. Regístrelas en <Link href="/actividades">Actividades</Link>.</div> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
            <table style={{ minWidth: 980 }}>
              <thead><tr><th>Código</th><th>Actividad</th><th>Cargo y sede</th><th>Estado</th>{cmp && <th>Hoja de Google</th>}<th className="num">Veces por semana</th><th className="num">Horas por semana</th><th className="num">Horas por mes</th><th style={{ minWidth: 150 }}>% del total de horas</th></tr></thead>
              <tbody>{rows.map((x) => {
                const diff = bad.get(x.code.toLowerCase());
                const share = x.complete && totalWeek > 0 ? (x.hoursWeek ?? 0) / totalWeek : null;
                return (
                  <tr key={x.code + x.dataKind}>
                    <td style={{ whiteSpace: "nowrap" }}><b>{x.code}</b>{x.dataKind === "demo" ? <div className="muted">DEMO</div> : null}</td>
                    <td style={{ minWidth: 220 }}>{names.get(x.code.toLowerCase()) ?? <span className="muted">—</span>}</td>
                    <td>{x.position}<div className="muted">{x.area} · {x.site}</div></td>
                    <td>{x.complete ? <span className="pill ok">Completa</span> : <><span className="pill low">Incompleta</span><div className="muted" style={{ marginTop: 4 }}>{x.status}</div></>}</td>
                    {cmp && <td>{diff ? <span className="pill overload" title={diff.join(", ")}>Difiere</span> : cmp.missingInSheet.includes(x.code) ? <span className="pill nodata">No está</span> : <span className="pill ok">Igual</span>}</td>}
                    <td className="num">{x.result.execPerWeek === undefined ? "—" : fmt(x.result.execPerWeek, 2)}</td>
                    <td className="num"><b>{x.complete ? fmt(x.hoursWeek, 2) : "—"}</b></td>
                    <td className="num">{x.complete ? fmt(x.hoursMonth, 2) : "—"}</td>
                    <td>{share === null ? "—" : <div style={{ display: "flex", gap: 8, alignItems: "center" }}><div className="bar" style={{ flex: 1 }}><span style={{ width: `${Math.min(100, share * 100)}%`, background: "var(--blue)" }} /></div><span style={{ minWidth: 48, textAlign: "right" }}>{fmtPct(share)}</span></div>}</td>
                  </tr>
                );
              })}</tbody>
              {done.length > 0 && <tfoot><tr><td colSpan={cmp ? 6 : 5} style={{ fontWeight: 700 }}>Total de las actividades completas</td><td className="num"><b>{fmt(totalWeek, 2)}</b></td><td className="num"><b>{fmt(totalMonth, 2)}</b></td><td /></tr></tfoot>}
            </table>
          </div>
        )}
        <p className="note">Una actividad incompleta no suma horas: la aplicación nunca rellena un dato que falta por su cuenta.</p>
      </section>

      <details className="adv">
        <summary>¿Cómo se calcula? (explicado paso a paso)</summary>
        <div className="adv-body">
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
            <li><b>Veces por semana</b> = cuántas veces se ejecuta la actividad en su período (día, semana, mes…) llevado a una semana de trabajo.</li>
            <li><b>Horas por ejecución</b> = tiempo promedio de cada vez (por evento o por unidad) + desplazamientos, esperas y reprocesos si los hay, multiplicado por las personas que participan a la vez.</li>
            <li><b>Horas por semana de una persona</b> = veces por semana × horas por ejecución, según el escenario elegido en Parámetros (base, temporada alta o baja, tiempo mínimo o máximo).</li>
            <li><b>Horas por semana totales en la sede</b> = lo anterior × el número de ocupantes del cargo, si la actividad la hace cada colaborador; si es del conjunto del cargo, no se multiplica.</li>
            <li><b>Reparto entre cargos:</b> si la actividad se comparte, el cargo responsable recibe su porcentaje y el cargo que asume el resto recibe lo demás.</li>
            <li><b>Horas por mes</b> = horas por semana × semanas por mes (52 ÷ 12).</li>
          </ol>
          <p className="note">Estos pasos son los mismos del libro de Google (hoja de cálculo de tiempos). Los resultados del libro y de la aplicación se pueden comparar en el bloque «Detalle avanzado».</p>
        </div>
      </details>

      <details className="adv">
        <summary>Detalle avanzado: todas las columnas del cálculo ({CALC_4A.length} columnas)</summary>
        <div className="adv-body">
          <p className="note" style={{ marginTop: 0 }}>Incluye los escenarios de temporada, tiempos mínimo y máximo, el reparto entre cargos y las horas no planificadas, de reproceso y de espera. Pase el cursor sobre un encabezado para ver su columna en el libro de Google.</p>
          {a.activities.length === 0 ? <div className="empty">Aún no hay actividades.</div> : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla detallada desplazable">
              <table style={{ minWidth: 1900 }}>
                <thead><tr><th>Código</th><th>Cargo y sede</th><th>Estado</th>{CALC_4A.map((c) => <th key={c.col} className="num" title={`Columna ${c.col} del libro de Google`}>{c.header}</th>)}</tr></thead>
                <tbody>{a.activities.map((x) => (
                  <tr key={x.code + x.dataKind}>
                    <td><b>{x.code}</b>{x.dataKind === "demo" ? " · DEMO" : ""}</td><td>{x.position} · {x.site}</td>
                    <td><span className={`pill ${x.complete ? "ok" : "low"}`}>{x.complete ? "OK" : "Incompleta"}</span>{x.complete ? "" : <span className="muted">{x.status}</span>}</td>
                    {CALC_4A.map((c) => { const v = calcValue(x, c.key, occ(x)); return <td key={c.col} className="num">{v === null ? "—" : c.key === "occupants" ? String(v) : fmt(v, c.key === "hoursPerExec" ? 4 : 2)}</td>; })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </main>
  );
}
