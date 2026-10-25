import { Purpose } from "@/components/Purpose";
import { loadAnalysis, parseMode } from "@/data/source";
import { CargosTable } from "@/components/CargosTable";
import { ExportButtons, ModeForm } from "@/components/Tools";
import { EntrySection } from "@/components/entry/views";

export const metadata = { title: "Cargos y dotación" };
export default async function Cargos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { analysis: a, mode, label } = await loadAnalysis(parseMode(sp.modo));
  return (
    <main>
      <div className="head">
        <div><h1>Cargos y dotación</h1><Purpose k="cargos" /><div className="sub">{label} · {a.positions.length} cargo-sede</div></div>
        <div className="tools"><ModeForm mode={mode} /><ExportButtons view="cargos" mode={mode} /></div>
      </div>
      <section className="card"><CargosTable rows={a.positions} /></section>
      <EntrySection hoja="2" sp={sp} />
    </main>
  );
}
