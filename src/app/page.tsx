import { Purpose } from "@/components/Purpose";
import { sentenceCase } from "@/lib/text";
import { loadAnalysis, parseMode } from "@/data/source";
import Link from "next/link";
import { CargosTable } from "@/components/CargosTable";
import { ExportButtons, ModeForm, fmt, fmtPct } from "@/components/Tools";
import type { Share } from "@/domain/dashboard";

function ShareList({ title, rows, total }: { title: string; rows: Share[]; total?: boolean }) {
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table style={{ minWidth: 0 }}>
        <thead><tr><th>Categoría</th><th className="num">Horas/sem</th><th className="num">% del total</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{fmt(r.hours)}</td><td className="num">{fmtPct(r.pct)}</td></tr>)}</tbody>
      </table></div>
      {total && <p className="note">Potencial por validar: no es un ahorro. Los porcentajes son sobre el total de horas inventariadas.</p>}
    </section>
  );
}

export const metadata = { title: "Inicio" };
export default async function Tablero({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { analysis: a, dashboard: d, params, thresholds, mode, label } = await loadAnalysis(parseMode((await searchParams).modo));
  const k = d.indicators;
  const maxHours = Math.max(1, ...d.areas.map((x) => x.hours ?? 0));
  const warn = mode !== "real";
  return (
    <main>
      <div className="head">
        <div>
          <h1>Inicio</h1><Purpose k="inicio" />
          <div className="sub">{label} · escenario {params.scenario} · reserva {fmtPct(params.reservePct)}</div>
        </div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="tablero" mode={mode} /></div>
      </div>
      <div className="banner" style={warn ? undefined : { background: "var(--blue-soft)", color: "var(--blue)" }}>{sentenceCase(d.modeBanner)}</div>
      <div className="banner">{sentenceCase(d.assumptionsBanner)}</div>

      <section className="grid-kpi" aria-label="Indicadores">
        <div className="card"><div className="lbl">Áreas con información</div><div className="kpi">{k.areasWithInfo}</div></div>
        <div className="card"><div className="lbl">Actividades registradas</div><div className="kpi">{k.activities}</div><div className="note">Solo cuentan las áreas con actividades</div></div>
        <div className="card"><div className="lbl">Con datos completos</div><div className="kpi">{fmtPct(k.completePct)}</div></div>
        <div className="card"><div className="lbl">Horas/semana inventariadas</div><div className="kpi">{fmt(k.hours)}</div><div className="note">Escenario seleccionado</div></div>
        <div className="card"><div className="lbl">Capacidad disponible (h/sem)</div><div className="kpi">{fmt(k.capacity)}</div><div className="note">Cantidad × jornada × (1 − reserva)</div></div>
        <div className="card"><div className="lbl">% de capacidad comprometida</div><div className="kpi">{fmtPct(k.capacityPct)}</div><div className="note">Referencial: no mide productividad</div></div>
        <div className="card"><div className="lbl">Cargos con carga &gt; capacidad</div><div className={`kpi ${k.overload > 0 ? "bad" : ""}`}>{k.overload}</div><div className="note">Revisar datos antes de concluir</div></div>
        <div className="card"><div className="lbl">Cargos con carga baja (validar)</div><div className="kpi">{k.lowLoad}</div><div className="note">Validar inventario; no es sobrante</div></div>
        <div className="card"><div className="lbl">Actividades con fuente verificable</div><div className="kpi">{fmtPct(k.verifiablePct)}</div><div className="note">Observada, cronometrada o de registros</div></div>
        <div className="card"><div className="lbl">Oportunidades registradas</div><div className="kpi">{k.opportunities}</div></div>
        <div className="card"><div className="lbl">Tiempo recuperable (h/sem)</div><div className="kpi">{fmt(k.recoverableHours)}</div><div className="note">Potencial por validar; no es ahorro</div></div>
        <div className="card"><div className="lbl">Críticas sin respaldo</div><div className={`kpi ${k.criticalNoBackup > 0 ? "bad" : ""}`}>{k.criticalNoBackup}</div><div className="note">Críticas/altas con ≤ 1 persona</div></div>
      </section>

      <section className="card" aria-label="Carga por cargo">
        <h2>Carga frente a capacidad por cargo</h2>
        <div className="note">Umbrales del estudio: sobrecarga sobre {fmtPct(thresholds.high)} · carga baja bajo {fmtPct(thresholds.low)}</div>
        <CargosTable rows={a.positions} />
      </section>

      <section className="card" aria-label="Carga por área">
        <h2>A. Carga laboral por área</h2>
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table>
            <thead><tr><th>Área</th><th className="num">Actividades</th><th className="num">Completas</th><th className="num">Horas/sem</th><th className="num">Capacidad</th><th>% capacidad</th><th>Alerta o lectura</th></tr></thead>
            <tbody>
              {d.areas.map((r) => (
                <tr key={r.area}>
                  <td>{r.activities ? <Link href={`/drill?modo=${mode}&level=area&area=${encodeURIComponent(r.area)}`} style={{ textDecoration: "underline" }}><b>{r.area}</b></Link> : <b>{r.area}</b>}</td><td className="num">{r.activities || "—"}</td><td className="num">{r.activities ? r.complete : "—"}</td>
                  <td className="num">{r.hours === null ? "—" : fmt(r.hours)}</td><td className="num">{r.capacity === null ? "—" : fmt(r.capacity)}</td>
                  <td>{r.pct === null ? "—" : <div style={{ display: "flex", gap: 8, alignItems: "center" }}><div className="bar" style={{ flex: 1 }}><span style={{ width: `${Math.min(100, r.pct * 100)}%`, background: "var(--blue)" }} /></div><b>{fmtPct(r.pct)}</b></div>}</td>
                  <td className="muted">{r.reading}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, fontSize: ".875rem" }}>
          {d.areas.filter((r) => (r.hours ?? 0) > 0).map((r) => (
            <div key={r.area}><div style={{ display: "flex", justifyContent: "space-between" }}><span>{r.area}</span><b>{fmt(r.hours)} h/sem</b></div><div className="bar"><span style={{ width: `${((r.hours ?? 0) / maxHours) * 100}%`, background: "var(--red)" }} /></div></div>
          ))}
        </div>
      </section>

      <div className="row">
        <ShareList title="B. Aporte de valor" rows={d.byValue} />
        <ShareList title="B. Tipo de actividad" rows={d.byType} />
        <ShareList title="B. Potencial alto de…" rows={d.byPotential} total />
      </div>

      <section className="card" aria-label="Top 10">
        <h2>C. Las 10 actividades que más horas consumen</h2>
        {d.top10.length === 0 ? <div className="empty">Aún no hay actividades con datos completos.</div> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
            <thead><tr><th>Actividad</th><th>Código</th><th>Área</th><th>Cargo</th><th>Centro de operaciones</th><th className="num">Horas/sem</th><th className="num">% del total</th></tr></thead>
            <tbody>{d.top10.map((t) => <tr key={t.code}><td>{t.name}</td><td><b>{t.code}</b></td><td>{t.area}</td><td>{t.position}</td><td>{t.site}</td><td className="num">{fmt(t.hours)}</td><td className="num">{fmtPct(t.pct)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <div className="row">
        <section className="card" aria-label="Cobertura y calidad">
          <h2>D. Cobertura y calidad de la información</h2>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table style={{ minWidth: 0 }}>
            <tbody>{d.coverage.map((c) => <tr key={c.label}><td>{sentenceCase(c.label)}{c.note && <div className="muted">{c.note}</div>}</td><td className="num"><b>{c.value}</b></td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="card" aria-label="Oportunidades y plan">
          <h2>E. Oportunidades de mejora y plan de acción</h2>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table style={{ minWidth: 0 }}>
            <tbody>{d.opportunities.map((c) => <tr key={c.label}><td>{c.label}</td><td className="num"><b>{c.value}</b></td></tr>)}</tbody>
          </table></div>
        </section>
      </div>

      <section className="card" aria-label="Conclusiones">
        <h2>F. Conclusiones preliminares</h2>
        <p className="note">Se generan con los datos disponibles y dependen de la cobertura y la calidad de la información.</p>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: ".875rem", lineHeight: 1.5 }}>
          {d.conclusions.map((c) => <li key={c}>{sentenceCase(c)}</li>)}
        </ul>
      </section>
    </main>
  );
}
