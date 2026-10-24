import type { Mode } from "@/domain/summary";
import type { View } from "@/lib/tables";

/** Botones de exportación (Excel y CSV) de la vista actual, respetando el modo de análisis. */
export function ExportButtons({ view, mode, extra = "" }: { view: View; mode: Mode; extra?: string }) {
  const q = `modo=${mode}${extra ? `&${extra}` : ""}`;
  return (
    <>
      <a className="btn solid" href={`/api/export/${view}?format=xlsx&${q}`} download>Exportar Excel</a>
      <a className="btn" href={`/api/export/${view}?format=csv&${q}`} download>Exportar CSV</a>
      <a className="btn" href={`/api/export/${view}?format=pdf&${q}`} download>Exportar PDF</a>
    </>
  );
}

export function ModeForm({ mode }: { mode: Mode }) {
  return (
    <form method="get" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      <label className="f">Modo de análisis
        <select name="modo" defaultValue={mode}>
          <option value="demo">DEMO</option>
          <option value="real">REAL</option>
          <option value="all">TODOS</option>
        </select>
      </label>
      <button className="btn" type="submit">Aplicar</button>
    </form>
  );
}

export const fmt = (n: number | null, d = 1) => (n === null ? "—" : n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtPct = (n: number | null) => (n === null ? "—" : (n * 100).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %");
