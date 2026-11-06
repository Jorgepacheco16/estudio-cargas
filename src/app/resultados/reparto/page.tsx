import { Purpose } from "@/components/Purpose";
import { guardModules } from "@/lib/guard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterBar } from "@/components/FilterBar";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId, parseMode } from "@/data/source";
import { filterQuery } from "@/domain/filters";
import { positionFilters, type RawParams } from "@/lib/page-filters";
import { DAY_NAMES } from "@/domain/shifts";
import { RULE_ES, TYPE_ES, WEEK_ES, formatMinutes, positionKey, type PositionSchedule, type WeekPlan } from "@/domain/schedule";
import { loadSchedules } from "@/server/schedule";

export const metadata = { title: "Reparto semanal" };
const MAX_SHOWN = 6;

function WeekTable({ plan, days }: { plan: WeekPlan; days: number[] }) {
  return (
    <>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${WEEK_ES[plan.kind]}: tareas por persona y día`}>
        <table style={{ minWidth: 140 + days.length * 150 }}>
          <thead><tr><th>Persona</th>{days.map((d) => <th key={d}>{DAY_NAMES[d]}</th>)}<th className="num">Semana</th></tr></thead>
          <tbody>
            {plan.grid.map((row, p) => (
              <tr key={p}>
                <td><b>Persona {p + 1}</b></td>
                {row.map((c, i) => (
                  <td key={i} style={{ verticalAlign: "top", minWidth: 140 }}>
                    {c.items.map((it) => <div key={it.code}><b>{it.code}</b> · {formatMinutes(it.minutes)}</div>)}
                    {c.reserveMin > 0.5 && <div className="muted">Imprevistos · {formatMinutes(c.reserveMin)}</div>}
                    {c.items.length === 0 && c.reserveMin <= 0.5 && <span className="muted">—</span>}
                    <div className="muted" style={{ marginTop: 4 }}>{c.totalMin > c.capacityMin + 0.5 ? <span className="pill overload">Pasa la jornada</span> : null} {formatMinutes(c.totalMin)} de {formatMinutes(c.capacityMin)}</div>
                  </td>
                ))}
                <td className="num"><b>{formatMinutes(row.reduce((s, c) => s + c.totalMin, 0))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 8 }}>{plan.people} {plan.people === 1 ? "persona" : "personas"} · {fmt(plan.assignedHours, 1)} h repartidas{plan.reserveHours > 0 ? ` + ${fmt(plan.reserveHours, 1)} h de imprevistos` : ""}{plan.overflowHours > 1e-6 ? ` · ${fmt(plan.overflowHours, 1)} h no caben` : ""}.</p>
      {plan.activities.length > 0 && (
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${WEEK_ES[plan.kind]}: cuánto toma cada actividad y quién la hace`}>
          <table style={{ minWidth: 860 }}>
            <thead><tr><th>Actividad</th><th>Tipo</th><th>Cómo se reparte</th><th>Quién</th><th className="num">Ejecuciones</th><th className="num">Tiempo de cada ejecución</th><th className="num">Total de la semana</th></tr></thead>
            <tbody>
              {plan.activities.map((a) => (
                <tr key={a.code}>
                  <td><b>{a.code}</b><div className="muted">{a.name}</div></td>
                  <td>{a.type ? TYPE_ES[a.type] : <span className="muted">Sin tipo</span>}</td>
                  <td>{a.perEmployee ? "La hace cada persona" : RULE_ES[a.rule]}{a.simultaneous > 1 ? <div className="muted">{a.simultaneous} personas a la vez</div> : null}</td>
                  <td>{a.persons.length === 0 ? "—" : a.persons.length === plan.people ? "Todas" : a.persons.map((p) => `Persona ${p}`).join(", ")}</td>
                  <td className="num">{fmt(a.executions, 2)}{a.perEmployee ? <div className="muted">por persona</div> : null}</td>
                  <td className="num">{formatMinutes(a.minutesPerExecution)}</td>
                  <td className="num"><b>{formatMinutes(a.weekMinutes)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PositionCard({ s }: { s: PositionSchedule }) {
  return (
    <section className="card" aria-label={`Reparto de ${s.position}`}>
      <h2>{s.position}</h2>
      <div className="sub">{s.area} · {s.site} · {s.dataKind === "real" ? "REAL" : "DEMO"}{s.state === "ok" ? ` · Dotación requerida: ${s.required}` : ""}</div>
      {s.state !== "ok" && <div className="banner" role="status" style={{ marginTop: 12 }}><span>{s.reason}</span></div>}
      {s.notes.map((n) => <div key={n} className="banner" role="status" style={{ marginTop: 12 }}><span>{n}</span></div>)}
      {s.state === "ok" && s.common && s.periodic && (
        <>
          <h3 style={{ marginTop: 20 }}>{WEEK_ES.common}</h3>
          <p className="note">Actividades diarias y semanales, tal como se repiten cada semana.</p>
          <WeekTable plan={s.common} days={s.days} />
          <h3 style={{ marginTop: 24 }}>{WEEK_ES.periodic}</h3>
          <p className="note">La semana común más las actividades quincenales, mensuales, trimestrales y anuales, suponiendo que todas coinciden en esa semana (el caso más exigente).{s.periodic.people > s.common.people ? ` Esa semana hacen falta ${s.periodic.people - s.common.people} ${s.periodic.people - s.common.people === 1 ? "persona más" : "personas más"}.` : ""}</p>
          <WeekTable plan={s.periodic} days={s.days} />
        </>
      )}
    </section>
  );
}

export default async function Reparto({ searchParams }: { searchParams: Promise<RawParams> }) {
  const user = await getUser();
  if (!user) redirect("/login"); // «Resultados» no se muestra en la demostración (D-100)
  await guardModules(["resultados", "cargos", "actividades"]);
  const raw = await searchParams;
  const mode = parseMode(Array.isArray(raw.modo) ? raw.modo[0] : raw.modo) ?? "real";
  const study = await activeStudyId(user.id);
  const loaded = study ? await loadSchedules(getDb(), user.id, study.id, mode) : null;
  const pf = positionFilters(loaded?.positions ?? [], raw);
  const keep = new Set(pf.rows.map((p) => positionKey(p.dataKind, p.area, p.site, p.position)));
  const all = (loaded?.schedules ?? []).filter((s) => keep.has(s.key));
  const shown = all.slice(0, MAX_SHOWN);
  const scenario = loaded ? ({ base: "base", high_season: "temporada alta", low_season: "temporada baja", min_time: "tiempo mínimo", max_time: "tiempo máximo" } as Record<string, string>)[loaded.params.scenario] ?? loaded.params.scenario : "";

  return (
    <main>
      <div className="head">
        <div><h1>Reparto semanal</h1><Purpose k="reparto" /><div className="sub">{study ? `Estudio: ${study.name}` : "Aún no tiene estudios: créelo en la sección Estudio"}{loaded ? ` · escenario ${scenario} · reserva de capacidad ${fmt(loaded.params.reservePct * 100, 0)} %` : ""}</div></div>
        <div className="tools"><ModeForm mode={mode} keep={pf.current} /><ExportButtons view="reparto" mode={mode} extra={filterQuery(pf.current)} /></div>
      </div>
      {loaded && loaded.positions.length > 0 && <FilterBar key={filterQuery(pf.current)} fields={pf.fields} triples={pf.triples} current={pf.current} shown={pf.rows.length} total={loaded.positions.length} hidden={{ modo: mode }} clearHref={`/resultados/reparto?modo=${mode}`} />}

      <details className="adv">
        <summary>¿Cómo se reparte según el tipo de actividad?</summary>
        <div className="adv-body">
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
            <li><b>Operativa y Servicio:</b> se parte libremente. Las ejecuciones van a distintas personas y, si la actividad es por unidad, también se reparten las unidades.</li>
            <li><b>Administrativa, Control y Apoyo:</b> cada ejecución la hace una sola persona; las ejecuciones se reparten entre personas.</li>
            <li><b>Coordinación:</b> una sola persona es responsable de todas las ejecuciones.</li>
            <li><b>Ocasional o no planificada:</b> no se programa. Aparece como «Imprevistos», repartida por igual entre personas y días.</li>
            <li><b>Para todas:</b> lo que hace cada colaborador aparece en la semana de cada persona; lo que exige varias personas a la vez se asigna a varias el mismo día; nadie pasa su jornada diaria ni su semana útil (jornada × (1 − reserva)); los días son los de los turnos del cargo. Si no cabe, se suma gente y se dice.</li>
          </ul>
          <p className="note">Las personas se muestran como «Persona 1, 2…»: el reparto es un modelo de cómo organizar el trabajo, no una asignación de nombres. Una actividad sin tipo registrado se reparte como «Una persona por ejecución».</p>
        </div>
      </details>

      {!loaded || loaded.positions.length === 0 ? <section className="card"><div className="empty">Aún no hay cargos ni actividades en este modo. Regístrelos en <Link href="/cargos">Cargos y dotación</Link> y <Link href="/actividades">Actividades</Link>.</div></section>
        : all.length === 0 ? <section className="card"><div className="empty">Ningún cargo cumple los filtros elegidos. Cambie o limpie los filtros.</div></section>
        : shown.map((s) => <PositionCard key={s.key} s={s} />)}
      {all.length > MAX_SHOWN && <div className="banner" role="status"><span>Se muestran {MAX_SHOWN} de {all.length} cargos. Filtre por área o cargo para ver el reparto de los demás; el Excel trae todos.</span></div>}
    </main>
  );
}
