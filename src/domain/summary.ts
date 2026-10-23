/** Consolidaciones por actividad, cargo-sede y área (hojas 4a/4b del Excel). Funciones puras. */
import { computeActivity, occupantsOf, capacityOf, norm, STATUS_ES, type ActivityInput, type ActivityResult, type Params, type StaffingInput } from "./engine";

export interface Thresholds { high: number; low: number }
export type Mode = "real" | "demo" | "all";
export type AlertLevel = "overload" | "low" | "ok" | "nodata";

export interface ActivityRow { code: string; dataKind: string; area: string; site: string; position: string; status: string; complete: boolean; hoursWeek: number | null; hoursMonth: number | null; result: ActivityResult }
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
  if (p.activities === 0) { base = "Sin información registrada"; level = "nodata"; }
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
  const results = acts.map((a) => computeActivity(a, prm, occupantsOf(staff, a)));
  const activities: ActivityRow[] = acts.map((a, i) => ({
    code: a.code, dataKind: a.dataKind, area: a.area, site: a.site, position: a.position, status: STATUS_ES[results[i].status], complete: results[i].status === "OK",
    hoursWeek: results[i].hTotal ?? null, hoursMonth: results[i].hMonth ?? null, result: results[i],
  }));

  const keys = new Map<string, { dataKind: string; area: string; site: string; position: string }>();
  for (const s of staff) keys.set(key(s.dataKind, s.area, s.site, s.position), s);
  for (const a of acts) if (!keys.has(key(a.dataKind, a.area, a.site, a.position))) keys.set(key(a.dataKind, a.area, a.site, a.position), a);

  const positions: PositionRow[] = [...keys.entries()].map(([k, p]) => {
    const entries = staff.filter((s) => key(s.dataKind, s.area, s.site, s.position) === k);
    const occupants = entries.reduce((x, e) => x + (e.headcount ?? 0), 0);
    const capacity = capacityOf(entries, prm.reservePct);
    let hours = 0, count = 0, complete = 0;
    acts.forEach((a, i) => {
      const r = results[i];
      if (key(a.dataKind, a.area, a.site, a.position) === k) { count++; if (r.status === "OK") { complete++; hours += r.hPrimary!; } }
      if (r.status === "OK" && a.secondaryPosition && key(a.dataKind, a.area, a.site, a.secondaryPosition) === k) hours += r.hSecondary!;
    });
    const pct = capacity > 0 && hours > 0 ? hours / capacity : null;
    const { reading, level } = readPosition({ activities: count, complete, hours, capacity, pct }, th);
    return { dataKind: p.dataKind, area: p.area, site: p.site, position: p.position, occupants, capacity, hours, pct, activities: count, complete, reading, level };
  }).sort((a, b) => a.area.localeCompare(b.area, "es") || a.site.localeCompare(b.site, "es") || a.position.localeCompare(b.position, "es"));

  const areaMap = new Map<string, AreaRow>();
  for (const p of positions) {
    const r = areaMap.get(p.area) ?? { area: p.area, activities: 0, complete: 0, hours: 0, capacity: 0, pct: null };
    r.activities += p.activities; r.complete += p.complete; r.hours += p.hours; r.capacity += p.capacity; areaMap.set(p.area, r);
  }
  const areas = [...areaMap.values()].map((r) => ({ ...r, pct: r.capacity > 0 && r.hours > 0 ? r.hours / r.capacity : null })).sort((a, b) => b.hours - a.hours);

  const hours = positions.reduce((x, p) => x + p.hours, 0), capacity = positions.reduce((x, p) => x + p.capacity, 0);
  const overload = positions.filter((p) => p.level === "overload").length, low = positions.filter((p) => p.level === "low").length;
  return { activities, positions, areas, kpis: { activities: activities.length, complete: activities.filter((a) => a.complete).length, hours, capacity, pct: capacity > 0 && hours > 0 ? hours / capacity : null, alerts: overload + low, overload, low } };
}
