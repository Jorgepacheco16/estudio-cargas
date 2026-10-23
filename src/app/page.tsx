import { loadAnalysis, parseMode } from "@/data/source";
import { CargosTable } from "@/components/CargosTable";
import { ExportButtons, ModeForm, fmt, fmtPct } from "@/components/Tools";

export default async function Tablero({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { analysis: a, params, thresholds, mode, label } = await loadAnalysis(parseMode((await searchParams).modo));
  const k = a.kpis;
  const maxHours = Math.max(1, ...a.areas.map((x) => x.hours));
  return (
    <main>
      <div className="head">
        <div>
          <h1>Tablero ejecutivo</h1>
          <div className="sub">{label} · escenario {params.scenario} · reserva {fmtPct(params.reservePct)}</div>
        </div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="tablero" mode={mode} /></div>
      </div>

      <section className="grid-kpi" aria-label="Indicadores">
        <div className="card"><div className="lbl">Actividades completas</div><div className="kpi">{k.complete} <small>de {k.activities}</small></div><div className="note">{k.activities - k.complete} con datos incompletos</div></div>
        <div className="card"><div className="lbl">Horas por semana</div><div className="kpi">{fmt(k.hours)}</div><div className="note">Escenario seleccionado</div></div>
        <div className="card"><div className="lbl">Capacidad comprometida</div><div className="kpi">{fmtPct(k.pct)}</div><div className="note">Capacidad {fmt(k.capacity)} h/sem</div></div>
        <div className="card"><div className="lbl">Cargos con alerta</div><div className={`kpi ${k.alerts > 0 ? "bad" : ""}`}>{k.alerts}</div><div className="note">{k.overload} sobrecarga · {k.low} por validar</div></div>
      </section>

      <section className="card" aria-label="Carga por cargo">
        <h2>Carga frente a capacidad por cargo</h2>
        <div className="note">Umbrales del estudio: sobrecarga sobre {fmtPct(thresholds.high)} · carga baja bajo {fmtPct(thresholds.low)}</div>
        <CargosTable rows={a.positions} />
      </section>

      <div className="row">
        <section className="card" aria-label="Horas por área">
          <h2>Horas por semana por área</h2>
          {a.areas.length === 0 ? <div className="empty">Sin áreas en este modo.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14, fontSize: ".875rem" }}>
              {a.areas.map((r) => (
                <div key={r.area}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>{r.area}</span><b>{fmt(r.hours)}</b></div>
                  <div className="bar"><span style={{ width: `${(r.hours / maxHours) * 100}%`, background: "var(--blue)" }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card" aria-label="Estado del estudio">
          <h2>Estado del estudio</h2>
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: ".875rem" }}>
            <li>{k.overload > 0 ? `${k.overload} cargo(s) superan la capacidad: revise datos, solapamientos y horas extra antes de decidir.` : "Ningún cargo supera la capacidad."}</li>
            <li>{k.activities - k.complete > 0 ? `${k.activities - k.complete} actividad(es) con datos incompletos no suman carga todavía.` : "Todas las actividades tienen datos completos."}</li>
            <li>Los cálculos reproducen las hojas 4a y 4b del Excel de referencia (prueba dorada, 870 valores).</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
