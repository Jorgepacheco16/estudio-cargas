/**
 * Cifras del informe de resultados (D-105, parte C1). Funciones puras, sin IA: reúnen lo que ya calculan Dotación requerida (staffing.ts) y Reparto semanal (schedule.ts) en un solo
 * conjunto de cifras para el tablero, las descargas y, más adelante, el texto que redacte el agente. Aquí NO se calcula nada nuevo: solo se suma y se ordena lo existente, de modo
 * que el informe nunca pueda contradecir a las otras dos secciones.
 */
import { areasOf, needsOf, summaryOf, type NeedState, type StaffingArea, type StaffingSummary } from "./staffing";
import type { PositionSchedule, WeekPlan } from "./schedule";
import type { AlertLevel, PositionRow } from "./summary";

export interface WeekFact {
  /** Cargos con reparto que suman esta semana. */ positions: number;
  /** Personas del reparto (las de Dotación requerida de esos cargos). */ people: number;
  /** Horas de trabajo repartidas más imprevistos. */ workHours: number;
  /** Capacidad útil de esas personas. */ capacityHours: number;
  /** workHours ÷ capacityHours. */ utilization: number;
  /** Disponibilidad sin tareas. */ freeHours: number;
  /** Personas más que harían falta para no pasar el umbral de sobrecarga (refuerzo). */ extraPeople: number;
}
export interface PositionFact {
  dataKind: string; area: string; site: string; position: string;
  occupants: number; exact: number; required: number; gap: number; state: NeedState;
  /** Carga ÷ capacidad de las personas que hay hoy (null si no se puede calcular). */ usePct: number | null;
  level: AlertLevel; partial: boolean;
}
export interface DataQuality {
  activities: number; complete: number; incomplete: number; completePct: number | null;
  positions: number; positionsWithFigure: number; positionsWithoutFigure: number; positionsPartial: number; positionsWithoutShifts: number;
}
export interface ReportFacts {
  overload: number; reservePct: number; scenario: string;
  totals: StaffingSummary;
  /** Horas por semana de actividades no planificadas u ocasionales (imprevistos) de los cargos con cifra, ya incluidas en las horas de los cargos (D-112). */ unplannedHours: number;
  areas: StaffingArea[];
  positions: PositionFact[];
  weeks: { common: WeekFact | null; periodic: WeekFact | null };
  data: DataQuality;
}
export interface ReportInput {
  positions: PositionRow[]; schedules: PositionSchedule[];
  kpis: { activities: number; complete: number };
  /** «Umbral de sobrecarga» de Parámetros como razón (1,05 = 105 %). */ overload: number;
  reservePct: number; scenario: string;
  /** «Fracción desde la cual se suma una persona» de Parámetros (D-108); ausente = 0 (siempre hacia arriba). */ roundFrom?: number;
}

export const SCENARIO_ES: Record<string, string> = { base: "base", high_season: "temporada alta", low_season: "temporada baja", min_time: "tiempo mínimo", max_time: "tiempo máximo" };
export const LEVEL_ES: Record<AlertLevel, string> = { overload: "Sobrecarga", low: "Carga baja", ok: "En rango", nodata: "Sin datos" };

/** Suma una semana del reparto en todos los cargos que tienen reparto. null si ninguno lo tiene. */
export function weekFact(schedules: readonly PositionSchedule[], pick: (s: PositionSchedule) => WeekPlan | null): WeekFact | null {
  const plans = schedules.filter((s) => s.state === "ok").map(pick).filter((w): w is WeekPlan => w !== null);
  if (plans.length === 0) return null;
  const work = plans.reduce((t, w) => t + w.assignedHours + w.reserveHours, 0), capacity = plans.reduce((t, w) => t + w.capacityHours, 0);
  return {
    positions: plans.length, people: plans.reduce((t, w) => t + w.people, 0), workHours: work, capacityHours: capacity,
    utilization: capacity > 0 ? work / capacity : 0, freeHours: plans.reduce((t, w) => t + w.freeHours, 0), extraPeople: plans.reduce((t, w) => t + w.extraPeople, 0),
  };
}

export function buildReportFacts(i: ReportInput): ReportFacts {
  const needs = needsOf(i.positions, i.overload, i.roundFrom ?? 0), byKey = new Map(i.positions.map((p) => [`${p.dataKind}|${p.area}|${p.site}|${p.position}`, p]));
  const positions: PositionFact[] = needs.flatMap((n) => {
    if (n.required === null || n.exact === null || n.gap === null) return [];
    const p = byKey.get(`${n.dataKind}|${n.area}|${n.site}|${n.position}`)!;
    return [{ dataKind: n.dataKind, area: n.area, site: n.site, position: n.position, occupants: n.occupants, exact: n.exact, required: n.required, gap: n.gap, state: n.state, usePct: p.pct, level: p.level, partial: n.partial }];
  }).sort((a, b) => (b.usePct ?? -1) - (a.usePct ?? -1) || a.position.localeCompare(b.position, "es"));
  const totals = summaryOf(needs);
  return {
    overload: i.overload, reservePct: i.reservePct, scenario: i.scenario, totals, unplannedHours: i.schedules.filter((s) => s.required !== null).reduce((t, s) => t + s.reserveHours, 0), areas: areasOf(needs), positions,
    weeks: { common: weekFact(i.schedules, (s) => s.common), periodic: weekFact(i.schedules, (s) => s.periodic) },
    data: {
      activities: i.kpis.activities, complete: i.kpis.complete, incomplete: i.kpis.activities - i.kpis.complete,
      completePct: i.kpis.activities > 0 ? i.kpis.complete / i.kpis.activities : null,
      positions: needs.length, positionsWithFigure: totals.positions - totals.withoutData, positionsWithoutFigure: totals.withoutData,
      positionsPartial: needs.filter((n) => n.required !== null && n.partial).length,
      positionsWithoutShifts: i.schedules.filter((s) => s.state === "noshifts").length,
    },
  };
}
