import { loadAnalysis, parseMode } from "@/data/source";
import { CargosTable } from "@/components/CargosTable";
import { ExportButtons, ModeForm } from "@/components/Tools";

export const metadata = { title: "Cargos y dotación" };
export default async function Cargos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { analysis: a, mode, label } = await loadAnalysis(parseMode((await searchParams).modo));
  return (
    <main>
      <div className="head">
        <div><h1>Cargos y dotación</h1><div className="sub">{label} · {a.positions.length} cargo-sede</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="cargos" mode={mode} /></div>
      </div>
      <section className="card"><CargosTable rows={a.positions} /></section>
    </main>
  );
}
