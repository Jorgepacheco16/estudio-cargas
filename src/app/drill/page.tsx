import { Purpose } from "@/components/Purpose";
import Link from "next/link";
import { loadAnalysis, parseMode } from "@/data/source";
import { ExportButtons, ModeForm, fmt, fmtPct } from "@/components/Tools";
import { LEVEL_ES, METRIC_ES, PRESETS, PRESET_ES, drillRows, type DrillFilters, type LevelKey, type Metric } from "@/domain/drill";

const LEVELS: LevelKey[] = ["study", "area", "position", "activity"];
const q = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");

export const metadata = { title: "Drill-down: Carga por áreas" };
export default async function Drill({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { analysis, mode, label } = await loadAnalysis(parseMode(sp.modo));
  const config = PRESETS[sp.config ?? ""] ? sp.config! : "carga-por-area";
  const cfg = PRESETS[config];
  const level = LEVELS.find((l) => l === sp.level) ?? "study";
  const alert = sp.alert === "overload" || sp.alert === "lowLoad" || sp.alert === "incomplete" ? sp.alert : "";
  const filters: DrillFilters & { code?: string } = { area: sp.area, site: sp.site, position: sp.position, code: sp.code, alertOnly: alert };
  const rows = drillRows(analysis, cfg, level, filters);
  const metrics = (cfg.levels.find((l) => l.key === level)?.metrics ?? []) as Metric[];
  const base = { modo: mode, config };
  const crumbs: { text: string; href: string }[] = [{ text: "Estudio", href: `/drill?${q({ ...base, alert })}` }];
  if (sp.area) crumbs.push({ text: sp.area, href: `/drill?${q({ ...base, level: "area", area: sp.area, alert })}` });
  if (sp.position) crumbs.push({ text: `${sp.position}${sp.site ? ` · ${sp.site}` : ""}`, href: `/drill?${q({ ...base, level: "position", area: sp.area, site: sp.site, position: sp.position, alert })}` });
  if (sp.code) crumbs.push({ text: sp.code, href: "#" });

  const fmtMetric = (m: Metric, v: number | null | undefined) => (v === null || v === undefined ? "—" : m === "pct" ? fmtPct(v) : m === "incomplete" ? String(v) : fmt(v, 2));
  const extra = q({ config, level, area: sp.area, site: sp.site, position: sp.position, code: sp.code, alert });

  return (
    <main>
      <div className="head">
        <div><h1>Drill-down: {PRESET_ES[config]}</h1><Purpose k="drill" /><div className="sub">{label} · Estudio → Área → Cargo → Actividad: haga clic para bajar un nivel</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="drill" mode={mode} extra={extra} /></div>
      </div>
      <section className="card">
        <div className="tabs" role="tablist" aria-label="Configuración" style={{ marginBottom: 8 }}>
          {Object.keys(PRESETS).map((c) => <Link key={c} href={`/drill?${q({ modo: mode, config: c })}`} role="tab" aria-selected={c === config} className={c === config ? "on" : ""}>{PRESET_ES[c] ?? c}</Link>)}
        </div>
        <nav aria-label="Ruta del drill-down" style={{ fontSize: ".875rem", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {crumbs.map((c, i) => <span key={c.text}>{i > 0 && " › "}{i === crumbs.length - 1 ? <b>{c.text}</b> : <Link href={c.href} style={{ textDecoration: "underline" }}>{c.text}</Link>}</span>)}
        </nav>
        <div className="muted" style={{ marginTop: 6 }}>Nivel: {LEVEL_ES[level]} · Filtro: {([["", "todos"], ["overload", "solo sobrecarga"], ["lowLoad", "solo carga baja"], ["incomplete", "solo incompletos"]] as const).map(([v, t]) => <Link key={v} href={`/drill?${q({ ...base, level, area: sp.area, site: sp.site, position: sp.position, code: sp.code, alert: v })}`} style={{ marginLeft: 8, textDecoration: v === alert ? "none" : "underline", fontWeight: v === alert ? 700 : 400 }}>{t}</Link>)}</div>
        {rows.length === 0 ? <div className="empty">No hay filas para este nivel y filtro.</div> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable"><table>
            <thead><tr><th>{LEVEL_ES[level]}</th><th>Detalle</th>{metrics.map((m) => <th key={m} className="num">{METRIC_ES[m]}</th>)}<th>Lectura o estado</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key}>
                <td>{r.next ? <Link href={`/drill?${q({ ...base, level: r.next.level, ...(r.next.filters as Record<string, string | undefined>), alert })}`} style={{ textDecoration: "underline" }}><b>{r.label}</b></Link> : <b>{r.label}</b>}</td>
                <td className="muted">{r.detail ?? ""}</td>
                {metrics.map((m) => <td key={m} className="num">{fmtMetric(m, r.metrics[m])}</td>)}
                <td className="muted">{r.status && r.status !== "OK" ? r.status : r.level ? { overload: "Sobrecarga", low: "Carga baja (validar)", ok: "Dentro del rango", nodata: "Sin datos suficientes" }[r.level] : ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}
