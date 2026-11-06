import type { StaffingArea } from "@/domain/staffing";
import type { PositionFact, WeekFact } from "@/domain/report";
import { LEVEL_ES } from "@/domain/report";
import { peopleByAreaChart, truncate, useByPositionChart, weeksChart } from "@/domain/report-charts";

/**
 * Gráficas del informe de resultados (D-105): SVG dibujado en el servidor con las posiciones de report-charts.ts. Los colores salen del tema (claro u oscuro) y cada gráfica trae su
 * descripción para lectores de pantalla; la página ofrece además los mismos datos en una tabla. Nada de esto calcula cifras: solo dibuja las que ya calculó la aplicación.
 */
const num = (n: number, d = 0) => n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const FONT = { fontFamily: "inherit" } as const;

export function PeopleByAreaChart({ areas }: { areas: StaffingArea[] }) {
  const c = peopleByAreaChart(areas.map((a) => ({ label: a.area, hay: a.occupants, necesarias: a.required })));
  const wide = c.width > 520;
  const desc = areas.length === 0 ? "Sin áreas con cifra." : areas.map((a) => `${a.area}: hay ${a.occupants} y se necesitan ${a.required}`).join(". ") + ".";
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${c.width} ${c.height}`} role="img" aria-label={`Personas que hay y necesarias por área. ${desc}`} style={{ display: "block", width: "100%", minWidth: wide ? c.width : undefined, maxWidth: wide ? undefined : 560, height: "auto", ...FONT }}>
        {c.ticks.map((t) => (
          <g key={t.value}>
            <line x1={c.left} x2={c.width - 12} y1={t.y} y2={t.y} stroke={t.value === 0 ? "var(--muted)" : "var(--line)"} strokeWidth={1} />
            <text x={c.left - 8} y={t.y + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{num(t.value)}</text>
          </g>
        ))}
        {c.groups.map((g) => (
          <g key={g.label}>
            {g.bars.map((b) => (
              <g key={b.series}>
                <rect x={b.x} y={b.y} width={b.w} height={Math.max(0, b.h)} fill={b.series === "hay" ? "var(--series-a)" : "var(--blue)"} />
                <text x={b.x + b.w / 2} y={b.y - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">{num(b.value)}</text>
              </g>
            ))}
            <text x={g.cx} y={c.baseline + 20} textAnchor="middle" fontSize={12} fill="var(--ink)"><title>{g.label}</title>{truncate(g.label, 14)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const BAR_COLOR = { overload: "var(--red)", low: "var(--amber)", ok: "var(--blue)", nodata: "var(--muted)" } as const;
export function UseByPositionChart({ positions, overload }: { positions: PositionFact[]; overload: number }) {
  const rows = positions.filter((p) => p.usePct !== null).map((p) => ({ label: p.position, pct: p.usePct as number, level: p.level }));
  const c = useByPositionChart(rows, overload);
  const desc = c.rows.length === 0 ? "Sin cargos con cifra." : c.rows.map((r) => `${r.label}: ${num(r.pct * 100)} por ciento, ${LEVEL_ES[r.level].toLowerCase()}`).join(". ") + `. El umbral de sobrecarga es ${num(c.thresholdPct)} por ciento.`;
  return (
    <svg viewBox={`0 0 ${c.width} ${c.height}`} role="img" aria-label={`Uso de la capacidad actual por cargo. ${desc}`} style={{ display: "block", width: "100%", maxWidth: 560, height: "auto", ...FONT }}>
      <line x1={c.plotLeft} x2={c.plotLeft} y1={c.top - 8} y2={c.bottom} stroke="var(--muted)" strokeWidth={1} />
      <line x1={c.x100} x2={c.x100} y1={c.top - 8} y2={c.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 3" />
      {c.thresholdPct !== 100 && <line x1={c.xThreshold} x2={c.xThreshold} y1={c.top - 8} y2={c.bottom} stroke="var(--red)" strokeWidth={1.5} strokeDasharray="4 3" />}
      <text x={c.x100 - 3} y={c.top - 14} textAnchor="end" fontSize={11} fill="var(--muted)">capacidad 100 %</text>
      {c.thresholdPct !== 100 && <text x={c.xThreshold + 3} y={c.top - 14} fontSize={11} fontWeight={600} fill="var(--red-dark)">umbral {num(c.thresholdPct)} %</text>}
      {c.ticks.map((t) => <text key={t.pct} x={t.x} y={c.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--muted)">{num(t.pct)} %</text>)}
      {c.rows.map((r) => (
        <g key={r.label}>
          <text x={c.plotLeft - 8} y={r.labelY - 2} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--ink)"><title>{r.label}</title>{r.short}</text>
          <text x={c.plotLeft - 8} y={r.labelY + 12} textAnchor="end" fontSize={11} fontWeight={r.level === "overload" ? 700 : 400} fill={r.level === "overload" ? "var(--red-dark)" : "var(--muted)"}>{LEVEL_ES[r.level]}</text>
          <rect x={c.plotLeft} y={r.y} width={Math.max(1, r.w)} height={22} fill={BAR_COLOR[r.level]} />
          <text x={c.plotLeft + r.w + 6} y={r.labelY + 4} fontSize={12} fontWeight={700} fill="var(--ink)">{num(r.pct * 100)} %</text>
        </g>
      ))}
    </svg>
  );
}

export function WeeksChartView({ common, periodic, overload }: { common: WeekFact | null; periodic: WeekFact | null; overload: number }) {
  const c = weeksChart(common, periodic, overload);
  const desc = c.bars.length === 0 ? "Sin reparto: faltan turnos o datos." : c.bars.map((b) => `${b.label}: ${num(b.hours)} horas, ${num(b.utilization * 100)} por ciento de la capacidad`).join(". ") + `. La capacidad es ${num(c.capacityHours)} horas y el umbral ${num(c.thresholdHours)} horas.`;
  if (c.bars.length === 0) return <p className="note" style={{ margin: 0 }}>{desc}</p>;
  return (
    <svg viewBox={`0 0 ${c.width} ${c.height}`} role="img" aria-label={`Trabajo de la semana común y con periódicas. ${desc}`} style={{ display: "block", width: "100%", maxWidth: 560, height: "auto", ...FONT }}>
      <line x1={c.plotLeft} x2={c.plotLeft} y1={c.top - 8} y2={c.bottom} stroke="var(--muted)" strokeWidth={1} />
      {c.xCapacity !== null && <line x1={c.xCapacity} x2={c.xCapacity} y1={c.top - 8} y2={c.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 3" />}
      {c.xThreshold !== null && overload > 1 && <line x1={c.xThreshold} x2={c.xThreshold} y1={c.top - 8} y2={c.bottom} stroke="var(--red)" strokeWidth={1.5} strokeDasharray="4 3" />}
      {c.xCapacity !== null && <text x={c.xCapacity - 3} y={c.top - 14} textAnchor="end" fontSize={11} fill="var(--muted)">capacidad {num(c.capacityHours)} h</text>}
      {c.xThreshold !== null && overload > 1 && <text x={c.xThreshold + 3} y={c.bottom + 30} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--red-dark)">umbral {num(overload * 100)} %: {num(c.thresholdHours)} h</text>}
      {c.ticks.map((t) => <text key={t.value} x={t.x} y={c.bottom + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{num(t.value)}</text>)}
      {c.bars.map((b) => (
        <g key={b.id}>
          <text x={c.plotLeft - 8} y={b.y + 20} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--ink)">{b.label}</text>
          <rect x={c.plotLeft} y={b.y} width={Math.max(1, b.w)} height={30} fill="var(--blue)" />
          <text x={c.plotLeft + 8} y={b.y + 20} fontSize={12} fontWeight={700} fill="var(--card)">{num(b.hours)} h · {num(b.utilization * 100)} %</text>
        </g>
      ))}
    </svg>
  );
}
