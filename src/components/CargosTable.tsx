import type { PositionRow } from "@/domain/summary";
import { fmt, fmtPct } from "./Tools";

const BAR: Record<string, string> = { overload: "var(--red)", low: "var(--amber)", ok: "var(--blue)", nodata: "var(--line)" };
const LABEL: Record<string, string> = { overload: "ALERTA", low: "VALIDAR", ok: "En rango", nodata: "Sin datos" };

export function CargosTable({ rows }: { rows: PositionRow[] }) {
  if (rows.length === 0) return <div className="empty">No hay cargos en este modo de análisis.</div>;
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
      <table>
        <thead>
          <tr><th>Cargo y sede</th><th className="num">Ocupantes</th><th className="num">Horas/sem</th><th className="num">Capacidad</th><th>% de capacidad</th><th>Lectura</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.dataKind}|${p.area}|${p.site}|${p.position}`}>
              <td><b>{p.position}</b><div className="muted">{p.area} · {p.site} · {p.dataKind === "real" ? "REAL" : "DEMO"}</div></td>
              <td className="num">{fmt(p.occupants, 0)}</td>
              <td className="num">{p.hours > 0 ? fmt(p.hours) : "—"}</td>
              <td className="num">{p.capacity > 0 ? fmt(p.capacity) : "—"}</td>
              <td>
                {p.pct === null ? "—" : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div className="bar" style={{ flex: 1 }}><span style={{ width: `${Math.min(100, p.pct * 100)}%`, background: BAR[p.level] }} /></div>
                    <b>{fmtPct(p.pct)}</b>
                  </div>
                )}
              </td>
              <td><span className={`pill ${p.level}`}>{LABEL[p.level]}</span><span className="muted">{p.reading}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
