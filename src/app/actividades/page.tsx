import { loadAnalysis, parseMode, SOURCE_LABEL } from "@/data/source";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";

export default async function Actividades({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = parseMode((await searchParams).modo);
  const { analysis: a } = loadAnalysis(mode);
  return (
    <main>
      <div className="head">
        <div><h1>Inventario de actividades</h1><div className="sub">{SOURCE_LABEL} · {a.activities.length} actividades</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="actividades" mode={mode} /></div>
      </div>
      <section className="card">
        {a.activities.length === 0 ? <div className="empty">No hay actividades en este modo de análisis.</div> : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Código</th><th>Área · sede · cargo</th><th>Estado de captura</th><th className="num">Horas/sem</th><th className="num">Horas/mes</th></tr></thead>
              <tbody>
                {a.activities.map((x) => (
                  <tr key={`${x.dataKind}|${x.code}`}>
                    <td><b>{x.code}</b></td>
                    <td>{x.position}<div className="muted">{x.area} · {x.site}</div></td>
                    <td><span className={`pill ${x.complete ? "ok" : "low"}`}>{x.complete ? "OK" : "Incompleta"}</span>{x.complete ? "" : <span className="muted">{x.status}</span>}</td>
                    <td className="num">{fmt(x.hoursWeek, 2)}</td>
                    <td className="num">{fmt(x.hoursMonth, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Una actividad con datos faltantes se conserva y no suma carga hasta completarse; la aplicación nunca rellena un vacío por su cuenta.</p>
      </section>
    </main>
  );
}
