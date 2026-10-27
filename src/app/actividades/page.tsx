import { PagedTable } from "@/components/PagedTable";
import { Purpose } from "@/components/Purpose";
import { loadAnalysis, parseMode } from "@/data/source";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";
import { FilterBar } from "@/components/FilterBar";
import { EntrySection } from "@/components/entry/views";
import { filterQuery } from "@/domain/filters";
import { activityFilters, type RawParams } from "@/lib/page-filters";

export const metadata = { title: "Actividades" };
export default async function Actividades({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams;
  const modo = Array.isArray(raw.modo) ? raw.modo[0] : raw.modo;
  const { analysis: a, mode, label } = await loadAnalysis(parseMode(modo));
  const af = activityFilters(a.activities, raw, "captura");
  return (
    <main>
      <div className="head">
        <div><h1>Actividades</h1><Purpose k="actividades" /><div className="sub">{label} · {af.rows.length}{af.rows.length !== a.activities.length ? ` de ${a.activities.length}` : ""} actividades</div></div>
        <div className="tools"><ModeForm mode={mode} keep={af.current} /><ExportButtons view="actividades" mode={mode} extra={filterQuery(af.current)} /></div>
      </div>
      {a.activities.length > 0 && <FilterBar key={filterQuery(af.current)} fields={af.fields} triples={af.triples} current={af.current} search shown={af.rows.length} total={a.activities.length} hidden={{ modo: mode }} clearHref={`/actividades?modo=${mode}`} />}
      {/* Primero los registros capturados (lo que se edita); debajo, el cuadro de resultados calculados (solo lectura). */}
      <EntrySection hoja="3" sp={raw} bar={false} />
      <section className="card">
        {a.activities.length === 0 ? <div className="empty">No hay actividades en este modo de análisis.</div> : af.rows.length === 0 ? <div className="empty">Ninguna actividad cumple los filtros elegidos. Cambie o limpie los filtros.</div> : (
          <PagedTable
            head={<tr><th>Código</th><th>Área · centro de operaciones · cargo</th><th>Estado de captura</th><th className="num">Horas/sem</th><th className="num">Horas/mes</th></tr>}
            rows={af.rows.map((x) => (
                  <tr key={`${x.dataKind}|${x.code}`}>
                    <td><b>{x.code}</b></td>
                    <td>{x.position}<div className="muted">{x.area} · {x.site}</div></td>
                    <td><span className={`pill ${x.complete ? "ok" : "low"}`}>{x.complete ? "OK" : "Incompleta"}</span>{x.complete ? "" : <span className="muted">{x.status}</span>}</td>
                    <td className="num">{fmt(x.hoursWeek, 2)}</td>
                    <td className="num">{fmt(x.hoursMonth, 2)}</td>
                  </tr>
                ))}
          />
        )}
        <p className="note">Una actividad con datos faltantes se conserva y no suma carga hasta completarse; la aplicación nunca rellena un vacío por su cuenta.</p>
      </section>
    </main>
  );
}
