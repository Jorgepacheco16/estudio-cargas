import { loadAnalysis, parseMode, SOURCE_LABEL } from "@/data/source";
import { CargosTable } from "@/components/CargosTable";
import { ExportButtons, ModeForm } from "@/components/Tools";

export default async function Cargos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = parseMode((await searchParams).modo);
  const { analysis: a } = loadAnalysis(mode);
  return (
    <main>
      <div className="head">
        <div><h1>Cargos y dotación</h1><div className="sub">{SOURCE_LABEL} · {a.positions.length} cargo-sede</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="cargos" mode={mode} /></div>
      </div>
      <section className="card"><CargosTable rows={a.positions} /></section>
    </main>
  );
}
