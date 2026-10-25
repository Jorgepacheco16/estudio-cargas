import Link from "next/link";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId, loadAnalysis, parseMode } from "@/data/source";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";
import { CALC_4A, calcValue, compare4a, type Compare4a } from "@/domain/calc4a";
import { googleGateway } from "@/server/sheets/gateway";
import { read4a } from "@/server/sheets/read4a";
import { listConnections } from "@/server/sheets/sync";

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
  const bad = new Map((cmp?.diffs ?? []).map((d) => [d.code.toLowerCase(), d.fields]));
  const qs = `modo=${mode}`;

  return (
    <main>
      <div className="head">
        <div><h1>Cálculo de tiempos</h1><div className="sub">{loaded.label} · horas por semana de cada actividad según los datos de Actividades</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="calculo" mode={mode} /></div>
      </div>

      {hasSheet && (
        <section className="card" aria-label="Comparación con la hoja de Google">
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
        </section>
      )}

      <section className="card" aria-label="Cálculo por actividad">
        {a.activities.length === 0 ? <div className="empty">Aún no hay actividades en este modo.</div> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
            <table style={{ minWidth: 1900 }}>
              <thead><tr><th>Código</th><th>Cargo · sede</th><th>Estado de captura</th>{cmp && <th>Hoja de Google</th>}{CALC_4A.map((c) => <th key={c.col} className="num" title={`Columna ${c.col} del libro de Google`}>{c.header}</th>)}</tr></thead>
              <tbody>{a.activities.map((x) => {
                const diff = bad.get(x.code.toLowerCase());
                return (
                  <tr key={x.code + x.dataKind}>
                    <td><b>{x.code}</b>{x.dataKind === "demo" ? " · DEMO" : ""}</td><td>{x.position} · {x.site}</td>
                    <td><span className={`pill ${x.complete ? "ok" : "low"}`}>{x.complete ? "OK" : "Incompleta"}</span>{x.complete ? "" : <span className="muted">{x.status}</span>}</td>
                    {cmp && <td>{diff ? <span className="pill overload" title={diff.join(", ")}>Difiere</span> : cmp.missingInSheet.includes(x.code) ? <span className="pill nodata">No está</span> : <span className="pill ok">Igual</span>}</td>}
                    {CALC_4A.map((c) => { const v = calcValue(x, c.key, occ(x)); return <td key={c.col} className="num">{v === null ? "—" : c.key === "occupants" ? String(v) : fmt(v, c.key === "hoursPerExec" ? 4 : 2)}</td>; })}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <p className="note">Una actividad incompleta muestra «—» y no suma carga hasta completar sus datos. Las columnas llevan los mismos encabezados que el libro de Google.</p>
      </section>
    </main>
  );
}
