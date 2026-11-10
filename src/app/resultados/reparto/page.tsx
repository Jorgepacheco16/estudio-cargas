import { Purpose } from "@/components/Purpose";
import { guardModules } from "@/lib/guard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterBar } from "@/components/FilterBar";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId, parseMode } from "@/data/source";
import { canEdit } from "@/lib/access";
import { filterQuery } from "@/domain/filters";
import { positionFilters, type RawParams } from "@/lib/page-filters";
import { DAY_NAMES, DAY_SHORT } from "@/domain/shifts";
import { RULE_ES, TYPE_ES, WEEK_ES, formatMinutes, positionKey, type ActivityCheck, type PositionSchedule, type WeekPlan } from "@/domain/schedule";
import { loadSchedules } from "@/server/schedule";
import { DayCell } from "@/components/resultados/DayCell";

export const metadata = { title: "Reparto semanal" };
const MAX_SHOWN = 6;

function WeekTable({ plan, days, position, positionKey: pkey, canSave }: { plan: WeekPlan; days: number[]; position: string; positionKey: string; canSave: boolean }) {
  return (
    <>
      <p className="note rp-legend">Cada celda muestra la franja horaria en que cuadran las tareas de la persona ese día, el total de horas y sus primeras tareas; la barra es lo que usa de la jornada útil del día. Pulse una celda para ver todas las tareas y cambiar su orden.</p>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${WEEK_ES[plan.kind]}: tareas por persona y día`}>
        <table className="rp-table" style={{ minWidth: 240 + days.length * 150 }}>
          <thead><tr><th className="rp-person">Persona</th>{days.map((d) => <th key={d} className="rp-day">{DAY_NAMES[d]}</th>)}<th className="num rp-week">Semana</th></tr></thead>
          <tbody>
            {plan.grid.map((row, p) => (
              <tr key={p}>
                <td className="rp-person"><b>Persona {p + 1}</b></td>
                {row.map((c, i) => (
                  <td key={i} className="rp-td">
                    <DayCell person={p + 1} day={DAY_NAMES[days[i]]} position={position} week={WEEK_ES[plan.kind]} cell={c} target={{ positionKey: pkey, kind: plan.kind, weekday: days[i] }} canSave={canSave} />
                  </td>
                ))}
                <td className="num rp-week"><b>{formatMinutes(row.reduce((s, c) => s + c.totalMin, 0))}</b></td>
              </tr>
            ))}
            {plan.overflowHours > 1e-6 && (
              <tr className="rp-unassigned">
                <td className="rp-person"><b>Sin asignar</b></td>
                {plan.unassigned.map((u, i) => (
                  <td key={i} className="rp-td">
                    <div className="rp-un">
                      {u.minutes > 0.5 ? <><b>{formatMinutes(u.minutes)}</b>{u.items.map((it) => <span key={it.code} className="rp-task"><span className="rp-code">{it.code}</span><span className="rp-min">{formatMinutes(it.minutes)}</span></span>)}</> : <span className="muted">—</span>}
                    </div>
                  </td>
                ))}
                <td className="num rp-week"><b>{formatMinutes(plan.overflowHours * 60)}</b></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 8 }}>{plan.people} {plan.people === 1 ? "persona" : "personas"} · {fmt(plan.assignedHours, 1)} h repartidas{plan.reserveHours > 0 ? ` + ${fmt(plan.reserveHours, 1)} h de imprevistos` : ""} · uso de la capacidad {fmt(plan.utilization * 100, 0)} %{plan.freeHours > 0.05 ? ` · disponibilidad sin tareas ${fmt(plan.freeHours, 1)} h` : ""}{plan.overflowHours > 1e-6 ? ` · ${fmt(plan.overflowHours, 1)} h no caben` : ""}. Pulse un día para ver las tareas de esa persona en orden; puede cambiar el orden y, con Edición en Resultados, guardarlo.</p>
      {plan.activities.length > 0 && (
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`${WEEK_ES[plan.kind]}: cuánto toma cada actividad y quién la hace`}>
          <table style={{ minWidth: 860 }}>
            <thead><tr><th>Actividad</th><th>Tipo</th><th>Cómo se reparte</th><th>Quién</th><th className="num">Ejecuciones</th><th className="num">Tiempo de cada ejecución</th><th className="num">Total de la semana</th></tr></thead>
            <tbody>
              {plan.activities.map((a) => (
                <tr key={a.code}>
                  <td><b>{a.code}</b><div className="muted">{a.name}</div></td>
                  <td>{a.type ? TYPE_ES[a.type] : <span className="muted">Sin tipo</span>}</td>
                  <td>{a.perEmployee ? "Por colaborador, rotando" : RULE_ES[a.rule]}{a.shared ? <div className="muted">Compartida: no cupo entera</div> : null}{a.simultaneous > 1 ? <div className="muted">{a.simultaneous} personas a la vez</div> : null}</td>
                  <td>{a.persons.length === 0 ? "—" : a.persons.length === plan.people ? "Todas" : a.persons.map((p) => `Persona ${p}`).join(", ")}</td>
                  <td className="num">{fmt(a.executions, 2)}</td>
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

const FREQ_ES: Record<ActivityCheck["frequency"], string> = { daily: "Diaria", weekly: "Semanal", periodic: "Periódica" };
const daysText = (xs: number[]) => (xs.length === 0 ? "—" : xs.length === 7 ? "Todos" : xs.map((d) => DAY_SHORT[d]).join(" "));

/** Verificación de que cada actividad que se programa queda en los días que le corresponden (D-110): una fila por actividad, con lo esperado y lo que quedó. */
function CheckPanel({ s }: { s: PositionSchedule }) {
  if (s.check.length === 0) return null;
  const bad = s.check.filter((c) => c.missingDays.length > 0);
  return (
    <details className="adv" style={{ marginTop: 12 }} open={bad.length > 0}>
      <summary>Verificación de actividades: {bad.length === 0 ? `las ${s.check.length} quedan en los días que les corresponden` : `${bad.length} de ${s.check.length} no quedan en todos sus días`}</summary>
      <div className="adv-body">
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`Verificación de actividades de ${s.position}`}>
          <table style={{ minWidth: 640 }}>
            <thead><tr><th>Actividad</th><th>Frecuencia</th><th>Días que le corresponden</th><th>Días en que quedó</th><th>Estado</th></tr></thead>
            <tbody>
              {s.check.map((c) => (
                <tr key={c.code + c.week}>
                  <td><b>{c.code}</b><div className="muted">{c.name}</div></td>
                  <td>{FREQ_ES[c.frequency]}{c.week === "periodic" ? " (semana con periódicas)" : ""}</td>
                  <td>{c.frequency === "daily" ? daysText(c.expectedDays) : `Cualquiera de: ${daysText(c.expectedDays)}`}</td>
                  <td>{daysText(c.scheduledDays)}</td>
                  <td>{c.missingDays.length === 0 ? <span className="pill ok">Completa</span> : <span className="pill overload">Falta: {daysText(c.missingDays)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Las diarias deben quedar en todos los días que les corresponden (los de sus turnos); las semanales y periódicas, al menos en uno. Lo que falta aparece en la fila «Sin asignar» de la semana.</p>
      </div>
    </details>
  );
}

function PositionCard({ s, canSave }: { s: PositionSchedule; canSave: boolean }) {
  return (
    <section className="card" aria-label={`Reparto de ${s.position}`}>
      <h2>{s.position}</h2>
      <div className="sub">{s.area} · {s.site} · {s.dataKind === "real" ? "REAL" : "DEMO"}{s.state === "ok" ? ` · Dotación requerida: ${s.required}` : ""}{s.service ? ` · Atención del cargo: ${s.service.start} a ${s.service.end} (${fmt(s.service.hours, 1)} h)` : ""}</div>
      {s.state !== "ok" && <div className="banner" role="status" style={{ marginTop: 12 }}><span>{s.reason}</span></div>}
      {s.notes.map((n) => <div key={n} className="banner" role="status" style={{ marginTop: 12 }}><span>{n}</span></div>)}
      {s.state === "ok" && <CheckPanel s={s} />}
      {s.state === "ok" && s.common && s.periodic && (
        <>
          <h3 style={{ marginTop: 20 }}>{WEEK_ES.common}</h3>
          <p className="note">Actividades diarias y semanales, tal como se repiten cada semana.</p>
          <WeekTable plan={s.common} days={s.days} position={s.position} positionKey={s.key} canSave={canSave} />
          <h3 style={{ marginTop: 24 }}>{WEEK_ES.periodic}</h3>
          <p className="note">La semana común más las actividades quincenales, mensuales, trimestrales y anuales, suponiendo que todas coinciden en esa semana (el caso más exigente).{s.periodic.extraPeople > 0 ? ` Esa semana harían falta ${s.periodic.extraPeople} ${s.periodic.extraPeople === 1 ? "persona más" : "personas más"} (refuerzo) o horas extra.` : ""}</p>
          <WeekTable plan={s.periodic} days={s.days} position={s.position} positionKey={s.key} canSave={canSave} />
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
  const canSave = !!study && canEdit(study, "resultados"); // guardar el orden de las tareas exige Edición en Resultados (la base lo vuelve a exigir)
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
            <li><b>Horarios y equilibrio:</b> una persona puede tener el mismo día tareas de turnos distintos si sus horarios se solapan (apertura y tesorería, que caen en la mañana), pero no de extremos opuestos del día (apertura y cierre); el mínimo compartido se fija en Parámetros. Dentro de lo compatible se reparte parejo entre las personas, sin importar de qué turno surgió la tarea. Nadie pasa su jornada: lo que no cabe aparece en la fila «Sin asignar».</li>
            <li><b>Descanso y días:</b> cada persona trabaja las horas de su semana en 6 días (42 h ÷ 7 h) y descansa el otro día del cargo; los descansos van primero al domingo y rotan cada semana. Una actividad solo se programa en los días de los turnos en que se ejecuta (la de tesorería, de lunes a sábado, no cae el domingo).</li>
            <li><b>Para todas:</b> las personas son las de Dotación requerida (el reparto no suma gente) y se reparten las mismas horas de Cálculo de tiempos; lo que hace cada colaborador se reparte rotando entre las personas; lo que exige varias personas a la vez se asigna a varias el mismo día; el reparto nivela para que todas queden con tiempo parejo y nadie pasa su jornada útil (jornada × (1 − reserva)) más la sobrecarga aceptada en Parámetros. Si una tarea no cabe entera con la regla de su tipo, se comparte entre personas lo mínimo y se marca. Los días son los de los turnos del cargo.</li>
          </ul>
          <p className="note">El orden de las tareas de cada día se puede cambiar y guardar (con Edición en Resultados); es una sugerencia de esta vista y no cambia tiempos ni ninguna otra sección. Las personas se muestran como «Persona 1, 2…»: el reparto es un modelo de cómo organizar el trabajo, no una asignación de nombres. Una actividad sin tipo registrado se reparte como «Una persona por ejecución».</p>
        </div>
      </details>

      {!loaded || loaded.positions.length === 0 ? <section className="card"><div className="empty">Aún no hay cargos ni actividades en este modo. Regístrelos en <Link href="/cargos">Cargos y dotación</Link> y <Link href="/actividades">Actividades</Link>.</div></section>
        : all.length === 0 ? <section className="card"><div className="empty">Ningún cargo cumple los filtros elegidos. Cambie o limpie los filtros.</div></section>
        : shown.map((s) => <PositionCard key={s.key} s={s} canSave={canSave} />)}
      {all.length > MAX_SHOWN && <div className="banner" role="status"><span>Se muestran {MAX_SHOWN} de {all.length} cargos. Filtre por área o cargo para ver el reparto de los demás; el Excel trae todos.</span></div>}
    </main>
  );
}
