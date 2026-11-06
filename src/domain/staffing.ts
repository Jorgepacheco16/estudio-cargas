/**
 * Dotación requerida (D-99): cuántas personas necesita cada cargo para la carga calculada y cuál es la brecha frente a las que hay. Funciones puras; no inventan datos:
 * un cargo sin cantidad y jornada, o sin horas calculadas, queda «sin datos» y no recibe cifra.
 *
 *   personas necesarias (exactas) = horas de la semana ÷ horas útiles de UNA persona, donde horas útiles = jornada semanal × (1 − reserva de capacidad)
 *   personas necesarias = las exactas redondeadas hacia arriba (no existe media persona), con un margen de 1e-9 para que un resultado exacto de 3 no pase a 4
 *   brecha = personas necesarias − personas que hay (positiva: faltan; negativa: hay de más)
 *
 * Mismas horas y misma capacidad que la pantalla de Cargos: personas necesarias exactas = ocupantes × % de capacidad cuando todas las filas de dotación tienen jornada.
 */
import type { PositionRow } from "./summary";

export type NeedState = "short" | "balanced" | "surplus" | "nodata";
export interface StaffingNeed {
  dataKind: string; area: string; site: string; position: string;
  occupants: number; hours: number; hoursPerPerson: number | null;
  /** Personas necesarias sin redondear (equivalentes a tiempo completo); null si no se puede calcular. */
  exact: number | null;
  /** Personas necesarias, redondeadas hacia arriba. */
  required: number | null;
  /** required − occupants. */
  gap: number | null;
  state: NeedState;
  /** Hay actividades del cargo con datos incompletos: la cifra es un mínimo, no el total. */
  partial: boolean;
  reading: string;
}
export interface StaffingArea { area: string; occupants: number; exact: number; required: number; gap: number; positions: number; withoutData: number }
export interface StaffingSummary { occupants: number; exact: number; required: number; gap: number; positions: number; withoutData: number }

const EPS = 1e-9;
export const roundUpPeople = (exact: number): number => Math.max(0, Math.ceil(exact - EPS));

export const STATE_ES: Record<NeedState, string> = { short: "Faltan personas", balanced: "Dotación ajustada", surplus: "Posible excedente", nodata: "Sin datos" };

export function needOf(p: PositionRow): StaffingNeed {
  const base = { dataKind: p.dataKind, area: p.area, site: p.site, position: p.position, occupants: p.occupants, hours: p.hours, hoursPerPerson: p.hoursPerPerson };
  const partial = p.activities > p.complete;
  if (p.activities === 0 && p.hours === 0) return { ...base, exact: null, required: null, gap: null, state: "nodata", partial, reading: "Sin actividades registradas" };
  if (p.hoursPerPerson === null || p.hoursPerPerson <= 0) return { ...base, exact: null, required: null, gap: null, state: "nodata", partial, reading: "Falta registrar cantidad y jornada del cargo (Cargos y dotación)" };
  if (p.hours <= 0) return { ...base, exact: null, required: null, gap: null, state: "nodata", partial, reading: "Hay actividades pero ninguna con datos completos" };
  const exact = p.hours / p.hoursPerPerson, required = roundUpPeople(exact), gap = required - p.occupants;
  const state: NeedState = gap > 0 ? "short" : gap < 0 ? "surplus" : "balanced";
  const say = state === "short" ? `Faltan ${gap} ${gap === 1 ? "persona" : "personas"}` : state === "surplus" ? `Hay ${-gap} ${-gap === 1 ? "persona" : "personas"} de más según la carga registrada: valide que el inventario esté completo antes de decidir` : "La dotación coincide con la carga registrada";
  return { ...base, exact, required, gap, state, partial, reading: say + (partial ? " · Cifra mínima: hay actividades con datos incompletos" : "") };
}

export const needsOf = (positions: PositionRow[]): StaffingNeed[] => positions.map(needOf);

/** Totales por área; solo suman los cargos con cifra. `withoutData` cuenta los que no la tienen. */
export function areasOf(needs: StaffingNeed[]): StaffingArea[] {
  const m = new Map<string, StaffingArea>();
  for (const n of needs) {
    const k = n.area.trim().toLowerCase();
    const r = m.get(k) ?? { area: n.area, occupants: 0, exact: 0, required: 0, gap: 0, positions: 0, withoutData: 0 };
    r.positions++;
    if (n.required === null) r.withoutData++; else { r.occupants += n.occupants; r.exact += n.exact!; r.required += n.required; r.gap += n.gap!; }
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.area.localeCompare(b.area, "es"));
}

export function summaryOf(needs: StaffingNeed[]): StaffingSummary {
  const t: StaffingSummary = { occupants: 0, exact: 0, required: 0, gap: 0, positions: needs.length, withoutData: 0 };
  for (const n of needs) { if (n.required === null) t.withoutData++; else { t.occupants += n.occupants; t.exact += n.exact!; t.required += n.required; t.gap += n.gap!; } }
  return t;
}
