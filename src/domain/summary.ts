/** Consolidaciones por actividad, cargo-sede y área (hojas 4a/4b del Excel). Funciones puras. */
import { computeActivity, occupantsOf, personDaysOf, capacityOf, norm, STATUS_ES, type PeriodKey, type ActivityInput, type ActivityResult, type Params, type StaffingInput } from "./engine";

export interface Thresholds { high: number; low: number }
export type Mode = "real" | "demo" | "all";
export type AlertLevel = "overload" | "low" | "ok" | "nodata";

export interface ActivityRow { code: string; dataKind: string; area: string; site: string; position: string; secondaryPosition: string | null; secondaryArea?: string | null; secondarySite?: string | null; status: string; complete: boolean; hoursWeek: number | null; hoursMonth: number | null; result: ActivityResult; risk?: ActivityRisk;
  /** Datos de captura que la exportación de Actividades muestra tal como se registraron. */
  capture?: { executions: number | null; period: PeriodKey | null; timeAvgMin: number | null } }
/** Resultado de la hoja 7 de una actividad (solo existe si tiene riesgo evaluado). */
export interface ActivityRisk { criticality: string; concentration: string; backup: string }
export interface PositionRow {
  dataKind: string; area: string; site: string; position: string; occupants: number; capacity: number; hours: number; pct: number | null;
  activities: number; complete: number; reading: string; level: AlertLevel;
}
export interface AreaRow { area: string; activities: number; complete: number; hours: number; capacity: number; pct: number | null }
export interface Analysis { activities: ActivityRow[]; positions: PositionRow[]; areas: AreaRow[]; kpis: { activities: number; complete: number; hours: number; capacity: number; pct: number | null; alerts: number; overload: number; low: number } }

const key = (k: string, a: string, s: string, p: string) => [k, norm(a), norm(s), norm(p)].join("|");

/** Texto idéntico al de la fórmula de la hoja 4b (columna "Lectura"). */
export function readPosition(p: { activities: number; complete: number; hours: number; capacity: number; pct: number | null }, th: Thresholds): { reading: string; level: AlertLevel } {
  let base: string; let level: AlertLevel;
  if (p.activities === 0 && p.hours === 0) { base = "Sin información registrada"; level = "nodata"; } // un cargo que solo recibe horas como «cargo que asume el resto» sí tiene información
  else if (p.capacity === 0) { base = "Falta registrar cantidad y jornada (hoja 2)"; level = "nodata"; }
  else if (p.hours === 0) { base = "Hay actividades pero ninguna con datos completos"; level = "nodata"; }
  else if ((p.pct ?? 0) > th.high) { base = "ALERTA: carga superior a la capacidad. Revise datos, solapamientos, horas extra y distribución"; level = "overload"; }
  else if ((p.pct ?? 0) < th.low) { base = "VALIDAR: carga baja. Verifique que el inventario esté completo; no implica personal sobrante"; level = "low"; }
  else { base = "Dentro del rango"; level = "ok"; }
  return { reading: base + (p.activities > p.complete ? " · Hay actividades con datos incompletos" : ""), level };
}

export function analyze(staffAll: StaffingInput[], actsAll: ActivityInput[], prm: Params, th: Thresholds, mode: Mode): Analysis {
  const keep = (k: string) => mode === "all" || k === mode;
  const staff = staffAll.filter((s) => keep(s.dataKind));
  const acts = actsAll.filter((a) => keep(a.dataKind));
  const results = acts.map((a) => computeActivity(a, prm, occupantsOf(staff, a), personDaysOf(staff, a, prm)));
  const activities: ActivityRow[] = acts.map((a, i) => ({
    code: a.code, dataKind: a.dataKind, area: a.area, site: a.site, position: a.position, secondaryPosition: a.secondaryPosition ?? null, secondaryArea: a.secondaryArea ?? null, secondarySite: a.secondarySite ?? null, status: STATUS_ES[results[i].status], complete: results[i].status === "OK",
    hoursWeek: results[i].hTotal ?? null, hoursMonth: results[i].hMonth ?? null, result: results[i],
    capture: { executions: a.executions, period: a.period, timeAvgMin: a.timeAvgMin },
  }));

  const keys = new Map<string, { dataKind: string; area: string; site: string; position: string }>();
  for (const s of staff) keys.set(key(s.dataKind, s.area, s.site, s.position), s);
  for (const a of acts) {
    if (!keys.has(key(a.dataKind, a.area, a.site, a.position))) keys.set(key(a.dataKind, a.area, a.site, a.position), a);
    // El cargo que asume el resto de la carga también aparece (D-08: sin dotación se muestra «Falta registrar cantidad y jornada»).
    if (a.secondaryPosition) {
      const [sa, ss] = [a.secondaryArea ?? a.area, a.secondarySite ?? a.site];
      if (!keys.has(key(a.dataKind, sa, ss, a.secondaryPosition))) keys.set(key(a.dataKind, sa, ss, a.secondaryPosition), { dataKind: a.dataKind, area: sa, site: ss, position: a.secondaryPosition });
    }
  }

  const positions: PositionRow[] = [...keys.entries()].map(([k, p]) => {
    const entries = staff.filter((s) => key(s.dataKind, s.area, s.site, s.position) === k);
    const occupants = entries.reduce((x, e) => x + (e.headcount ?? 0), 0);
    const capacity = capacityOf(entries, prm.reservePct);
    let hours = 0, count = 0, complete = 0;
    acts.forEach((a, i) => {
      const r = results[i];
      if (key(a.dataKind, a.area, a.site, a.position) === k) { count++; if (r.status === "OK") { complete++; hours += r.hPrimary!; } }
      if (r.status === "OK" && a.secondaryPosition && key(a.dataKind, a.secondaryArea ?? a.area, a.secondarySite ?? a.site, a.secondaryPosition) === k) hours += r.hSecondary!;
    });
    const pct = capacity > 0 && hours > 0 ? hours / capacity : null;
    const { reading, level } = readPosition({ activities: count, complete, hours, capacity, pct }, th);
    return { dataKind: p.dataKind, area: p.area, site: p.site, position: p.position, occupants, capacity, hours, pct, activities: count, complete, reading, level };
  }).sort((a, b) => a.area.localeCompare(b.area, "es") || a.site.localeCompare(b.site, "es") || a.position.localeCompare(b.position, "es"));

  /* Área (hoja 4b, tabla 1): horas = Σ horas TOTALES de sus actividades completas; capacidad = Σ capacidad de su dotación. */
  const areaMap = new Map<string, AreaRow>();
  const areaRow = (name: string) => { const k = norm(name); let r = areaMap.get(k); if (!r) { r = { area: name, activities: 0, complete: 0, hours: 0, capacity: 0, pct: null }; areaMap.set(k, r); } return r; };
  acts.forEach((a, i) => { const r = areaRow(a.area); r.activities++; if (results[i].status === "OK") { r.complete++; r.hours += results[i].hTotal!; } });
  for (const s of staff) areaRow(s.area).capacity += capacityOf([s], prm.reservePct);
  const areas = [...areaMap.values()].map((r) => ({ ...r, pct: r.capacity > 0 && r.hours > 0 ? r.hours / r.capacity : null })).sort((a, b) => b.hours - a.hours);

  const hours = areas.reduce((x, r) => x + r.hours, 0), capacity = areas.reduce((x, r) => x + r.capacity, 0);
  const overload = positions.filter((p) => p.level === "overload").length, low = positions.filter((p) => p.level === "low").length;
  return { activities, positions, areas, kpis: { activities: activities.length, complete: activities.filter((a) => a.complete).length, hours, capacity, pct: capacity > 0 && hours > 0 ? hours / capacity : null, alerts: overload + low, overload, low } };
}
