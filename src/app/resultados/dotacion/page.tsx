import { Purpose } from "@/components/Purpose";
import { guardModules } from "@/lib/guard";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import Link from "next/link";
import { PagedTable } from "@/components/PagedTable";
import { FilterBar } from "@/components/FilterBar";
import { ExportButtons, ModeForm, fmt } from "@/components/Tools";
import { loadAnalysis, parseMode } from "@/data/source";
import { filterQuery } from "@/domain/filters";
import { positionFilters, type RawParams } from "@/lib/page-filters";
import { areasOf, needsOf, STATE_ES, summaryOf, type NeedState } from "@/domain/staffing";

export const metadata = { title: "Dotación requerida" };

const PILL: Record<NeedState, string> = { short: "overload", surplus: "low", balanced: "ok", nodata: "nodata" };
const signed = (n: number) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));

export default async function Dotacion({ searchParams }: { searchParams: Promise<RawParams> }) {
  if (!(await getUser())) redirect("/login"); // «Resultados» no se muestra en la demostración (D-100)
  await guardModules(["resultados", "cargos", "actividades"]);
  const raw = await searchParams;
  const modo = Array.isArray(raw.modo) ? raw.modo[0] : raw.modo;
  const { analysis: a, mode, label, params, thresholds } = await loadAnalysis(parseMode(modo));
  const pf = positionFilters(a.positions, raw);
  const needs = needsOf(pf.rows, thresholds.high, params.staffRoundFrom ?? 0), total = summaryOf(needs), areas = areasOf(needs);
  const partial = needs.filter((n) => n.partial && n.required !== null).length;
  const scenario = { base: "base", high_season: "temporada alta", low_season: "temporada baja", min_time: "tiempo mínimo", max_time: "tiempo máximo" }[params.scenario] ?? params.scenario;

  return (
    <main>
      <div className="head">
        <div><h1>Dotación requerida</h1><Purpose k="dotacion" /><div className="sub">{label} · {needs.length}{needs.length !== a.positions.length ? ` de ${a.positions.length}` : ""} cargo-sede · escenario {scenario} · reserva de capacidad {fmt(params.reservePct * 100, 0)} %</div></div>
        <div className="tools"><ModeForm mode={mode} keep={pf.current} /><ExportButtons view="dotacion" mode={mode} extra={filterQuery(pf.current)} /></div>
      </div>
      {a.positions.length > 0 && <FilterBar key={filterQuery(pf.current)} fields={pf.fields} triples={pf.triples} current={pf.current} shown={pf.rows.length} total={a.positions.length} hidden={{ modo: mode }} clearHref={`/resultados/dotacion?modo=${mode}`} />}

      <section className="grid-kpi" aria-label="Resumen de la dotación">
        <div className="card"><div className="lbl">Personas que hay</div><div className="kpi">{fmt(total.occupants, 0)}</div><div className="note">En los cargos con cifra</div></div>
        <div className="card"><div className="lbl">Personas necesarias</div><div className="kpi">{fmt(total.required, 0)}</div><div className="note">{fmt(total.exact, 1)} exactas, redondeadas por cargo: desde {fmt((params.staffRoundFrom ?? 0) * 100, 0)} % de persona se suma una (umbral de sobrecarga {fmt(thresholds.high * 100, 0)} %)</div></div>
        <div className="card"><div className="lbl">Brecha</div><div className="kpi">{signed(total.gap)}</div><div className="note">{total.gap > 0 ? "Faltan personas" : total.gap < 0 ? "Hay personas de más según la carga registrada" : "La dotación coincide con la carga"}</div></div>
        <div className="card"><div className="lbl">Cargos sin cifra</div><div className="kpi">{total.withoutData} <small>de {total.positions}</small></div><div className="note">Les falta cantidad, jornada o actividades completas</div></div>
      </section>

      {partial > 0 && <div className="banner" role="status"><span>{partial === 1 ? "1 cargo tiene actividades incompletas" : `${partial} cargos tienen actividades incompletas`}: su cifra es un mínimo y puede subir al completar los datos en <Link href="/actividades">Actividades</Link>.</span></div>}

      <section className="card" aria-label="Dotación por área">
        <h2>Por área</h2>
        <p className="note" style={{ marginTop: 8 }}>Suma de los cargos con cifra de cada área. La brecha es la suma de las brechas de sus cargos: un cargo con exceso no cubre el faltante de otro.</p>
        {areas.length === 0 ? <div className="empty">Aún no hay cargos ni actividades en este modo. Regístrelos en <Link href="/cargos">Cargos y dotación</Link> y <Link href="/actividades">Actividades</Link>.</div> : (
          <PagedTable
            label="Dotación por área"
            minWidth={640}
            head={<tr><th>Área</th><th className="num">Personas que hay</th><th className="num">Personas necesarias</th><th className="num">Brecha</th><th className="num">Cargos sin cifra</th></tr>}
            rows={areas.map((r) => (
              <tr key={r.area}><td><b>{r.area}</b></td><td className="num">{fmt(r.occupants, 0)}</td><td className="num">{fmt(r.required, 0)}</td><td className="num"><b>{signed(r.gap)}</b></td><td className="num">{r.withoutData > 0 ? `${r.withoutData} de ${r.positions}` : "—"}</td></tr>
            ))}
          />
        )}
      </section>

      <section className="card" aria-label="Dotación por cargo">
        <h2>Por cargo</h2>
        <p className="note" style={{ marginTop: 8 }}>Personas necesarias = horas de la semana ÷ horas útiles de una persona (jornada × (1 − reserva)), redondeado con la regla de Parámetros: la parte decimal suma una persona más solo si llega al {fmt((params.staffRoundFrom ?? 0) * 100, 0)} % (por ejemplo, con 50 %, 5,4 son 5 personas y 5,5 son 6); el umbral de sobrecarga ({fmt(thresholds.high * 100, 0)} %) se descuenta antes. «Brecha» positiva: faltan; negativa: hay de más.</p>
        {needs.length === 0 ? <div className="empty">{a.positions.length === 0 ? "Aún no hay cargos en este modo." : "Ningún cargo cumple los filtros elegidos. Cambie o limpie los filtros."}</div> : (
          <PagedTable
            label="Dotación por cargo"
            minWidth={980}
            head={<tr><th>Cargo y centro de operaciones</th><th className="num">Personas que hay</th><th className="num">Horas por semana</th><th className="num">Horas útiles por persona</th><th className="num">Necesarias (exactas)</th><th className="num">Necesarias</th><th className="num">Brecha</th><th>Estado</th></tr>}
            rows={needs.map((n) => (
              <tr key={`${n.dataKind}|${n.area}|${n.site}|${n.position}`}>
                <td><b>{n.position}</b><div className="muted">{n.area} · {n.site} · {n.dataKind === "real" ? "REAL" : "DEMO"}</div></td>
                <td className="num">{fmt(n.occupants, 0)}</td>
                <td className="num">{n.hours > 0 ? fmt(n.hours, 2) : "—"}</td>
                <td className="num">{fmt(n.hoursPerPerson, 2)}</td>
                <td className="num">{fmt(n.exact, 2)}</td>
                <td className="num"><b>{n.required === null ? "—" : fmt(n.required, 0)}</b></td>
                <td className="num"><b>{n.gap === null ? "—" : signed(n.gap)}</b></td>
                <td><span className={`pill ${PILL[n.state]}`}>{STATE_ES[n.state]}</span><span className="muted">{n.reading}</span></td>
              </tr>
            ))}
          />
        )}
      </section>

      <details className="adv">
        <summary>¿Cómo se calcula? (explicado paso a paso)</summary>
        <div className="adv-body">
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
            <li><b>Horas de la semana</b> = suma de las horas por semana de las actividades completas del cargo (las mismas de Cálculo de tiempos, con el escenario elegido en Parámetros).</li>
            <li><b>Horas útiles de una persona</b> = jornada semanal × (1 − reserva de capacidad). La reserva es el tiempo que no se asigna a actividades (pausas, imprevistos).</li>
            <li><b>Personas necesarias (exactas)</b> = horas de la semana ÷ horas útiles de una persona.</li>
            <li><b>Personas necesarias</b> = exactas ÷ umbral de sobrecarga de Parámetros, redondeado con la <b>fracción desde la cual se suma una persona</b> (también en Parámetros). Con 50 %, 5,4 personas de trabajo son 5 (cada una queda al 108 % de su jornada útil) y 5,5 son 6. Con 0 % siempre se redondea hacia arriba (5,1 son 6), que es no aceptar ninguna sobrecarga. El umbral de sobrecarga acepta además un margen general: con 105 %, 5,2 se cubren con 5. Un umbral menor que 100 % se trata como 100 %.</li>
            <li><b>Brecha</b> = personas necesarias − personas que hay.</li>
          </ol>
          <p className="note">Un cargo sin cantidad y jornada, o sin actividades completas, no recibe cifra: la aplicación no rellena datos por su cuenta. Si un cargo tiene actividades incompletas, su cifra es un mínimo. Un excedente es una señal para validar el inventario, no una decisión de reducir personal.</p>
        </div>
      </details>
    </main>
  );
}
