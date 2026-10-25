import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId, loadAnalysis, parseMode } from "@/data/source";
import { ExportButtons, ModeForm, fmt, fmtPct } from "@/components/Tools";
import { comparablePositions, compareSites } from "@/domain/sites";
import { loadUndocumented } from "@/server/studies";

export const metadata = { title: "Comparador sedes" };
export default async function Sedes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const loaded = await loadAnalysis(parseMode(sp.modo));
  const { analysis, mode, params } = loaded;
  const options = comparablePositions(analysis, mode);
  const chosen = options.find((o) => o.area === sp.area && o.position === sp.position) ?? options[0];
  let undocumented: Map<string, number> | undefined;
  if (loaded.source === "estudio") { const u = await getUser(); const s = u ? await activeStudyId(u.id) : null; if (u && s) undocumented = await loadUndocumented(getDb(), u.id, s.id); }
  const c = chosen ? compareSites(analysis, chosen.area, chosen.position, mode, params.reservePct, undocumented) : null;

  return (
    <main>
      <div className="head">
        <div><h1>Comparador sedes</h1><div className="sub">{loaded.label} · el mismo cargo en cada sede</div></div>
        <div className="tools"><ModeForm mode={mode} />{chosen && <ExportButtons view="sedes" mode={mode} extra={`area=${encodeURIComponent(chosen.area)}&position=${encodeURIComponent(chosen.position)}`} />}</div>
      </div>
      {options.length === 0 ? <div className="empty">No hay cargos registrados para el modo seleccionado.</div> : (
        <>
          <section className="card">
            <h2>Elija un cargo</h2>
            <p className="note">Primero aparecen los cargos que están en más sedes. El cargo elegido va en negrita.</p>
            <ul style={{ columns: 2, margin: "8px 0 0", paddingLeft: 18, fontSize: ".875rem" }}>
              {options.slice(0, 60).map((o) => <li key={`${o.area}|${o.position}`}><a href={`/sedes?modo=${mode}&area=${encodeURIComponent(o.area)}&position=${encodeURIComponent(o.position)}`} aria-current={o === chosen ? "true" : undefined} style={o === chosen ? { fontWeight: 700, textDecoration: "underline" } : { textDecoration: "underline" }}>{o.area} · {o.position}</a> <span className="muted">{o.sites} sede(s)</span></li>)}
            </ul>
          </section>

          {c && (
            <section className="card">
              <h2>{chosen!.area} · {chosen!.position}</h2>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
                <thead><tr><th>Sede</th><th className="num">Ocupantes</th><th className="num">Jornada (h)</th><th className="num">Capacidad (h/sem)</th><th className="num">Horas/sem asignadas</th><th className="num">% de capacidad</th><th className="num">Horas/sem por ocupante</th><th className="num">Actividades</th><th className="num">No documentadas</th><th>Lectura de la sede</th></tr></thead>
                <tbody>{c.rows.map((r) => (
                  <tr key={r.site + r.kind}><td><b>{r.site}</b>{r.kind === "demo" ? " · DEMO" : ""}</td><td className="num">{r.occupants}</td><td className="num">{r.weeklyHours === null ? "—" : fmt(r.weeklyHours)}</td><td className="num">{fmt(r.capacity, 2)}</td><td className="num">{fmt(r.hours, 2)}</td>
                    <td className="num">{fmtPct(r.pct)}</td><td className="num">{r.perOccupant === null ? "—" : fmt(r.perOccupant, 2)}</td><td className="num">{r.activities}</td><td className="num">{r.undocumented === null ? "—" : r.undocumented}</td><td className="muted">{r.reading}</td></tr>
                ))}</tbody>
              </table></div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 12 }}>
                <div><div className="lbl">Promedio por ocupante</div><div className="kpi" style={{ fontSize: "1.25rem" }}>{c.average === null ? "—" : fmt(c.average, 2)}</div></div>
                <div><div className="lbl">Mínimo</div><div className="kpi" style={{ fontSize: "1.25rem" }}>{c.min === null ? "—" : fmt(c.min, 2)}</div></div>
                <div><div className="lbl">Máximo</div><div className="kpi" style={{ fontSize: "1.25rem" }}>{c.max === null ? "—" : fmt(c.max, 2)}</div></div>
                <div><div className="lbl">Dispersión (máx − mín) ÷ promedio</div><div className={`kpi ${(c.dispersion ?? 0) > 0.3 ? "bad" : ""}`} style={{ fontSize: "1.25rem" }}>{c.dispersion === null ? "—" : fmtPct(c.dispersion)}</div></div>
              </div>
              <div className="banner" style={{ marginTop: 12 }}>{c.reading}</div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
