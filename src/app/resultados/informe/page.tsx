import { Purpose } from "@/components/Purpose";
import { guardModules } from "@/lib/guard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PagedTable } from "@/components/PagedTable";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";
import { PeopleByAreaChart, UseByPositionChart, WeeksChartView } from "@/components/resultados/ReportCharts";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId, parseMode } from "@/data/source";
import { LEVEL_ES, SCENARIO_ES, buildReportFacts } from "@/domain/report";
import { STATE_ES } from "@/domain/staffing";
import type { RawParams } from "@/lib/page-filters";
import { loadSchedules } from "@/server/schedule";
import { ReportText } from "@/components/resultados/ReportText";
import { canEdit } from "@/lib/access";
import { REPORT_DAILY_LIMIT, listVersions, loadReportBasis, reportUsage } from "@/server/report-version";

export const maxDuration = 60; // redactar el texto con el agente puede tardar
export const metadata = { title: "Informe de resultados" };
const signed = (n: number) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));
const pct = (n: number | null, d = 0) => (n === null ? "—" : `${fmt(n * 100, d)} %`);

export default async function Informe({ searchParams }: { searchParams: Promise<RawParams> }) {
  const user = await getUser();
  if (!user) redirect("/login"); // «Resultados» no se muestra en la demostración (D-100)
  await guardModules(["resultados", "cargos", "actividades"]);
  const raw = await searchParams;
  const mode = parseMode(Array.isArray(raw.modo) ? raw.modo[0] : raw.modo) ?? "real";
  const study = await activeStudyId(user.id);
  const loaded = study ? await loadSchedules(getDb(), user.id, study.id, mode) : null;
  const facts = loaded ? buildReportFacts({ positions: loaded.positions, schedules: loaded.schedules, kpis: loaded.kpis, overload: loaded.overload, reservePct: loaded.params.reservePct, scenario: loaded.params.scenario, roundFrom: loaded.params.staffRoundFrom ?? 0 }) : null;
  const empty = !facts || facts.data.positions === 0;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // El texto del informe (D-106) es del estudio real; quien puede cambiarlo es quien tiene Edición en Resultados, y redactar con el agente exige además Edición en Agente de IA y todas las áreas.
  const canManage = !!study && canEdit(study, "resultados"), canGenerate = canManage && !!study && canEdit(study, "agente") && !!study.access?.allAreas;
  const allAreas = !!study?.access?.allAreas; // el texto resume todo el estudio: solo lo ve quien tiene acceso a todas las áreas
  const textOn = !!study && mode === "real" && !empty && allAreas;
  const [versions, basis, usage] = textOn && study ? await Promise.all([listVersions(getDb(), user.id, study.id), loadReportBasis(getDb(), user.id, study.id), reportUsage(getDb(), user.id, study.id)]) : [[], null, 0];
  const wanted = Number(one(raw.v));
  const selected = versions.find((v) => v.number === wanted) ?? versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "approved") ?? versions[0] ?? null;

  return (
    <main>
      <div className="head">
        <div>
          <h1>Informe de resultados</h1><Purpose k="informe" />
          <div className="sub">{study ? `Estudio: ${study.name}` : "Aún no tiene estudios: créelo en la sección Estudio"}{facts ? ` · escenario ${SCENARIO_ES[facts.scenario] ?? facts.scenario} · reserva de capacidad ${fmt(facts.reservePct * 100, 0)} % · umbral de sobrecarga ${fmt(facts.overload * 100, 0)} %` : ""}</div>
        </div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="informe" mode={mode} /></div>
      </div>

      {one(raw.ok) && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{one(raw.ok)}</div>}
      {one(raw.error) && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{one(raw.error)}</div>}

      {empty || !facts ? <section className="card"><div className="empty">Aún no hay cargos ni actividades en este modo. Regístrelos en <Link href="/cargos">Cargos y dotación</Link> y <Link href="/actividades">Actividades</Link>.</div></section> : (
        <>
          <p className="note" style={{ margin: 0 }}>Estas son las cifras del informe, calculadas por la aplicación: las mismas de Dotación requerida y de Reparto semanal, reunidas en un solo lugar. Más abajo está el texto del informe, redactado por el agente de IA a partir de estas cifras.</p>

          <section className="grid-kpi" aria-label="Cifras clave">
            <div className="card"><div className="lbl">Personas que hay</div><div className="kpi">{fmt(facts.totals.occupants, 0)}</div><div className="note">En los {facts.data.positionsWithFigure} cargos con cifra</div></div>
            <div className="card"><div className="lbl">Personas necesarias</div><div className="kpi">{fmt(facts.totals.required, 0)}</div><div className="note">Con el umbral de sobrecarga en {fmt(facts.overload * 100, 0)} %{facts.unplannedHours > 0 ? ` · incluye ${fmt(facts.unplannedHours, 1)} h por semana de actividades no planificadas (imprevistos)` : ""}</div></div>
            <div className="card"><div className="lbl">Brecha</div><div className="kpi">{signed(facts.totals.gap)}</div><div className="note">{facts.totals.gap > 0 ? "Faltan personas" : facts.totals.gap < 0 ? "Hay personas de más según la carga registrada" : "La dotación coincide con la carga"}</div></div>
            <div className="card"><div className="lbl">Uso con periódicas</div><div className="kpi">{facts.weeks.periodic ? pct(facts.weeks.periodic.utilization) : "—"}</div><div className="note">{facts.weeks.periodic ? (facts.weeks.periodic.extraPeople > 0 ? `Pide refuerzo: ${facts.weeks.periodic.extraPeople} ${facts.weeks.periodic.extraPeople === 1 ? "persona más" : "personas más"}` : "Sin refuerzo") : "Sin reparto: faltan turnos"}</div></div>
            <div className="card"><div className="lbl">Datos completos</div><div className="kpi">{pct(facts.data.completePct)}</div><div className="note">{facts.data.complete} de {facts.data.activities} actividades</div></div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16 }} aria-label="Gráficas">
            <section className="card" aria-labelledby="g1">
              <h2 id="g1">Personas que hay y necesarias, por área</h2>
              <div className="legend" style={{ display: "flex", gap: 16, fontSize: ".8125rem", color: "var(--muted)", margin: "8px 0 4px", flexWrap: "wrap" }}>
                <span><span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, background: "var(--series-a)", borderRadius: 2, marginRight: 6 }} />Hay hoy</span>
                <span><span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, background: "var(--blue)", borderRadius: 2, marginRight: 6 }} />Necesarias</span>
              </div>
              <PeopleByAreaChart areas={facts.areas} />
              <details className="adv"><summary>Ver los datos en una tabla</summary><div className="adv-body">
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Personas por área"><table style={{ minWidth: 360 }}><thead><tr><th>Área</th><th className="num">Hay</th><th className="num">Necesarias</th><th className="num">Brecha</th></tr></thead>
                  <tbody>{facts.areas.map((a) => <tr key={a.area}><td>{a.area}</td><td className="num">{fmt(a.occupants, 0)}</td><td className="num">{fmt(a.required, 0)}</td><td className="num"><b>{signed(a.gap)}</b></td></tr>)}</tbody></table></div>
              </div></details>
            </section>

            <section className="card" aria-labelledby="g2">
              <h2 id="g2">Uso de la capacidad actual, por cargo</h2>
              <p className="note" style={{ margin: "6px 0 4px" }}>Carga necesaria ÷ capacidad de las personas que hay hoy. Pasar del umbral es sobrecarga.</p>
              <UseByPositionChart positions={facts.positions} overload={facts.overload} />
              {facts.positions.length > 10 && <p className="note" style={{ margin: "6px 0 0" }}>Se muestran los 10 cargos con más uso; todos están en la tabla de abajo.</p>}
            </section>

            <section className="card" aria-labelledby="g3">
              <h2 id="g3">Trabajo de la semana común y con periódicas</h2>
              <p className="note" style={{ margin: "6px 0 4px" }}>Horas por semana frente a la capacidad de las personas necesarias.</p>
              <WeeksChartView common={facts.weeks.common} periodic={facts.weeks.periodic} overload={facts.overload} />
              {facts.weeks.common && <p className="note" style={{ margin: "6px 0 0" }}>En la semana común quedan {fmt(facts.weeks.common.freeHours, 0)} h de disponibilidad sin tareas.</p>}
            </section>
          </section>

          {textOn && basis ? <ReportText versions={versions} selected={selected} basis={basis} canManage={canManage} canGenerate={canGenerate} usage={usage} limit={REPORT_DAILY_LIMIT} />
            : !allAreas ? <p className="note" style={{ margin: 0 }}>El texto del informe cubre todas las áreas del estudio; su acceso está limitado a algunas áreas, por eso no se muestra aquí.</p>
            : mode !== "real" ? <p className="note" style={{ margin: 0 }}>El texto del informe se redacta sobre el estudio real: cambie el modo de análisis a REAL para verlo.</p> : null}

          <section className="card" aria-labelledby="calidad">
            <h2 id="calidad">Calidad de los datos</h2>
            <p className="note" style={{ margin: "6px 0 0" }}>Lo que conviene completar para que las cifras sean más firmes. Las cifras nunca se rellenan por su cuenta.</p>
            <ul className="rowlist" style={{ marginTop: 10 }}>
              <li><span><b>{facts.data.incomplete}</b> {facts.data.incomplete === 1 ? "actividad con datos incompletos" : "actividades con datos incompletos"}: no suman horas.</span><Link href="/actividades">Actividades</Link></li>
              <li><span><b>{facts.data.positionsWithoutFigure}</b> {facts.data.positionsWithoutFigure === 1 ? "cargo sin cifra" : "cargos sin cifra"}: les falta cantidad, jornada o actividades completas.</span><Link href="/cargos">Cargos y dotación</Link></li>
              <li><span><b>{facts.data.positionsPartial}</b> {facts.data.positionsPartial === 1 ? "cargo con cifra mínima" : "cargos con cifra mínima"}: tienen actividades incompletas.</span><Link href="/actividades">Actividades</Link></li>
              <li><span><b>{facts.data.positionsWithoutShifts}</b> {facts.data.positionsWithoutShifts === 1 ? "cargo sin turnos" : "cargos sin turnos"}: no se pueden repartir por día.</span><Link href="/cargos">Cargos y dotación</Link></li>
            </ul>
          </section>

          <section className="card" aria-labelledby="detalle">
            <h2 id="detalle">Detalle por cargo</h2>
            <PagedTable
              label="Detalle por cargo"
              minWidth={900}
              head={<tr><th>Cargo y centro de operaciones</th><th className="num">Hay</th><th className="num">Necesarias (exactas)</th><th className="num">Necesarias</th><th className="num">Brecha</th><th className="num">Uso actual</th><th>Estado</th></tr>}
              rows={facts.positions.map((p) => (
                <tr key={`${p.dataKind}|${p.area}|${p.site}|${p.position}`}>
                  <td><b>{p.position}</b><div className="muted">{p.area} · {p.site} · {p.dataKind === "real" ? "REAL" : "DEMO"}</div></td>
                  <td className="num">{fmt(p.occupants, 0)}</td><td className="num">{fmt(p.exact, 2)}</td><td className="num"><b>{fmt(p.required, 0)}</b></td><td className="num"><b>{signed(p.gap)}</b></td>
                  <td className="num">{pct(p.usePct)}</td>
                  <td><span className={`pill ${p.level}`}>{LEVEL_ES[p.level]}</span><span className="muted">{STATE_ES[p.state]}{p.partial ? " · cifra mínima" : ""}</span></td>
                </tr>
              ))}
            />
          </section>
        </>
      )}
    </main>
  );
}
