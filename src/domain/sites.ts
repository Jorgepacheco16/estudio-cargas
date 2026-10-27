/** Hoja 2b del Excel: comparador de un mismo cargo entre sedes. Función pura sobre la consolidación por cargo y sede (hoja 4b). */
import { norm } from "./engine";
import type { Analysis, Mode } from "./summary";

/** (máx − mín) ÷ promedio de las horas por ocupante; por encima de este valor la lectura pide verificar (regla del Excel, hoja 2b celda F25). */
export const SITE_DISPERSION_LIMIT = 0.3;

export interface SiteRow { site: string; kind: string; occupants: number; weeklyHours: number | null; capacity: number; hours: number; pct: number | null; perOccupant: number | null; activities: number; undocumented: number | null; reading: string }
export interface SiteComparison {
  rows: SiteRow[];
  average: number | null; min: number | null; max: number | null; dispersion: number | null;
  reading: string;
}

/** Texto de la lectura: idéntico a la fórmula de la celda F25 del libro. */
export function readSites(count: number, dispersion: number | null): string {
  if (count === 0) return "Sin datos para el cargo y el modo seleccionados. Registre el cargo en la hoja 2 y sus actividades en la hoja 3.";
  if (count < 2) return "El cargo está registrado en un solo centro de operaciones: no hay base de comparación.";
  if ((dispersion ?? 0) > SITE_DISPERSION_LIMIT) return "Diferencia relevante entre centros de operaciones: verifique si refleja una operación distinta, un método distinto o diferencias en el levantamiento (fuente y confianza).";
  return "La carga por ocupante es similar entre centros de operaciones.";
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compara un cargo entre sedes. `undocumented` (opcional) trae, por sede, las actividades «No» o «Parcialmente» documentadas formalmente.
 * Con modo «all» entran REAL y DEMO (en el Excel, el criterio «*»).
 */
export function compareSites(a: Analysis, area: string, position: string, mode: Mode, reservePct: number, undocumented?: Map<string, number>): SiteComparison {
  const rows: SiteRow[] = a.positions
    .filter((p) => norm(p.area) === norm(area) && norm(p.position) === norm(position) && (mode === "all" || p.dataKind === mode))
    .map((p) => ({
      site: p.site, kind: p.dataKind, occupants: p.occupants, capacity: p.capacity, hours: p.hours, pct: p.pct, activities: p.activities, reading: p.reading,
      weeklyHours: p.occupants > 0 && reservePct < 1 ? p.capacity / (p.occupants * (1 - reservePct)) : null,
      perOccupant: p.occupants > 0 ? p.hours / p.occupants : null,
      undocumented: undocumented ? undocumented.get([p.dataKind, norm(p.area), norm(p.site), norm(p.position)].join("|")) ?? 0 : null,
    }))
    .sort((x, y) => x.site.localeCompare(y.site, "es"));
  const per = rows.map((r) => r.perOccupant).filter((x): x is number => x !== null);
  const average = per.length ? avg(per) : null, min = per.length ? Math.min(...per) : null, max = per.length ? Math.max(...per) : null;
  const dispersion = per.length >= 2 && average !== null && average !== 0 ? (max! - min!) / average : null;
  return { rows, average, min, max, dispersion, reading: readSites(per.length, dispersion) };
}

/** Pares (área, cargo) disponibles para elegir, con la cantidad de sedes en que aparece. */
export function comparablePositions(a: Analysis, mode: Mode): { area: string; position: string; sites: number }[] {
  const g = new Map<string, { area: string; position: string; sites: Set<string> }>();
  for (const p of a.positions) {
    if (mode !== "all" && p.dataKind !== mode) continue;
    const k = `${norm(p.area)}|${norm(p.position)}`;
    const e = g.get(k) ?? { area: p.area, position: p.position, sites: new Set<string>() };
    e.sites.add(norm(p.site)); g.set(k, e);
  }
  return [...g.values()].map((e) => ({ area: e.area, position: e.position, sites: e.sites.size })).sort((x, y) => y.sites - x.sites || x.area.localeCompare(y.area, "es") || x.position.localeCompare(y.position, "es"));
}
