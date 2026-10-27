import { Purpose } from "@/components/Purpose";
import { loadAnalysis, parseMode } from "@/data/source";
import { CargosTable } from "@/components/CargosTable";
import { FilterBar } from "@/components/FilterBar";
import { ExportButtons, ModeForm } from "@/components/Tools";
import { EntrySection } from "@/components/entry/views";
import { filterQuery } from "@/domain/filters";
import { positionFilters, type RawParams } from "@/lib/page-filters";

export const metadata = { title: "Cargos y dotación" };
export default async function Cargos({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams;
  const modo = Array.isArray(raw.modo) ? raw.modo[0] : raw.modo;
  const { analysis: a, mode, label } = await loadAnalysis(parseMode(modo));
  const pf = positionFilters(a.positions, raw);
  return (
    <main>
      <div className="head">
        <div><h1>Cargos y dotación</h1><Purpose k="cargos" /><div className="sub">{label} · {pf.rows.length}{pf.rows.length !== a.positions.length ? ` de ${a.positions.length}` : ""} cargo-sede</div></div>
        <div className="tools"><ModeForm mode={mode} keep={pf.current} /><ExportButtons view="cargos" mode={mode} extra={filterQuery(pf.current)} /></div>
      </div>
      {a.positions.length > 0 && <FilterBar key={filterQuery(pf.current)} fields={pf.fields} triples={pf.triples} current={pf.current} shown={pf.rows.length} total={a.positions.length} hidden={{ modo: mode }} clearHref={`/cargos?modo=${mode}`} />}
      {/* Primero los registros capturados (lo que se edita); debajo, el cuadro de resultados calculados (solo lectura). */}
      <EntrySection hoja="2" sp={raw} bar={false} />
      <section className="card">{a.positions.length > 0 && pf.rows.length === 0 ? <div className="empty">Ningún cargo cumple los filtros elegidos. Cambie o limpie los filtros.</div> : <CargosTable rows={pf.rows} />}</section>
    </main>
  );
}
