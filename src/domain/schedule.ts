/**
 * Reparto semanal de las actividades entre las personas necesarias (D-101, parte B del informe de resultados). Funciones puras, deterministas y sin base de datos.
 *
 * Qué entrega, por cada cargo con turnos: una «semana común» (actividades diarias y semanales) y una «semana con actividades periódicas» (la común más las quincenales, mensuales,
 * trimestrales y anuales, suponiendo el peor caso: todas coinciden en esa semana). Cada una es una tabla persona × día con los minutos de cada actividad. Las personas son
 * «Persona 1, 2…»: nunca nombres (regla 6). Los tiempos y las frecuencias salen del motor real (computeActivity); aquí solo se reparten.
 *
 * Reglas de reparto por TIPO de actividad (confirmadas por el titular, 6 nov 2026):
 *   Operativa, Servicio          → se parte libremente: las ejecuciones van a distintas personas y, si la actividad es por unidad, también se reparten las unidades.
 *   Administrativa, Control, Apoyo → cada ejecución la hace una sola persona; las ejecuciones se reparten entre personas.
 *   Coordinación                 → una sola persona responsable de todas las ejecuciones.
 *   Ocasional o no planificada   → no se programa: aparece como reserva para imprevistos, repartida por igual.
 * Para todas: lo que hace cada colaborador (alcance «por colaborador») aparece en la semana de cada persona; lo que exige varias personas a la vez se asigna a varias
 * al mismo tiempo; nadie pasa su capacidad diaria ni semanal (si no cabe se sube el número de personas y se dice); los días son los de los turnos del cargo.
 */
import { computeActivity, occupantsOf, personDaysOf, norm, type ActivityInput, type Params, type StaffingInput } from "./engine";
import { needOf } from "./staffing";
import type { PositionRow } from "./summary";

export const ACTIVITY_TYPES = ["operational", "administrative", "control", "coordination", "service", "support", "occasional"] as const;
export type ActivityTypeKey = (typeof ACTIVITY_TYPES)[number];
export const TYPE_ES: Record<ActivityTypeKey, string> = { operational: "Operativa", administrative: "Administrativa", control: "Control", coordination: "Coordinación", service: "Servicio", support: "Apoyo", occasional: "Ocasional" };

export type SplitRule = "split" | "by_execution" | "single" | "reserve";
export const RULE_BY_TYPE: Record<ActivityTypeKey, SplitRule> = { operational: "split", service: "split", administrative: "by_execution", control: "by_execution", support: "by_execution", coordination: "single", occasional: "reserve" };
export const RULE_ES: Record<SplitRule, string> = { split: "Se parte libremente", by_execution: "Una persona por ejecución", single: "Una sola persona responsable", reserve: "Reserva para imprevistos" };
export const isActivityType = (v: unknown): v is ActivityTypeKey => typeof v === "string" && (ACTIVITY_TYPES as readonly string[]).includes(v);

/** Regla de una actividad: la no planificada es reserva sea cual sea su tipo; sin tipo registrado se usa la más prudente (una persona por ejecución). */
export function ruleOf(type: ActivityTypeKey | null, planning: "planned" | "unplanned" | null): SplitRule {
  if (planning === "unplanned") return "reserve";
  return type ? RULE_BY_TYPE[type] : "by_execution";
}

export interface ActivityExtra { name: string; type: ActivityTypeKey | null }
export interface ScheduleInput {
  staff: StaffingInput[]; acts: ActivityInput[]; params: Params; positions: PositionRow[];
  /** Nombre y tipo de cada actividad, por código en minúsculas. */
  extras: Map<string, ActivityExtra>;
  /** Días (0 = lunes … 6 = domingo) en que alguno de los turnos del cargo trabaja, por clave de cargo (ver positionKey). */
  shiftDays: Map<string, number[]>;
}

export type WeekKind = "common" | "periodic";
export const WEEK_ES: Record<WeekKind, string> = { common: "Semana común", periodic: "Semana con actividades periódicas" };
export interface CellItem { code: string; minutes: number }
export interface Cell { items: CellItem[]; reserveMin: number; totalMin: number; capacityMin: number }
export interface ActivitySummary {
  code: string; name: string; type: ActivityTypeKey | null; rule: SplitRule;
  /** Personas (1, 2…) que la ejecutan esa semana. */ persons: number[];
  /** Ejecuciones de la semana: por cada persona si es «por colaborador»; del cargo en los demás casos. */ executions: number;
  /** Minutos de una ejecución por persona (si exige varias a la vez, lo que le toca a cada una). */ minutesPerExecution: number;
  /** Minutos de la semana sumando a todas las personas. */ weekMinutes: number;
  perEmployee: boolean; simultaneous: number;
}
export interface WeekPlan {
  kind: WeekKind; people: number;
  /** grid[persona][día] con los días de PositionSchedule.days. */ grid: Cell[][];
  activities: ActivitySummary[];
  reserveHours: number; assignedHours: number; capacityHours: number;
  /** Horas que no cupieron (con el número de personas mostrado): debe ser 0; si no, el cargo necesita más gente de la calculada. */ overflowHours: number;
}
export type ScheduleState = "ok" | "nodata" | "noshifts";
export interface PositionSchedule {
  key: string; dataKind: string; area: string; site: string; position: string;
  state: ScheduleState; reason: string;
  days: number[]; /** Personas necesarias que da «Dotación requerida». */ required: number | null;
  common: WeekPlan | null; periodic: WeekPlan | null;
  notes: string[];
}

export const positionKey = (kind: string, area: string, site: string, position: string) => [kind, norm(area), norm(site), norm(position)].join("|");

const EPS = 1e-9, FIT = 1e-6, MAX_EXTRA_PEOPLE = 10;

/** Una ejecución (o fracción de ejecución) por colocar. `hours` = horas de CADA una de las `k` personas que la hacen a la vez. */
interface Occ { code: string; hours: number; k: number; divisible: boolean; day: number | null }
interface Line {
  code: string; name: string; type: ActivityTypeKey | null; rule: SplitRule; perEmployee: boolean; k: number;
  hoursPerExec: number; periodKind: "daily" | "weekly" | "periodic"; executions: number; divisible: boolean; reserveHours: number;
}

function linesOf(input: ScheduleInput, key: string): { lines: Line[]; excluded: number; untyped: number } {
  const { params } = input;
  const lines: Line[] = []; let excluded = 0, untyped = 0;
  for (const a of input.acts) {
    const result = computeActivity(a, params, occupantsOf(input.staff, a), personDaysOf(input.staff, a, params));
    if (result.status !== "OK") { if (positionKey(a.dataKind, a.area, a.site, a.position) === key) excluded++; continue; }
    const share = a.loadShare ?? 1;
    const mine = positionKey(a.dataKind, a.area, a.site, a.position) === key ? share : 0;
    const other = a.secondaryPosition && positionKey(a.dataKind, a.secondaryArea ?? a.area, a.secondarySite ?? a.site, a.secondaryPosition) === key ? 1 - share : 0;
    const f = mine + other; // la actividad compartida entre dos cargos aporta a cada uno su parte
    if (f <= EPS) continue;
    const extra = input.extras.get(a.code.toLowerCase());
    const type = extra?.type ?? null;
    if (!type) untyped++;
    const rule = ruleOf(type, a.planning);
    const k = Math.max(1, a.simultaneous ?? 1);
    const scale = (result.hsBase ?? 0) > EPS ? (result.hsSel ?? 0) / result.hsBase! : 1; // escenario elegido en Parámetros
    const perEmployee = a.scope === "per_employee" && !a.employeeCode && rule !== "reserve";
    // la actividad de un colaborador con código es de esa persona: una sola responsable
    const effRule: SplitRule = a.employeeCode && rule !== "reserve" ? "single" : rule;
    const reserveHours = rule === "reserve" ? (mine > 0 ? result.hPrimary ?? 0 : 0) + (other > 0 ? result.hSecondary ?? 0 : 0) : 0;
    const periodKind = a.period === "day" ? "daily" : a.period === "week" ? "weekly" : "periodic";
    lines.push({
      code: a.code, name: extra?.name ?? a.code, type, rule: effRule, perEmployee, k, hoursPerExec: ((result.hoursPerExec ?? 0) / k) * scale * f, periodKind, executions: a.executions ?? 0,
      divisible: a.calcMode === "per_unit" && effRule === "split", reserveHours,
    });
  }
  return { lines, excluded, untyped };
}

/** Ejecuciones enteras y, si sobra una fracción, una ejecución más corta: así no se pierde ni se inventa ningún minuto. */
function pieces(executions: number): number[] {
  const whole = Math.floor(executions + EPS), frac = executions - whole;
  return [...Array<number>(whole).fill(1), ...(frac > EPS ? [frac] : [])];
}

interface Sim { grid: Cell[][]; overflow: number; assigned: number; reserve: number; summaries: ActivitySummary[] }

/** Un reparto con `n` personas. Voraz y determinista: lo más grande primero, siempre a quien más margen tiene; empates, la persona y el día más bajos. */
function simulate(lines: Line[], kind: WeekKind, n: number, days: number[], cd: number, cw: number): Sim {
  const D = days.length;
  const load = Array.from({ length: n }, () => Array<number>(D).fill(0)), week = Array<number>(n).fill(0);
  const items = Array.from({ length: n }, () => Array.from({ length: D }, () => new Map<string, number>()));
  const reserveCell = Array.from({ length: n }, () => Array<number>(D).fill(0));
  const who = new Map<string, Set<number>>(), execs = new Map<string, number>(), mins = new Map<string, number>();
  let overflow = 0, assigned = 0;
  const rem = (p: number, d: number) => Math.min(cd - load[p][d], cw - week[p]);
  const put = (p: number, d: number, code: string, h: number) => {
    load[p][d] += h; week[p] += h; assigned += h;
    items[p][d].set(code, (items[p][d].get(code) ?? 0) + h * 60);
    (who.get(code) ?? who.set(code, new Set()).get(code)!).add(p + 1);
    mins.set(code, (mins.get(code) ?? 0) + h * 60);
  };

  // 1) reserva para imprevistos: igual para todas las personas y días
  const reserve = lines.reduce((s, l) => s + l.reserveHours, 0);
  if (reserve > EPS && n > 0 && D > 0) for (let p = 0; p < n; p++) for (let d = 0; d < D; d++) { const h = reserve / (n * D); reserveCell[p][d] = h * 60; load[p][d] += h; week[p] += h; }

  // 2) lo que hace cada colaborador: aparece en la semana de cada persona
  const active = lines.filter((l) => l.rule !== "reserve" && (l.periodKind === "periodic" ? kind === "periodic" : true));
  for (const l of active.filter((x) => x.perEmployee)) {
    execs.set(l.code, l.periodKind === "daily" ? l.executions * D : l.executions);
    for (let p = 0; p < n; p++) {
      if (l.periodKind === "daily") { for (let d = 0; d < D; d++) for (const frac of pieces(l.executions)) { const h = l.hoursPerExec * frac; put(p, d, l.code, h); if (rem(p, d) < -FIT) overflow += Math.min(h, -rem(p, d)); } }
      else for (const frac of pieces(l.executions)) {
        const h = l.hoursPerExec * frac;
        let best = 0; for (let d = 1; d < D; d++) if (load[p][d] < load[p][best] - EPS || (Math.abs(load[p][d] - load[p][best]) <= EPS && ((d - p) % D + D) % D < ((best - p) % D + D) % D)) best = d;
        put(p, best, l.code, h); if (rem(p, best) < -FIT) overflow += Math.min(h, -rem(p, best));
      }
    }
  }

  // 3) lo que hace el cargo: se reparte según la regla de su tipo
  const occs: Occ[] = [];
  const owner = new Map<string, number>();
  for (const l of active.filter((x) => !x.perEmployee)) {
    const base = { code: l.code, k: l.k, divisible: l.divisible };
    let count = 0;
    if (l.periodKind === "daily") for (let d = 0; d < D; d++) for (const frac of pieces(l.executions)) { occs.push({ ...base, hours: l.hoursPerExec * frac, day: d }); count += frac; }
    else for (const frac of pieces(l.executions)) { occs.push({ ...base, hours: l.hoursPerExec * frac, day: null }); count += frac; }
    execs.set(l.code, count);
  }
  occs.sort((a, b) => b.hours * b.k - a.hours * a.k || a.code.localeCompare(b.code) || (a.day ?? -1) - (b.day ?? -1));
  const ruleOfCode = new Map(active.map((l) => [l.code, l.rule]));
  const dayTotal = (d: number) => load.reduce((s, col) => s + col[d], 0);

  const place = (o: Occ, d: number): number => { // devuelve las horas que quedan sin colocar en ese día
    const rule = ruleOfCode.get(o.code)!;
    if (rule === "single") {
      let p = owner.get(o.code);
      if (p === undefined) { p = 0; for (let q = 1; q < n; q++) if (week[q] < week[p] - EPS) p = q; owner.set(o.code, p); }
      const fit = Math.min(o.hours, Math.max(0, rem(p, d)));
      if (o.hours - fit > FIT) return o.hours; // no cabe entera ese día
      put(p, d, o.code, o.hours); return 0;
    }
    if (o.k > 1) { // varias personas a la vez: las k con más margen, todas deben poder
      const order = [...Array(n).keys()].sort((a, b) => rem(b, d) - rem(a, d) || a - b).slice(0, o.k);
      if (order.length < o.k || order.some((p) => rem(p, d) < o.hours - FIT)) return o.hours;
      for (const p of order) put(p, d, o.code, o.hours); return 0;
    }
    if (o.divisible) { // por unidad y de tipo que se parte: se llena a quienes tienen margen
      let left = o.hours;
      while (left > FIT) {
        let p = -1; for (let q = 0; q < n; q++) if (rem(q, d) > FIT && (p < 0 || rem(q, d) > rem(p, d) + EPS)) p = q;
        if (p < 0) break;
        const h = Math.min(left, rem(p, d)); put(p, d, o.code, h); left -= h;
      }
      return left;
    }
    let p = 0; for (let q = 1; q < n; q++) if (rem(q, d) > rem(p, d) + EPS) p = q;
    if (rem(p, d) < o.hours - FIT) return o.hours;
    put(p, d, o.code, o.hours); return 0;
  };

  for (const o of occs) {
    const order = o.day !== null ? [o.day] : [...Array(D).keys()].sort((a, b) => dayTotal(a) - dayTotal(b) || a - b);
    let left = o.hours, daySpent = o.day ?? order[0];
    for (const d of order) { left = place({ ...o, hours: left }, d); daySpent = d; if (left <= FIT) break; }
    if (left > FIT) { // no cupo: se deja en la persona y el día con más margen y se cuenta como horas que no caben
      const d = o.day ?? daySpent;
      let p = 0; for (let q = 1; q < n; q++) if (rem(q, d) > rem(p, d) + EPS) p = q;
      const people = o.k > 1 ? [...Array(n).keys()].sort((a, b) => rem(b, d) - rem(a, d) || a - b).slice(0, Math.min(o.k, n)) : [p];
      for (const q of people) { put(q, d, o.code, left); overflow += left; }
    }
  }

  const grid: Cell[][] = Array.from({ length: n }, (_, p) => Array.from({ length: D }, (_, d) => {
    const its = [...items[p][d].entries()].map(([code, minutes]) => ({ code, minutes })).sort((a, b) => a.code.localeCompare(b.code));
    return { items: its, reserveMin: reserveCell[p][d], totalMin: load[p][d] * 60, capacityMin: cd * 60 };
  }));
  const summaries: ActivitySummary[] = active.map((l) => {
    const persons = [...(who.get(l.code) ?? [])].sort((a, b) => a - b);
    return { code: l.code, name: l.name, type: l.type, rule: l.rule, persons, executions: execs.get(l.code) ?? 0, minutesPerExecution: l.hoursPerExec * 60, weekMinutes: mins.get(l.code) ?? 0, perEmployee: l.perEmployee, simultaneous: l.k };
  });
  return { grid, overflow, assigned, reserve, summaries };
}

/** Capacidad diaria de una persona: su jornada diaria (Parámetros) menos la reserva; sin ella, su semana útil repartida en los días del cargo. Nunca más que su semana útil. */
export const dailyCapacity = (hoursPerPerson: number, days: number, prm: Params): number =>
  Math.min(hoursPerPerson, prm.dailyWorkHours && prm.dailyWorkHours > 0 ? prm.dailyWorkHours * (1 - prm.reservePct) : hoursPerPerson / Math.max(1, days));

function plan(kind: WeekKind, lines: Line[], start: number, days: number[], cd: number, cw: number): WeekPlan {
  let n = Math.max(1, start), sim = simulate(lines, kind, n, days, cd, cw);
  while (sim.overflow > FIT && n < start + MAX_EXTRA_PEOPLE) { n++; sim = simulate(lines, kind, n, days, cd, cw); }
  return { kind, people: n, grid: sim.grid, activities: sim.summaries, reserveHours: sim.reserve, assignedHours: sim.assigned, capacityHours: n * cw, overflowHours: sim.overflow };
}

export function buildSchedules(input: ScheduleInput): PositionSchedule[] {
  return input.positions.map((p): PositionSchedule => {
    const key = positionKey(p.dataKind, p.area, p.site, p.position);
    const base = { key, dataKind: p.dataKind, area: p.area, site: p.site, position: p.position, days: input.shiftDays.get(key) ?? [], common: null, periodic: null, notes: [] as string[] };
    const need = needOf(p);
    const required = need.required;
    if (base.days.length === 0) return { ...base, state: "noshifts", reason: "El cargo no tiene turnos registrados: se reparte por los días de sus turnos. Regístrelos en Cargos y dotación.", required };
    if (required === null || p.hoursPerPerson === null) return { ...base, state: "nodata", reason: need.reading, required };
    const { lines, excluded, untyped } = linesOf(input, key);
    const cw = p.hoursPerPerson, cd = dailyCapacity(cw, base.days.length, input.params);
    const common = plan("common", lines, required, base.days, cd, cw);
    const periodic = plan("periodic", lines, common.people, base.days, cd, cw);
    const notes = base.notes;
    if (excluded > 0) notes.push(`${excluded} ${excluded === 1 ? "actividad con datos incompletos no entra" : "actividades con datos incompletos no entran"} en el reparto.`);
    if (untyped > 0) notes.push(`${untyped} ${untyped === 1 ? "actividad sin tipo registrado se reparte" : "actividades sin tipo registrado se reparten"} como «Una persona por ejecución».`);
    if (common.people > required) notes.push(`Con las reglas de reparto hacen falta ${common.people} personas en la semana común, más que las ${required} de Dotación requerida.`);
    if (periodic.people > common.people) notes.push(`En la semana con actividades periódicas hacen falta ${periodic.people - common.people} ${periodic.people - common.people === 1 ? "persona más" : "personas más"} (refuerzo).`);
    if (common.overflowHours > FIT || periodic.overflowHours > FIT) notes.push("Aun con el máximo de personas probado, hay horas que no caben: revise los tiempos y frecuencias de las actividades.");
    if (base.days.length !== Math.round(input.params.workDaysPerWeek)) notes.push(`El cargo trabaja ${base.days.length} días por sus turnos y Parámetros indica ${input.params.workDaysPerWeek}: Dotación requerida usa los de Parámetros y este reparto, los de los turnos.`);
    return { ...base, state: "ok", reason: "", required, common, periodic, notes };
  });
}

/** «45 min», «2 h», «2 h 15 min»: minutos con decimales del reparto, redondeados al minuto. */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
