/**
 * Reparto semanal de las actividades entre las personas necesarias (D-101 y D-102, parte B del informe de resultados). Funciones puras, deterministas y sin base de datos.
 *
 * Qué entrega, por cada cargo con turnos: una «semana común» (actividades diarias y semanales) y una «semana con actividades periódicas» (la común más las quincenales, mensuales,
 * trimestrales y anuales, suponiendo el peor caso: todas coinciden en esa semana). Cada una es una tabla persona × día; cada celda tiene su horario sugerido (orden y horas).
 * Las personas son «Persona 1, 2…»: nunca nombres (regla 6). Los tiempos y las frecuencias salen del motor real (computeActivity); aquí solo se reparten.
 * Cada celda trae sus tareas en un orden sugerido y con su tiempo, SIN horas del día: no se sabe a qué hora ocurre cada tarea en la operación (D-103).
 *
 * Principios (D-102, conclusiones con el titular):
 *   1) El número de personas es EL DE «DOTACIÓN REQUERIDA»: el reparto nunca suma gente. Si una regla no cabe, se parte la tarea lo mínimo y se marca.
 *   2) Se reparten las MISMAS horas de Cálculo de tiempos (con el multiplicador de las actividades «por colaborador» que usa el motor), así las dos secciones no se contradicen.
 *   3) El reparto nivela: cada tarea va a quien más margen tiene, así todas las personas quedan con tiempo operativo parejo. Cuando hay más disponibilidad que tareas, el sobrante
 *      se muestra («Disponibilidad sin tareas»); cuando hay más tareas, se acepta hasta el «Umbral de sobrecarga» de Parámetros y lo que pase se marca.
 *
 * Reglas de reparto por TIPO de actividad (confirmadas por el titular, 6 nov 2026):
 *   Operativa, Servicio          → se parte libremente: las ejecuciones van a distintas personas y, si la actividad es por unidad, también se reparten las unidades.
 *   Administrativa, Control, Apoyo → cada ejecución la hace una sola persona; las ejecuciones se reparten entre personas.
 *   Coordinación                 → una sola persona responsable de todas las ejecuciones.
 *   Ocasional o no planificada   → no se programa: aparece como reserva para imprevistos, repartida por igual.
 * Para todas: lo que exige varias personas a la vez se asigna a varias al mismo tiempo; nadie pasa su capacidad (con la tolerancia); los días son los de los turnos del cargo.
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
  /** Días (0 = lunes … 6 = domingo) en que trabaja el cargo, por clave de cargo (ver positionKey): la unión de los días de sus turnos. */
  shiftDays: Map<string, number[]>;
  /** «Umbral de sobrecarga» de Parámetros como razón (1,05 = 105 %): cuánta sobrecarga se acepta antes de pedir otra persona. Menos de 1 se trata como 1. */
  overload?: number;
}

export type WeekKind = "common" | "periodic";
export const WEEK_ES: Record<WeekKind, string> = { common: "Semana común", periodic: "Semana con actividades periódicas" };
export interface CellItem { code: string; minutes: number; rank: number }
/** Una tarea de una persona en un día, en el orden sugerido: cuánto dura (no a qué hora). Los imprevistos son una fila más, de tipo «reserve». */
export interface DayTask { kind: "task" | "reserve"; code: string; name: string; minutes: number }
/** Orden de las tareas de un día guardado por una persona con permiso (D-104): códigos en orden y cuándo se guardó. Es una preferencia de la vista, no un dato del estudio. */
export interface SavedOrder { codes: string[]; at: string }
export interface Cell {
  items: CellItem[]; reserveMin: number; totalMin: number;
  /** Jornada útil del día (sin tolerancia). */ capacityMin: number;
  /** Lo más que se asigna en un día: la jornada útil más la sobrecarga aceptada. */ toleranceMin: number;
  /** Tareas del día en el orden sugerido (primero lo diario, luego lo semanal y lo periódico, al final los imprevistos). */ tasks: DayTask[];
  /** Orden guardado para este día (null = el sugerido). Lo llena attachSavedOrders. */ saved: SavedOrder | null;
}
export interface ActivitySummary {
  code: string; name: string; type: ActivityTypeKey | null; rule: SplitRule;
  /** Personas (1, 2…) que la ejecutan esa semana. */ persons: number[];
  /** Ejecuciones de la semana (del cargo completo). */ executions: number;
  /** Minutos de una ejecución por persona (si exige varias a la vez, lo que le toca a cada una). */ minutesPerExecution: number;
  /** Minutos de la semana sumando a todas las personas. */ weekMinutes: number;
  perEmployee: boolean; simultaneous: number;
  /** No cupo entera con la regla de su tipo y se compartió entre personas. */ shared: boolean;
}
export interface WeekPlan {
  kind: WeekKind; people: number;
  /** grid[persona][día] con los días de PositionSchedule.days. */ grid: Cell[][];
  activities: ActivitySummary[];
  reserveHours: number; assignedHours: number;
  /** Jornada útil semanal de todas las personas (sin tolerancia). */ capacityHours: number;
  /** (asignado + imprevistos) ÷ capacidad: 1 = cada persona ocupada toda su jornada útil. */ utilization: number;
  /** Disponibilidad sin tareas: lo que le sobra a la capacidad (0 si la carga la alcanza o pasa). */ freeHours: number;
  /** Horas que no cupieron ni con la tolerancia (la carga pasa la capacidad). */ overflowHours: number;
  /** Personas más que harían falta para no pasar el umbral de sobrecarga (0 si no hace falta). */ extraPeople: number;
}
export type ScheduleState = "ok" | "nodata" | "noshifts";
export interface PositionSchedule {
  key: string; dataKind: string; area: string; site: string; position: string;
  state: ScheduleState; reason: string;
  days: number[]; /** Personas necesarias que da «Dotación requerida» (y que usa el reparto). */ required: number | null;
  common: WeekPlan | null; periodic: WeekPlan | null;
  notes: string[];
}

export const positionKey = (kind: string, area: string, site: string, position: string) => [kind, norm(area), norm(site), norm(position)].join("|");

const EPS = 1e-9, FIT = 1e-6;
const rankOf = (kind: "daily" | "weekly" | "periodic") => (kind === "daily" ? 0 : kind === "weekly" ? 1 : 2);

/** Una ejecución (o fracción de ejecución) por colocar. `hours` = horas de CADA una de las `k` personas que la hacen a la vez. */
interface Occ { code: string; hours: number; k: number; divisible: boolean; day: number | null }
interface Line {
  code: string; name: string; type: ActivityTypeKey | null; rule: SplitRule; perEmployee: boolean; k: number;
  hoursPerExec: number; periodKind: "daily" | "weekly" | "periodic";
  /** Ejecuciones de la semana de TODO el cargo (con el multiplicador por colaborador del motor y la parte que le toca al cargo); en las periódicas, las del período. */ executions: number;
  divisible: boolean; reserveHours: number;
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
    // Mismas horas de Cálculo de tiempos: ejecuciones por semana × multiplicador por colaborador (los ocupantes de hoy) × parte del cargo.
    const executions = (periodKind === "periodic" ? a.executions ?? 0 : result.execPerWeek ?? 0) * (result.mult ?? 1) * f;
    lines.push({
      code: a.code, name: extra?.name ?? a.code, type, rule: effRule, perEmployee, k, hoursPerExec: ((result.hoursPerExec ?? 0) / k) * scale, periodKind, executions,
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

interface Sim { items: Map<string, number>[][]; reserveCell: number[][]; load: number[][]; overflow: number; assigned: number; reserve: number; who: Map<string, Set<number>>; execs: Map<string, number>; mins: Map<string, number>; shared: Set<string> }

/**
 * Un reparto con `n` personas (las de Dotación requerida). Voraz y determinista: lo más grande primero, siempre a quien más margen tiene (así se nivela); empates, la persona y el
 * día más bajos. `T` = sobrecarga aceptada (1,05 = 105 %). Si una tarea no cabe entera con la regla de su tipo, se parte lo mínimo y queda marcada; si ni así cabe, queda en quien
 * más margen tiene y se cuenta como horas que no caben.
 */
function simulate(lines: Line[], kind: WeekKind, n: number, D: number, cd: number, cw: number, T: number): Sim {
  const capD = cd * T, capW = cw * T;
  const load = Array.from({ length: n }, () => Array<number>(D).fill(0)), week = Array<number>(n).fill(0);
  const items = Array.from({ length: n }, () => Array.from({ length: D }, () => new Map<string, number>()));
  const reserveCell = Array.from({ length: n }, () => Array<number>(D).fill(0));
  const who = new Map<string, Set<number>>(), execs = new Map<string, number>(), mins = new Map<string, number>(), shared = new Set<string>();
  let overflow = 0, assigned = 0;
  const rem = (p: number, d: number) => Math.min(capD - load[p][d], capW - week[p]);
  const put = (p: number, d: number, code: string, h: number) => {
    load[p][d] += h; week[p] += h; assigned += h;
    items[p][d].set(code, (items[p][d].get(code) ?? 0) + h * 60);
    (who.get(code) ?? who.set(code, new Set()).get(code)!).add(p + 1);
    mins.set(code, (mins.get(code) ?? 0) + h * 60);
  };

  // 1) reserva para imprevistos: igual para todas las personas y días
  const reserve = lines.reduce((s, l) => s + l.reserveHours, 0);
  if (reserve > EPS && n > 0 && D > 0) for (let p = 0; p < n; p++) for (let d = 0; d < D; d++) { const h = reserve / (n * D); reserveCell[p][d] = h * 60; load[p][d] += h; week[p] += h; }

  // 2) lo que hace el cargo: se reparte según la regla de su tipo
  const active = lines.filter((l) => l.rule !== "reserve" && (l.periodKind === "periodic" ? kind === "periodic" : true));
  const occs: Occ[] = [];
  const owner = new Map<string, number>();
  for (const l of active) {
    const base = { code: l.code, k: l.k, divisible: l.divisible };
    execs.set(l.code, l.executions);
    if (l.periodKind === "daily") for (let d = 0; d < D; d++) for (const frac of pieces(l.executions / D)) occs.push({ ...base, hours: l.hoursPerExec * frac, day: d });
    else for (const frac of pieces(l.executions)) occs.push({ ...base, hours: l.hoursPerExec * frac, day: null });
  }
  // primero lo que tiene día fijo (lo diario no se puede mover), luego lo que se puede acomodar en cualquier día; dentro de cada grupo, lo más grande primero
  occs.sort((a, b) => (a.day === null ? 1 : 0) - (b.day === null ? 1 : 0) || b.hours * b.k - a.hours * a.k || a.code.localeCompare(b.code) || (a.day ?? -1) - (b.day ?? -1));
  const ruleOfCode = new Map(active.map((l) => [l.code, l.rule]));
  const dayTotal = (d: number) => load.reduce((s, col) => s + col[d], 0);
  /** Quienes tienen al menos `room` horas de espacio ese día, empezando por la que lleva MENOS horas en la semana (así se nivela la semana, no solo el día); empates, menos carga ese día y luego la persona más baja. */
  const byLeastWeek = (d: number, room: number) => [...Array(n).keys()].filter((q) => rem(q, d) >= room)
    .sort((a, b) => week[a] - week[b] || load[a][d] - load[b][d] || a - b);

  const place = (o: Occ, d: number): number => { // devuelve las horas que quedan sin colocar en ese día (todas, si no cabe con la regla)
    const rule = ruleOfCode.get(o.code)!;
    if (o.k > 1) { // varias personas a la vez (también en una coordinación): las k que llevan menos horas y tienen espacio, todas deben poder
      if (o.k > n) return o.hours;
      const order = byLeastWeek(d, o.hours - FIT).slice(0, o.k);
      if (order.length < o.k) return o.hours;
      for (const p of order) put(p, d, o.code, o.hours); return 0;
    }
    if (rule === "single") {
      let p = owner.get(o.code);
      if (p === undefined) { p = 0; for (let q = 1; q < n; q++) if (week[q] < week[p] - EPS) p = q; owner.set(o.code, p); }
      if (rem(p, d) < o.hours - FIT) return o.hours;
      put(p, d, o.code, o.hours); return 0;
    }
    if (o.divisible) { // por unidad y de tipo que se parte: se llena a quienes tienen margen
      let left = o.hours;
      while (left > FIT) {
        const p = byLeastWeek(d, 2 * FIT)[0]; // con espacio de verdad (más que la tolerancia numérica): así cada vuelta avanza
        if (p === undefined) break;
        const h = Math.min(left, rem(p, d)); put(p, d, o.code, h); left -= h;
      }
      return left;
    }
    const p = byLeastWeek(d, o.hours - FIT)[0];
    if (p === undefined) return o.hours;
    put(p, d, o.code, o.hours); return 0;
  };

  for (const o of occs) {
    const order = o.day !== null ? [o.day] : [...Array(D).keys()].sort((a, b) => dayTotal(a) - dayTotal(b) || a - b);
    let left = o.hours;
    for (const d of order) { left = place({ ...o, hours: left }, d); if (left <= FIT) break; }
    if (left <= FIT) continue;
    // No cupo entera con la regla de su tipo: se parte lo mínimo entre quienes tienen margen (el número de personas no se toca).
    let total = left * o.k;
    for (const d of order) {
      while (total > FIT) {
        const p = byLeastWeek(d, 2 * FIT)[0]; // con espacio de verdad (más que la tolerancia numérica): así cada vuelta avanza
        if (p === undefined) break;
        const h = Math.min(total, rem(p, d)); put(p, d, o.code, h); total -= h; shared.add(o.code);
      }
      if (total <= FIT) break;
    }
    if (total > FIT) { // ni así cabe: se deja en quien más margen tiene y se cuenta como horas que no caben
      const d = o.day ?? order[0];
      const people = [...Array(n).keys()].sort((a, b) => rem(b, d) - rem(a, d) || a - b).slice(0, Math.min(o.k, n));
      for (const q of people) put(q, d, o.code, total / people.length);
      overflow += total; shared.add(o.code);
    }
  }
  return { items, reserveCell, load, overflow, assigned, reserve, who, execs, mins, shared };
}

/**
 * Capacidad diaria de una persona: su jornada diaria (Parámetros) menos la reserva; sin ella, su semana útil repartida en los días del cargo. Nunca menos que su semana útil repartida
 * en los días del cargo (si la jornada diaria × los días no alcanza para la jornada semanal, la semana útil sería inalcanzable) ni más que su semana útil.
 */
export const dailyCapacity = (hoursPerPerson: number, days: number, prm: Params): number => {
  const evenly = hoursPerPerson / Math.max(1, days);
  return Math.min(hoursPerPerson, prm.dailyWorkHours && prm.dailyWorkHours > 0 ? Math.max(evenly, prm.dailyWorkHours * (1 - prm.reservePct)) : evenly);
};

/**
 * Orden sugerido de las tareas de una persona en un día: primero lo diario, luego lo semanal, luego lo periódico y al final los imprevistos; dentro de cada grupo, por código.
 * Solo es un orden (y el tiempo de cada una): no hay horas del día porque no se sabe a qué hora ocurre cada tarea. La persona puede cambiarlo en la vista (moveTask).
 */
export function orderedTasks(items: { code: string; name: string; minutes: number; rank: number }[], reserveMin: number): DayTask[] {
  const tasks: DayTask[] = [...items].sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code)).map((t) => ({ kind: "task" as const, code: t.code, name: t.name, minutes: t.minutes }));
  if (reserveMin > 0.5) tasks.push({ kind: "reserve", code: "Imprevistos", name: "Reserva para actividades ocasionales o no planificadas", minutes: reserveMin });
  return tasks;
}

/**
 * Aplica un orden guardado (códigos) a las tareas de un día: primero las que están en la lista, en ese orden; las que no están (actividades nuevas) siguen después, en su orden
 * sugerido; los códigos guardados que ya no existen se ignoran. Con una lista vacía o ausente devuelve el orden sugerido. No modifica la lista recibida.
 */
export function applyOrder<T extends { code: string }>(tasks: readonly T[], saved: readonly string[] | null | undefined): T[] {
  if (!saved || saved.length === 0) return [...tasks];
  const rank = (t: T, i: number) => { const k = saved.indexOf(t.code); return k < 0 ? 1e6 + i : k; };
  return tasks.map((t, i) => ({ t, r: rank(t, i) })).sort((a, b) => a.r - b.r).map((x) => x.t);
}

/** Clave de un orden guardado: cargo, semana, persona (1, 2…) y día de la semana (0 = lunes). */
export const orderKey = (positionKey: string, week: WeekKind, person: number, weekday: number) => `${positionKey}|${week}|${person}|${weekday}`;

/** Pone en cada celda su orden guardado (si lo hay). Modifica y devuelve los mismos reparto, que acaban de construirse. */
export function attachSavedOrders(schedules: PositionSchedule[], orders: ReadonlyMap<string, SavedOrder>): PositionSchedule[] {
  if (orders.size === 0) return schedules;
  for (const s of schedules) for (const w of [s.common, s.periodic]) {
    if (!w) continue;
    w.grid.forEach((row, p) => row.forEach((cell, d) => { cell.saved = orders.get(orderKey(s.key, w.kind, p + 1, s.days[d])) ?? null; }));
  }
  return schedules;
}

/** Cambia de lugar la tarea `index` (`-1` la sube, `1` la baja) y devuelve una lista nueva; en los extremos no hace nada. Nunca modifica la lista recibida. */
export function moveTask<T>(rows: readonly T[], index: number, direction: -1 | 1): T[] {
  const to = index + direction, out = [...rows];
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return out;
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

function plan(kind: WeekKind, lines: Line[], n: number, days: number[], cd: number, cw: number, T: number): WeekPlan {
  const D = days.length, sim = simulate(lines, kind, n, D, cd, cw, T);
  const rankByCode = new Map(lines.map((l) => [l.code, rankOf(l.periodKind)])), nameByCode = new Map(lines.map((l) => [l.code, l.name]));
  const grid: Cell[][] = Array.from({ length: n }, (_, p) => Array.from({ length: D }, (_, d) => {
    const its: CellItem[] = [...sim.items[p][d].entries()].map(([code, minutes]) => ({ code, minutes, rank: rankByCode.get(code) ?? 2 })).sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    const tasks = orderedTasks(its.map((i) => ({ ...i, name: nameByCode.get(i.code) ?? i.code })), sim.reserveCell[p][d]);
    return { items: its, reserveMin: sim.reserveCell[p][d], totalMin: sim.load[p][d] * 60, capacityMin: cd * 60, toleranceMin: cd * T * 60, tasks, saved: null };
  }));
  const summaries: ActivitySummary[] = lines.filter((l) => l.rule !== "reserve" && (l.periodKind === "periodic" ? kind === "periodic" : true)).map((l) => ({
    code: l.code, name: l.name, type: l.type, rule: l.rule, persons: [...(sim.who.get(l.code) ?? [])].sort((a, b) => a - b), executions: sim.execs.get(l.code) ?? 0, minutesPerExecution: l.hoursPerExec * 60,
    weekMinutes: sim.mins.get(l.code) ?? 0, perEmployee: l.perEmployee, simultaneous: l.k, shared: sim.shared.has(l.code),
  }));
  const total = sim.assigned + sim.reserve, capacity = n * cw;
  return {
    kind, people: n, grid, activities: summaries, reserveHours: sim.reserve, assignedHours: sim.assigned, capacityHours: capacity,
    utilization: capacity > 0 ? total / capacity : 0, freeHours: Math.max(0, capacity - total), overflowHours: sim.overflow,
    extraPeople: Math.max(0, Math.ceil(total / (cw * T) - EPS) - n),
  };
}

export function buildSchedules(input: ScheduleInput): PositionSchedule[] {
  const T = Math.max(1, input.overload ?? 1);
  return input.positions.map((p): PositionSchedule => {
    const key = positionKey(p.dataKind, p.area, p.site, p.position);
    const days = [...(input.shiftDays.get(key) ?? [])].sort((a, b) => a - b);
    const base = { key, dataKind: p.dataKind, area: p.area, site: p.site, position: p.position, days, common: null, periodic: null, notes: [] as string[] };
    const need = needOf(p, T);
    const required = need.required;
    if (days.length === 0) return { ...base, state: "noshifts", reason: "El cargo no tiene turnos registrados: se reparte por los días de sus turnos. Regístrelos en Cargos y dotación.", required };
    if (required === null || p.hoursPerPerson === null) return { ...base, state: "nodata", reason: need.reading, required };
    const { lines, excluded, untyped } = linesOf(input, key);
    const cw = p.hoursPerPerson, cd = dailyCapacity(cw, days.length, input.params);
    const common = plan("common", lines, required, days, cd, cw, T);
    const periodic = plan("periodic", lines, required, days, cd, cw, T);
    const notes = base.notes;
    if (excluded > 0) notes.push(`${excluded} ${excluded === 1 ? "actividad con datos incompletos no entra" : "actividades con datos incompletos no entran"} en el reparto.`);
    if (untyped > 0) notes.push(`${untyped} ${untyped === 1 ? "actividad sin tipo registrado se reparte" : "actividades sin tipo registrado se reparten"} como «Una persona por ejecución».`);
    const shared = [...new Set([...common.activities, ...periodic.activities].filter((a) => a.shared).map((a) => a.code))];
    if (shared.length > 0) notes.push(`Para mantener las ${required} ${required === 1 ? "persona" : "personas"} de Dotación requerida, no cupieron enteras con la regla de su tipo y se compartieron entre personas: ${shared.join(", ")}.`);
    if (periodic.extraPeople > 0 || periodic.overflowHours > FIT) notes.push(`En la semana con actividades periódicas la carga pasa la capacidad${periodic.overflowHours > FIT ? ` en ${periodic.overflowHours.toFixed(1)} h` : ""}: harían falta ${Math.max(1, periodic.extraPeople)} ${Math.max(1, periodic.extraPeople) === 1 ? "persona más" : "personas más"} esa semana (refuerzo) o horas extra.`);
    if (common.overflowHours > FIT) notes.push(`En la semana común ${common.overflowHours.toFixed(1)} h no caben ni con la sobrecarga aceptada: revise los tiempos y frecuencias.`);
    if (common.freeHours > 0.05 && lines.some((l) => l.periodKind === "periodic")) notes.push("En la semana común queda disponibilidad sin tareas porque las actividades periódicas ocurren solo en algunas semanas; en la semana con periódicas esa disponibilidad se usa.");
    if (input.params.dailyWorkHours && input.params.dailyWorkHours * (1 - input.params.reservePct) * days.length < cw - 1e-9) notes.push(`La jornada diaria de Parámetros (${input.params.dailyWorkHours} h) en los ${days.length} días del cargo no alcanza para su jornada semanal útil (${cw.toFixed(1)} h): se reparte la jornada semanal en esos días. Revise la jornada diaria, la semanal o los días de los turnos.`);
    if (days.length !== Math.round(input.params.workDaysPerWeek)) notes.push(`El cargo trabaja ${days.length} días por sus turnos y Parámetros indica ${input.params.workDaysPerWeek}: las horas son las mismas de Cálculo de tiempos y solo cambia en cuántos días se reparten.`);
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
