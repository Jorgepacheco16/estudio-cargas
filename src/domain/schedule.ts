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
 * D-108 (titular, 10 nov 2026):
 *   4) Descanso rotativo: una persona trabaja las horas de su semana en sus días de trabajo (42 h ÷ 7 h = 6 días) y descansa los demás días del cargo. Los descansos se asignan primero
 *      al domingo (menos actividad y menos recargos), cuidando que cada día quede cubierto, y rotan: cada semana las personas avanzan un puesto del cuadro.
 *   5) Una actividad solo se programa en los días de los turnos en que se ejecuta (p. ej. la de tesorería, de lunes a sábado, no cae el domingo). Sin turnos marcados, en todos los días del cargo.
 *   6) El número de personas usa la regla de redondeo de Parámetros (5,4 → 5; 5,5 → 6): si queda con la carga sobre su jornada útil, esa carga se acepta y se avisa.
 *
 * D-109/D-110 (titular, 10 nov 2026): compatibilidad por HORARIO. La franja de atención del cargo es de la primera a la última hora de sus turnos. Una persona puede tener el mismo día
 *   tareas de distintos turnos si sus horarios se solapan (apertura y tesorería caen en la mañana), pero no tareas en extremos opuestos del día (apertura y cierre): las tareas de una persona
 *   en un día deben compartir una franja de al menos «horas compartidas» (Parámetros, 3 h). Las actividades sin turnos, con «Todos los turnos» o con turnos sin horario no tienen restricción.
 *   Lo primero es el EQUILIBRIO: se reparte parejo entre las personas de cada día y de la semana, sin importar el turno del que surgió la tarea. Nadie pasa su jornada: lo que no cabe queda
 *   como «Sin asignar» (con su día y actividad), no cargado a alguien. Cada actividad debe quedar en todos los días que le corresponden (`check`).
 *
 * Reglas de reparto por TIPO de actividad (confirmadas por el titular, 6 nov 2026):
 *   Operativa, Servicio          → se parte libremente: las ejecuciones van a distintas personas y, si la actividad es por unidad, también se reparten las unidades.
 *   Administrativa, Control, Apoyo → cada ejecución la hace una sola persona; las ejecuciones se reparten entre personas.
 *   Coordinación                 → una sola persona responsable de todas las ejecuciones (el día que descansa, la cubre otra).
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
/** Franja del día en minutos desde la medianoche: [inicio, fin]. */
export type Win = [number, number];
/** Un turno del cargo (D-67): los días en que aplica (0 = lunes) y, si se registraron, su horario («HH:MM»). */
export interface ShiftRef { id: string; name: string; days: number[]; start: string | null; end: string | null }
/** Franja en que el cargo es requerido: de la primera hora de inicio a la última hora de fin de sus turnos. */
export interface ServiceWindow { start: string; end: string; hours: number }
export interface ScheduleInput {
  staff: StaffingInput[]; acts: ActivityInput[]; params: Params; positions: PositionRow[];
  /** Nombre y tipo de cada actividad, por código en minúsculas. */
  extras: Map<string, ActivityExtra>;
  /** Días (0 = lunes … 6 = domingo) en que trabaja el cargo, por clave de cargo (ver positionKey): la unión de los días de sus turnos. */
  shiftDays: Map<string, number[]>;
  /** Días (0 = lunes … 6 = domingo) en que se ejecuta cada actividad, por código en minúsculas: la unión de los días de los turnos que tiene marcados. Sin entrada (o null) = todos los días del cargo. */
  activityDays?: Map<string, number[] | null>;
  /** Turnos en que se ejecuta cada actividad, por código en minúsculas (D-109): quien está en un turno ese día solo hace tareas de ese turno. Sin entrada o null = en cualquiera; si está, manda sobre `activityDays`. */
  activityShifts?: Map<string, ShiftRef[] | null>;
  /** Todos los turnos de cada cargo, por clave de cargo: de ellos sale la franja de atención. */
  positionShifts?: Map<string, ShiftRef[]>;
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
  /** Jornada útil del día (sin tolerancia); 0 el día de descanso. */ capacityMin: number;
  /** Lo más que se asigna en un día: la jornada útil más la sobrecarga aceptada. */ toleranceMin: number;
  /** Día de descanso de la persona (D-108): no tiene tareas. */ rest: boolean;
  /** Franja del día en que cuadran las tareas de la persona (p. ej. «08:00–13:00»); null si solo tiene tareas sin horario, o descansa. */ shift: string | null;
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
  /** Descansos que no se pudieron conceder porque ese día no quedaría nadie para lo que no puede esperar (0 = todas descansan lo que les toca). */ restMissing: number;
  /** Por día del cargo: lo que no se pudo asignar a nadie sin pasar la jornada o juntar tareas de horarios opuestos (D-110). */ unassigned: { minutes: number; items: { code: string; minutes: number }[] }[];
}
/** Verificación de que una actividad queda en los días que le corresponden (D-110). */
export interface ActivityCheck {
  code: string; name: string; week: WeekKind; frequency: "daily" | "weekly" | "periodic";
  /** Días (0 = lunes) en que le corresponde ejecutarse. */ expectedDays: number[];
  /** Días en que quedó con tiempo asignado. */ scheduledDays: number[];
  /** Días de los que le corresponden en que no quedó (diaria) o todos, si una semanal/periódica no quedó en ninguno. */ missingDays: number[];
}
export type ScheduleState = "ok" | "nodata" | "noshifts";
export interface PositionSchedule {
  key: string; dataKind: string; area: string; site: string; position: string;
  state: ScheduleState; reason: string;
  days: number[]; /** Personas necesarias que da «Dotación requerida» (y que usa el reparto). */ required: number | null;
  /** Franja de atención del cargo (de la primera a la última hora de sus turnos); null si sus turnos no tienen horario. */ service: ServiceWindow | null;
  common: WeekPlan | null; periodic: WeekPlan | null;
  /** Una fila por actividad que se programa: en qué días debía quedar y en cuáles quedó. */ check: ActivityCheck[];
  notes: string[];
}

export const positionKey = (kind: string, area: string, site: string, position: string) => [kind, norm(area), norm(site), norm(position)].join("|");

const EPS = 1e-9, FIT = 1e-6;
const SUNDAY = 6;
const rankOf = (kind: "daily" | "weekly" | "periodic") => (kind === "daily" ? 0 : kind === "weekly" ? 1 : 2);

/** Una ejecución (o fracción de ejecución) por colocar. `hours` = horas de CADA una de las `k` personas que la hacen a la vez. `allowed` = posiciones (en los días del cargo) donde puede caer. */
interface Occ { code: string; hours: number; k: number; divisible: boolean; day: number | null; allowed: number[]; /** Franja propia de esta parte (el turno en que se hace), si la actividad se reparte entre varios turnos. */ win?: Win }
interface Line {
  code: string; name: string; type: ActivityTypeKey | null; rule: SplitRule; perEmployee: boolean; k: number;
  hoursPerExec: number; periodKind: "daily" | "weekly" | "periodic";
  /** Ejecuciones de la semana de TODO el cargo (con el multiplicador por colaborador del motor y la parte que le toca al cargo); en las periódicas, las del período. */ executions: number;
  divisible: boolean; reserveHours: number;
  /** Días de la semana (0 = lunes) en que se ejecuta, según sus turnos; null = todos los días del cargo. */ weekdays: number[] | null;
  /** Turnos en que se ejecuta (D-109); null = en cualquiera. */ shifts: ShiftRef[] | null;
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
    const shifts = input.activityShifts?.get(a.code.toLowerCase()) ?? null;
    const weekdays = shifts && shifts.length > 0 ? [...new Set(shifts.flatMap((x) => x.days))].sort((p, q) => p - q) : input.activityDays?.get(a.code.toLowerCase()) ?? null;
    lines.push({
      code: a.code, name: extra?.name ?? a.code, type, rule: effRule, perEmployee, k, hoursPerExec: ((result.hoursPerExec ?? 0) / k) * scale, periodKind, executions,
      divisible: a.calcMode === "per_unit" && effRule === "split", reserveHours, weekdays, shifts,
    });
  }
  return { lines, excluded, untyped };
}

/** Posiciones (en los días del cargo) donde puede caer una actividad: las de sus turnos; si ninguna coincide con los días del cargo, todas (no se descarta trabajo por un dato incoherente). */
function allowedOf(l: Pick<Line, "weekdays">, days: number[]): number[] {
  const all = days.map((_, i) => i);
  if (!l.weekdays) return all;
  const idx = all.filter((i) => l.weekdays!.includes(days[i]));
  return idx.length > 0 ? idx : all;
}

/** Turnos de la actividad que aplican ese día de la semana (0 = lunes); null si la actividad no tiene turnos (sin restricción). */
const usableShifts = (l: Pick<Line, "shifts">, weekday: number): ShiftRef[] | null => (l.shifts && l.shifts.length > 0 ? l.shifts.filter((x) => x.days.includes(weekday)) : null);
const minutesOfDay = (hhmm: string | null): number => { if (!hhmm) return 1e9; const [h, m] = hhmm.split(":"); return Number(h) * 60 + Number(m); };

/** Franja de atención: de la primera hora de inicio a la última de fin entre los turnos con horario (los que cruzan la medianoche no se consideran). */
export function serviceOf(shifts: readonly ShiftRef[] | undefined): ServiceWindow | null {
  const timed = (shifts ?? []).filter((x) => x.start && x.end && minutesOfDay(x.end) > minutesOfDay(x.start));
  if (timed.length === 0) return null;
  const a = Math.min(...timed.map((x) => minutesOfDay(x.start))), b = Math.max(...timed.map((x) => minutesOfDay(x.end)));
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: f(a), end: f(b), hours: (b - a) / 60 };
}

/** Franja de una actividad un día de la semana: de la primera hora de inicio a la última de fin de los turnos que aplican ese día; null si no tiene turnos o alguno no tiene horario (no se puede juzgar). */
function windowOn(l: Pick<Line, "shifts">, weekday: number): Win | null {
  const u = usableShifts(l, weekday);
  if (!u || u.length === 0 || u.some((x) => !x.start || !x.end || minutesOfDay(x.end) <= minutesOfDay(x.start))) return null;
  return [Math.min(...u.map((x) => minutesOfDay(x.start))), Math.max(...u.map((x) => minutesOfDay(x.end)))];
}
/**
 * ¿Caben en el mismo día de una persona dos franjas? Deben compartir más que un borde y al menos `minShared` minutos (o toda la más corta, si es menor). Devuelve la franja común
 * (lo que queda compartido) o false si no caben; con una de las dos sin horario no hay restricción.
 */
function meet(cur: Win | null, w: Win | null, minShared: number): Win | null | false {
  if (!w) return cur;
  if (!cur) return w;
  const a = Math.max(cur[0], w[0]), b = Math.min(cur[1], w[1]), shared = b - a, need = Math.min(minShared, cur[1] - cur[0], w[1] - w[0]);
  return shared > EPS && shared + EPS >= need ? [a, b] : false;
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/** Cómo se parte lo que una actividad diaria hace un día: si está marcada en varios turnos con horario, una parte por turno (según lo que dura cada uno); si no, una sola parte con la franja de toda la actividad (o sin franja). */
function portionsOf(l: Pick<Line, "shifts">, weekday: number): { w: Win | null; share: number }[] {
  const all = usableShifts(l, weekday) ?? [], us = all.filter((x) => x.start && x.end && minutesOfDay(x.end) > minutesOfDay(x.start));
  if (us.length >= 2 && us.length === all.length) { const len = (x: ShiftRef) => minutesOfDay(x.end) - minutesOfDay(x.start), total = us.reduce((t, x) => t + len(x), 0); return us.map((x) => ({ w: [minutesOfDay(x.start), minutesOfDay(x.end)] as Win, share: len(x) / total })); }
  return [{ w: windowOn(l, weekday), share: 1 }];
}

/** Ejecuciones enteras y, si sobra una fracción, una ejecución más corta: así no se pierde ni se inventa ningún minuto. */
function pieces0(executions: number): number[] {
  const whole = Math.floor(executions + EPS), frac = executions - whole;
  return [...Array<number>(whole).fill(1), ...(frac > EPS ? [frac] : [])];
}

/**
 * Días de trabajo de una persona en la semana (D-108): su jornada semanal útil ÷ la jornada diaria útil de Parámetros (42 h ÷ 7 h = 6 días); sin jornada diaria, los «días laborales por semana».
 * Nunca más que los días del cargo: si el cargo abre menos días, la persona trabaja todos y no hay descanso que repartir dentro de la semana.
 */
export function workDaysOf(hoursPerPerson: number, daysOfPosition: number, prm: Params): number {
  const D = Math.max(1, daysOfPosition);
  const daily = prm.dailyWorkHours && prm.dailyWorkHours > 0 ? prm.dailyWorkHours * (1 - prm.reservePct) : 0;
  const w = daily > 0 ? Math.ceil(hoursPerPerson / daily - 0.01) : Math.round(prm.workDaysPerWeek);
  return Math.min(D, Math.max(1, w));
}

/**
 * Quién descansa qué día (D-108). Cada persona descansa `days.length − W` días. Se asignan primero al domingo (menos actividad, menos recargos) y luego a los días de menos carga, y en cada
 * día quedan al menos las personas que hacen falta para cubrirlo (horas del día ÷ jornada diaria, y las que exige una actividad a la vez). Es el cuadro de UNA semana: en la siguiente las
 * personas avanzan un puesto (la Persona 2 hace lo que hizo la 1), así los descansos rotan. null si no hay descanso (el cargo abre solo los días que trabaja cada persona).
 * Un descanso que dejaría un día sin NADIE que haga lo que no puede esperar no se concede (`missing` los cuenta): hacen falta más personas para cubrir todos los días.
 */
function planRest(lines: Line[], kind: WeekKind, n: number, days: number[], W: number, cd: number, T: number, minShared: number, minPresent?: number[]): { rest: boolean[][]; missing: number } | null {
  const D = days.length, R = D - W, capDay = cd * T;
  if (R <= 0 || n <= 0) return null;
  // Lo que obliga a haber gente un día es lo que NO se puede mover de día (las actividades diarias) y los imprevistos; lo semanal y lo periódico se acomoda en los días con espacio.
  // `demand` (también con lo que se puede mover) solo ordena los días: los de menos carga reciben primero los descansos.
  const demand = Array<number>(D).fill(0), fixed = Array<number>(D).fill(0), fixedT = Array<number>(D).fill(0), maxK = Array<number>(D).fill(1), dayWins = Array.from({ length: D }, () => [] as { w: Win | null; h: number }[]);
  let reserve = 0;
  for (const l of lines) {
    reserve += l.reserveHours;
    if (l.rule === "reserve" || (l.periodKind === "periodic" && kind !== "periodic")) continue;
    const A = allowedOf(l, days), hours = l.hoursPerExec * l.k * l.executions;
    for (const d of A) { demand[d] += hours / A.length; if (l.periodKind === "daily") { fixed[d] += hours / A.length; fixedT[d] += hours / A.length; if (l.k > maxK[d]) maxK[d] = l.k; for (const po of portionsOf(l, days[d])) dayWins[d].push({ w: po.w, h: (hours / A.length) * po.share }); } }
  }
  for (let d = 0; d < D; d++) { demand[d] += reserve / D; fixed[d] += reserve / D; // un día con tareas de franjas que no caben en una misma persona (mañana y tarde) pide, por cada grupo de franjas compatibles, las personas que sus horas requieren
    const groups: { w: Win | null; h: number }[] = [];
    for (const it of dayWins[d].filter((x) => x.w).sort((x, y) => x.w![0] - y.w![0])) { const i = groups.findIndex((g) => meet(g.w, it.w, minShared) !== false); if (i < 0) groups.push({ w: it.w, h: it.h }); else groups[i] = { w: meet(groups[i].w, it.w, minShared) as Win | null, h: groups[i].h + it.h }; }
    const free = dayWins[d].filter((x) => !x.w).reduce((t, x) => t + x.h, 0), byGroup = groups.reduce((t, g) => t + Math.ceil(g.h / capDay - EPS), 0), byHours = Math.ceil((groups.reduce((t, g) => t + g.h, 0) + free) / capDay - EPS);
    const need = Math.max(groups.length, byGroup, byHours);
    if (need > maxK[d]) maxK[d] = need;
    if (minPresent && minPresent[d] > maxK[d]) maxK[d] = minPresent[d]; } // lo que pidió un intento anterior que dejó tareas sin asignar ese día
  // Cada descanso se pone donde menos aprieta: en el día cuya carga total (lo diario, lo que se puede mover y los imprevistos) quedaría más holgada para quienes lo trabajan, con preferencia
  // por el domingo (menos recargos). Así los descansos no se acumulan en los días más cargados, que es donde luego faltaría espacio.
  const util = (d: number, resting: number) => demand[d] / Math.max(1e-9, (n - resting) * capDay); // qué tan lleno quedaría el día para quienes lo trabajan
  const order = [...Array(D).keys()].sort((a, b) => (days[b] === SUNDAY ? 1 : 0) - (days[a] === SUNDAY ? 1 : 0) || demand[a] - demand[b] || days[b] - days[a]);
  const rest = Array.from({ length: n }, () => Array<boolean>(D).fill(false)), count = Array<number>(D).fill(0);
  let missing = 0;
  for (let p = 0; p < n; p++) for (let r = 0; r < R; r++) {
    let best = -1, bestCost = Infinity;
    for (const d of order) {
      if (rest[p][d]) continue;
      const short = Math.max(0, fixedT[d] - (n - count[d] - 1) * capDay) / capDay; // personas que faltarían ese día solo para lo diario que no se puede mover
      const cost = util(d, count[d] + 1) * (days[d] === SUNDAY ? 0.8 : 1) + 50 * short + (fixed[d] > EPS && n - count[d] - 1 < maxK[d] ? 1e6 : 0); // el descanso va al día que queda menos lleno (el domingo con preferencia); no dejar sin gente un día que exige varias personas a la vez
      if (cost < bestCost - 1e-9) { best = d; bestCost = cost; }
    }
    if (best < 0 || bestCost >= 1e6) { missing++; continue; } // quedaría un día sin nadie: ese descanso no se concede
    rest[p][best] = true; count[best]++;
  }
  return { rest, missing };
}

interface Piece { code: string; h: number; win: Win | null }
interface Sim { items: Map<string, number>[][]; reserveCell: number[][]; load: number[][]; overflow: number; assigned: number; reserve: number; who: Map<string, Set<number>>; execs: Map<string, number>; mins: Map<string, number>; shared: Set<string>; rest: boolean[][]; restMissing: number; win: (Win | null)[][]; unassigned: { code: string; h: number }[][] }

/**
 * Un reparto con `n` personas (las de Dotación requerida). Voraz y determinista, y luego un ajuste de equilibrio por día. `T` = sobrecarga aceptada (1,05 = 105 %). `W` = días que trabaja cada
 * persona (los demás días del cargo descansa, ver planRest). `minShared` = minutos que deben compartir los horarios de las tareas de una persona en un día.
 * Prioridades: (1) nadie pasa su jornada del día ni de la semana (con `T`); (2) las tareas de una persona un día comparten una franja; (3) el equilibrio. Si una tarea no cabe entera con la regla de
 * su tipo, se parte lo mínimo y queda marcada; si ni así cabe, queda «sin asignar» (no se carga a nadie).
 */
function simulate(lines: Line[], kind: WeekKind, n: number, days: number[], cd: number, cw: number, T: number, W: number, minShared: number, minPresent?: number[]): Sim {
  const D = days.length, capD = cd * T, capW = cw * T;
  const restPlan = planRest(lines, kind, n, days, W, cd, T, minShared, minPresent), rest = restPlan?.rest ?? Array.from({ length: n }, () => Array<boolean>(D).fill(false));
  const load = Array.from({ length: n }, () => Array<number>(D).fill(0)), week = Array<number>(n).fill(0);
  const pieces: Piece[][][] = Array.from({ length: n }, () => Array.from({ length: D }, () => [] as Piece[]));
  const reserveCell = Array.from({ length: n }, () => Array<number>(D).fill(0));
  const execs = new Map<string, number>(), shared = new Set<string>();
  const unassigned: { code: string; h: number }[][] = Array.from({ length: D }, () => []);
  let overflow = 0;
  const rem = (p: number, d: number) => (rest[p][d] ? 0 : Math.min(capD - load[p][d], capW - week[p]));
  const present = (d: number) => rest.reduce((sum, row) => sum + (row[d] ? 0 : 1), 0);
  // Franja común de las tareas de cada persona cada día (D-110): las tareas de una persona un día deben compartir una franja de al menos minShared.
  const lineByCode = new Map(lines.map((l) => [l.code, l]));
  const win: (Win | null)[][] = Array.from({ length: n }, () => Array<Win | null>(D).fill(null));
  const winOf = (code: string, d: number): Win | null => { const l = lineByCode.get(code); return l ? windowOn(l, days[d]) : null; };
  const winFor = (code: string, d: number, w?: Win | null): Win | null => (w !== undefined ? w : winOf(code, d)); // la franja de la parte (su turno) o, si no la tiene, la de toda la actividad
  const canTake = (p: number, d: number, code: string, w?: Win | null) => meet(win[p][d], winFor(code, d, w), minShared) !== false;
  const refresh = (p: number, d: number) => { let cur: Win | null = null; for (const pc of pieces[p][d]) { const r = meet(cur, pc.win, minShared); if (r !== false) cur = r; } win[p][d] = cur; };
  const put = (p: number, d: number, code: string, h: number, w?: Win | null) => {
    const f = winFor(code, d, w);
    pieces[p][d].push({ code, h, win: f });
    load[p][d] += h; week[p] += h;
    const r = meet(win[p][d], f, minShared); if (r !== false) win[p][d] = r;
  };

  // 1) los imprevistos NO se reparten primero: las tareas tienen prioridad y los imprevistos se acomodan al final en lo que sobra (paso 4)
  const reserve = lines.reduce((sum, l) => sum + l.reserveHours, 0);

  // 2) lo que hace el cargo: se reparte según la regla de su tipo
  const active = lines.filter((l) => l.rule !== "reserve" && (l.periodKind === "periodic" ? kind === "periodic" : true));
  const occs: Occ[] = [];
  const owner = new Map<string, number>();
  for (const l of active) {
    const allowed = allowedOf(l, days), base = { code: l.code, k: l.k, divisible: l.divisible, allowed };
    execs.set(l.code, l.executions);
    if (l.periodKind === "daily") for (const d of allowed) for (const po of portionsOf(l, days[d])) for (const frac of pieces0((l.executions / allowed.length) * po.share)) occs.push({ ...base, hours: l.hoursPerExec * frac, day: d, ...(po.w ? { win: po.w } : {}) }); // una actividad marcada en varios turnos se hace en CADA uno: las ejecuciones del día se reparten entre ellos y cada parte va a quien esté en ese turno
    else for (const frac of pieces0(l.executions)) occs.push({ ...base, hours: l.hoursPerExec * frac, day: null });
  }
  // primero lo que tiene día fijo (lo diario no se puede mover), luego lo que se puede acomodar en cualquier día; dentro de cada grupo, primero lo que tiene franja (lo restringido antes que lo libre) y luego lo más grande
  const timed = (o: Occ) => { if (o.win) return 0; const l = lineByCode.get(o.code); return l && (o.day !== null ? windowOn(l, days[o.day]) : l.shifts && l.shifts.length > 0 ? windowOn(l, days[o.allowed[0]]) : null) ? 0 : 1; };
  occs.sort((x, y) => (x.day === null ? 1 : 0) - (y.day === null ? 1 : 0) || timed(x) - timed(y) || y.hours * y.k - x.hours * x.k || x.code.localeCompare(y.code) || (x.day ?? -1) - (y.day ?? -1));
  const ruleOfCode = new Map(active.map((l) => [l.code, l.rule]));
  const dayTotal = (d: number) => load.reduce((sum, col) => sum + col[d], 0);
  /** Qué tan lleno está un día frente a las personas que trabajan ese día (el día con menos gente se llena antes): así se nivela por día aunque cada día tenga distinto número de personas. */
  const fill = (d: number) => (present(d) === 0 ? 1e9 : dayTotal(d) / (present(d) * capD));
  /**
   * Quienes tienen al menos `room` horas de espacio ese día (y no descansan) y cuyo horario del día es compatible, de menor a mayor carga. Lo diario (`byDay`) se nivela por día: primero quien lleva menos
   * horas ese día (en tramos de 15 min, para que el empate lo decida la semana); lo que se puede acomodar en cualquier día se nivela por semana.
   */
  const candidates = (d: number, room: number, code: string, byDay: boolean, w?: Win | null) => [...Array(n).keys()].filter((q) => !rest[q][d] && rem(q, d) >= room && canTake(q, d, code, w))
    .sort((x, y) => (byDay ? Math.floor((load[x][d] + EPS) / 0.25) - Math.floor((load[y][d] + EPS) / 0.25) || week[x] - week[y] : week[x] - week[y] || Math.floor((load[x][d] + EPS) / 0.25) - Math.floor((load[y][d] + EPS) / 0.25)) || load[x][d] - load[y][d] || x - y);

  const place = (o: Occ, d: number): number => { // devuelve las horas que quedan sin colocar en ese día (todas, si no cabe con la regla)
    const rule = ruleOfCode.get(o.code)!, byDay = o.day !== null;
    if (o.k > 1) { // varias personas a la vez (también en una coordinación): las k de menor carga con espacio, todas deben poder
      if (o.k > n) return o.hours;
      const order = candidates(d, o.hours - FIT, o.code, byDay, o.win).slice(0, o.k);
      if (order.length < o.k) return o.hours;
      for (const p of order) put(p, d, o.code, o.hours, o.win);
      return 0;
    }
    if (rule === "single") {
      let p = owner.get(o.code);
      if (p === undefined) { p = 0; for (let q = 1; q < n; q++) if (week[q] < week[p] - EPS) p = q; owner.set(o.code, p); }
      if (rest[p][d] || !canTake(p, d, o.code, o.win)) { const cover = candidates(d, o.hours - FIT, o.code, byDay, o.win)[0]; if (cover === undefined) return o.hours; put(cover, d, o.code, o.hours, o.win); return 0; } // el día que descansa la responsable (o su horario no cuadra), la cubre otra
      if (rem(p, d) < o.hours - FIT) return o.hours;
      put(p, d, o.code, o.hours, o.win); return 0;
    }
    if (o.divisible) { // por unidad y de tipo que se parte: se llena a quienes tienen margen
      let left = o.hours;
      while (left > FIT) {
        const p = candidates(d, 2 * FIT, o.code, byDay, o.win)[0]; // con espacio de verdad (más que la tolerancia numérica): así cada vuelta avanza
        if (p === undefined) break;
        const h = Math.min(left, rem(p, d)); put(p, d, o.code, h, o.win); left -= h;
      }
      return left;
    }
    const p = candidates(d, o.hours - FIT, o.code, byDay, o.win)[0];
    if (p === undefined) return o.hours;
    put(p, d, o.code, o.hours, o.win); return 0;
  };

  for (const o of occs) {
    const order = o.day !== null ? [o.day] : [...o.allowed].sort((x, y) => fill(x) - fill(y) || x - y);
    let left = o.hours;
    for (const d of order) { left = place({ ...o, hours: left }, d); if (left <= FIT) break; }
    if (left <= FIT) continue;
    // No cupo entera con la regla de su tipo: se parte lo mínimo entre quienes tienen margen (el número de personas no se toca).
    let total = left * o.k;
    for (const d of order) {
      while (total > FIT) {
        const p = candidates(d, 2 * FIT, o.code, o.day !== null, o.win)[0]; // con espacio de verdad (más que la tolerancia numérica): así cada vuelta avanza
        if (p === undefined) break;
        const h = Math.min(total, rem(p, d)); put(p, d, o.code, h, o.win); total -= h; shared.add(o.code);
      }
      if (total <= FIT) break;
    }
    if (total > FIT) { unassigned[o.day ?? order[0]].push({ code: o.code, h: total }); overflow += total; shared.add(o.code); } // ni así cabe: queda sin asignar, no se carga a nadie
  }

  // 3) equilibrio por día: se pasan tareas enteras de la persona más cargada del día a la menos cargada mientras eso las acerque, sin pasar su jornada ni juntar horarios opuestos
  const movable = (code: string) => ruleOfCode.get(code) !== "single" && (lineByCode.get(code)?.k ?? 1) === 1;
  for (let d = 0; d < D; d++) {
    for (let guard = 0; guard < 500; guard++) {
      const here = [...Array(n).keys()].filter((q) => !rest[q][d]);
      if (here.length < 2) break;
      const hi = here.reduce((x, y) => (load[y][d] > load[x][d] + EPS ? y : x)), lo = here.reduce((x, y) => (load[y][d] < load[x][d] - EPS ? y : x));
      const gap = load[hi][d] - load[lo][d];
      if (gap <= 0.1) break;
      let best = -1, bestGap = gap - 1e-6;
      pieces[hi][d].forEach((pc, i) => {
        if (!movable(pc.code) || pc.h >= gap - 1e-6 || rem(lo, d) < pc.h - FIT || week[lo] + pc.h > week[hi] + 0.5 || !canTake(lo, d, pc.code, pc.win)) return;
        const after = Math.abs(gap - 2 * pc.h);
        if (after < bestGap) { best = i; bestGap = after; }
      });
      if (best < 0) break;
      const [pc] = pieces[hi][d].splice(best, 1);
      pieces[lo][d].push(pc);
      load[hi][d] -= pc.h; week[hi] -= pc.h; load[lo][d] += pc.h; week[lo] += pc.h;
      refresh(hi, d); refresh(lo, d);
    }
  }

  // 4) imprevistos: se acomodan en lo que sobra, subiendo primero a quienes llevan menos horas ese día (nivelan la carga); si no cabe todo, lo que falta queda sin asignar
  let placedReserve = 0;
  for (let iter = 0; iter < 10 && reserve - placedReserve > 1e-9; iter++) {
    const want = reserve - placedReserve, cells: { p: number; d: number; room: number; base: number }[] = [];
    for (let p = 0; p < n; p++) for (let d = 0; d < D; d++) if (!rest[p][d]) { const room = rem(p, d); if (room > 1e-9) cells.push({ p, d, room, base: load[p][d] }); }
    if (cells.length === 0) break;
    const take = (level: number) => cells.reduce((t, c) => t + Math.min(c.room, Math.max(0, level - c.base)), 0), roomTotal = cells.reduce((t, c) => t + c.room, 0);
    let level = Math.max(...cells.map((c) => c.base + c.room));
    if (roomTotal > want) { let lo = 0, hi = level; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (take(mid) < want) lo = mid; else hi = mid; } level = hi; }
    const give = cells.map((c) => Math.min(c.room, Math.max(0, level - c.base)));
    for (let p = 0; p < n; p++) { // lo que cabe en la semana de cada persona es compartido por sus días: si se pasa, se reduce en proporción
      const idx = cells.map((c, i) => (c.p === p ? i : -1)).filter((i) => i >= 0), sum = idx.reduce((t, i) => t + give[i], 0), room = capW - week[p];
      if (sum > room + 1e-12 && sum > 0) for (const i of idx) give[i] *= Math.max(0, room) / sum;
    }
    let applied = 0;
    cells.forEach((c, i) => { const h = give[i]; if (h > 1e-12) { reserveCell[c.p][c.d] += h * 60; load[c.p][c.d] += h; week[c.p] += h; applied += h; } });
    placedReserve += applied;
    if (applied < 1e-9) break;
  }
  if (reserve > EPS) { const left = reserve - placedReserve; if (left > 1e-6) { overflow += left; for (let d = 0; d < D; d++) unassigned[d].push({ code: "Imprevistos", h: left / D }); } }

  // lo repartido, por persona y día (en minutos), y quién hace cada actividad
  const items = Array.from({ length: n }, (_, p) => Array.from({ length: D }, (_, d) => { const m = new Map<string, number>(); for (const pc of pieces[p][d]) m.set(pc.code, (m.get(pc.code) ?? 0) + pc.h * 60); return m; }));
  const who = new Map<string, Set<number>>(), mins = new Map<string, number>();
  let assigned = 0;
  for (let p = 0; p < n; p++) for (let d = 0; d < D; d++) for (const pc of pieces[p][d]) { (who.get(pc.code) ?? who.set(pc.code, new Set()).get(pc.code)!).add(p + 1); mins.set(pc.code, (mins.get(pc.code) ?? 0) + pc.h * 60); assigned += pc.h; }
  return { items, reserveCell, load, overflow, assigned, reserve: placedReserve, who, execs, mins, shared, rest, restMissing: restPlan?.missing ?? 0, win, unassigned };
}

/**
 * Capacidad diaria de una persona: su jornada diaria (Parámetros) menos la reserva; sin ella, su semana útil repartida en sus días de trabajo. Nunca menos que su semana útil repartida
 * en esos días (si la jornada diaria × los días no alcanza para la jornada semanal, la semana útil sería inalcanzable) ni más que su semana útil.
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

function plan(kind: WeekKind, lines: Line[], n: number, days: number[], cd: number, cw: number, T: number, W: number, minShared: number): WeekPlan {
  const D = days.length;
  // Si un día queda con tareas sin asignar (por el empaque de las franjas: la mañana y la tarde no se mezclan), se vuelve a planear pidiendo una persona más ese día (un descanso menos ahí)
  // y se conserva el mejor intento: así el reparto no se rinde mientras haya espacio en otro día.
  let sim = simulate(lines, kind, n, days, cd, cw, T, W, minShared), ask: number[] = Array<number>(D).fill(0);
  for (let attempt = 0; attempt < 10 && sim.overflow > EPS; attempt++) {
    const next = ask.slice(); let any = false;
    for (let d = 0; d < D; d++) if (sim.unassigned[d].some((u) => u.code !== "Imprevistos" && u.h > 1e-6)) { const here = n - sim.rest.filter((row) => row[d]).length; if (here < n) { next[d] = Math.max(next[d], here + 1); any = true; } }
    if (!any) break;
    const tried = simulate(lines, kind, n, days, cd, cw, T, W, minShared, next);
    if (tried.overflow >= sim.overflow - 1e-9) break;
    sim = tried; ask = next;
  }
  const rankByCode = new Map(lines.map((l) => [l.code, rankOf(l.periodKind)])), nameByCode = new Map(lines.map((l) => [l.code, l.name]));
  const grid: Cell[][] = Array.from({ length: n }, (_, p) => Array.from({ length: D }, (_, d) => {
    const its: CellItem[] = [...sim.items[p][d].entries()].map(([code, minutes]) => ({ code, minutes, rank: rankByCode.get(code) ?? 2 })).sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    const tasks = orderedTasks(its.map((i) => ({ ...i, name: nameByCode.get(i.code) ?? i.code })), sim.reserveCell[p][d]);
    const off = sim.rest[p][d];
    return { items: its, reserveMin: sim.reserveCell[p][d], totalMin: sim.load[p][d] * 60, capacityMin: off ? 0 : cd * 60, toleranceMin: off ? 0 : cd * T * 60, rest: off, shift: off || !sim.win[p][d] ? null : `${hhmm(sim.win[p][d]![0])}–${hhmm(sim.win[p][d]![1])}`, tasks, saved: null };
  }));
  const summaries: ActivitySummary[] = lines.filter((l) => l.rule !== "reserve" && (l.periodKind === "periodic" ? kind === "periodic" : true)).map((l) => ({
    code: l.code, name: l.name, type: l.type, rule: l.rule, persons: [...(sim.who.get(l.code) ?? [])].sort((a, b) => a - b), executions: sim.execs.get(l.code) ?? 0, minutesPerExecution: l.hoursPerExec * 60,
    weekMinutes: sim.mins.get(l.code) ?? 0, perEmployee: l.perEmployee, simultaneous: l.k, shared: sim.shared.has(l.code),
  }));
  const total = sim.assigned + sim.reserve + sim.overflow, capacity = n * cw;
  const unassigned = sim.unassigned.map((list) => { const by = new Map<string, number>(); for (const u of list) by.set(u.code, (by.get(u.code) ?? 0) + u.h * 60); return { minutes: [...by.values()].reduce((x, y) => x + y, 0), items: [...by.entries()].map(([code, minutes]) => ({ code, minutes })).sort((x, y) => x.code.localeCompare(y.code)) }; });
  return {
    kind, people: n, grid, activities: summaries, reserveHours: sim.reserve, assignedHours: sim.assigned, capacityHours: capacity,
    utilization: capacity > 0 ? total / capacity : 0, freeHours: Math.max(0, capacity - total), overflowHours: sim.overflow,
    extraPeople: Math.max(0, Math.ceil(total / (cw * T) - EPS) - n), restMissing: sim.restMissing, unassigned,
  };
}

/** Verificación de que cada actividad que se programa en la semana queda en los días que le corresponden: las diarias, en todos sus días; las semanales y periódicas, al menos en uno. */
function checksOf(week: WeekPlan, lines: Line[], days: number[]): ActivityCheck[] {
  return lines.filter((l) => l.rule !== "reserve" && (l.periodKind === "periodic" ? week.kind === "periodic" : true)).map((l) => {
    const expected = allowedOf(l, days).map((i) => days[i]);
    const scheduled = days.filter((_, d) => week.grid.some((row) => row[d].items.some((it) => it.code === l.code && it.minutes > 1e-6)));
    const missing = l.periodKind === "daily" ? expected.filter((d) => !scheduled.includes(d)) : scheduled.length > 0 ? [] : expected;
    return { code: l.code, name: l.name, week: week.kind, frequency: l.periodKind, expectedDays: expected, scheduledDays: scheduled, missingDays: missing };
  }).sort((x, y) => x.code.localeCompare(y.code));
}

/** Texto sobre los descansos de una semana: cuántas personas trabajan el domingo, cuántos domingos libres da la rotación y cómo rotan. null si no hay descanso. */
function restNote(week: WeekPlan, days: number[], W: number): string | null {
  const n = week.people, D = days.length;
  if (D <= W || n <= 0 || !week.grid.some((row) => row.some((c) => c.rest))) return null;
  const parts = [`Cada persona trabaja ${W} de los ${D} días del cargo y descansa ${D - W === 1 ? "el otro" : "los otros"}. Los descansos rotan: cada semana las personas avanzan un puesto del cuadro (la Persona 2 hace lo que hizo la 1 la semana anterior).`];
  const sd = days.indexOf(SUNDAY);
  if (sd >= 0) {
    const workers = week.grid.filter((row) => !row[sd].rest).length, perMonth = ((n - workers) / n) * (52 / 12);
    parts.push(`El domingo trabaja${workers === 1 ? "" : "n"} ${workers} de ${n} ${n === 1 ? "persona" : "personas"}; con la rotación cada una descansa en promedio ${perMonth.toFixed(1).replace(".", ",")} domingos al mes.${perMonth < 2 ? " Lo preferible son 2 domingos libres al mes; si la operación lo requiere, la persona trabaja el domingo." : ""}`);
  }
  return parts.join(" ");
}

export function buildSchedules(input: ScheduleInput): PositionSchedule[] {
  const T = Math.max(1, input.overload ?? 1), roundFrom = input.params.staffRoundFrom ?? 0, sharedHours = Math.max(0, input.params.minSharedHours ?? 3), minShared = sharedHours * 60;
  return input.positions.map((p): PositionSchedule => {
    const key = positionKey(p.dataKind, p.area, p.site, p.position);
    const days = [...(input.shiftDays.get(key) ?? [])].sort((a, b) => a - b);
    const base = { key, dataKind: p.dataKind, area: p.area, site: p.site, position: p.position, days, service: serviceOf(input.positionShifts?.get(key)), common: null, periodic: null, check: [] as ActivityCheck[], notes: [] as string[] };
    const need = needOf(p, T, roundFrom);
    const required = need.required;
    if (days.length === 0) return { ...base, state: "noshifts", reason: "El cargo no tiene turnos registrados: se reparte por los días de sus turnos. Regístrelos en Cargos y dotación.", required };
    if (required === null || p.hoursPerPerson === null) return { ...base, state: "nodata", reason: need.reading, required };
    const { lines, excluded, untyped } = linesOf(input, key);
    const cw = p.hoursPerPerson, W = workDaysOf(cw, days.length, input.params), cd = dailyCapacity(cw, W, input.params);
    // Si el redondeo dejó la carga de cada persona sobre su jornada útil (5,4 → 5), esa carga es la que aceptó el titular: no se marca como sobrecarga ni se pide otra persona.
    const Te = need.exact !== null && required > 0 ? Math.max(T, need.exact / required) : T;
    const common = plan("common", lines, required, days, cd, cw, Te, W, minShared);
    const periodic = plan("periodic", lines, required, days, cd, cw, Te, W, minShared);
    const check = [...checksOf(common, lines, days), ...checksOf(periodic, lines, days).filter((c) => c.frequency === "periodic")];
    const notes = base.notes;
    if (roundFrom > 0 && need.exact !== null && need.exact / required > T + 1e-9) notes.push(`Dotación requerida da ${need.exact.toFixed(2).replace(".", ",")} personas de trabajo; con la regla de Parámetros (desde ${Math.round(roundFrom * 100)} % de persona se suma una) quedan ${required}, y cada una trabaja el ${Math.round((need.exact / required) * 100)} % de su jornada útil.`);
    if (lines.some((l) => l.shifts && l.shifts.length > 0)) notes.push(`Una persona solo recibe en un día tareas cuyos horarios comparten al menos ${String(sharedHours).replace(".", ",")} h (apertura con tesorería sí, apertura con cierre no): una misma persona no abre y cierra el mismo día. La celda muestra la franja en que cuadran sus tareas.`);
    const rn = restNote(common, days, W);
    if (rn) notes.push(rn);
    if (common.restMissing > 0) notes.push(`No se pudo dar ${common.restMissing === 1 ? "un descanso" : `${common.restMissing} descansos`} de la semana: con ${required} ${required === 1 ? "persona" : "personas"} habría días sin nadie que haga las actividades diarias. Hacen falta más personas para cubrir los ${days.length} días del cargo con descanso.`);
    if (excluded > 0) notes.push(`${excluded} ${excluded === 1 ? "actividad con datos incompletos no entra" : "actividades con datos incompletos no entran"} en el reparto.`);
    if (untyped > 0) notes.push(`${untyped} ${untyped === 1 ? "actividad sin tipo registrado se reparte" : "actividades sin tipo registrado se reparten"} como «Una persona por ejecución».`);
    const shared = [...new Set([...common.activities, ...periodic.activities].filter((a) => a.shared).map((a) => a.code))];
    if (shared.length > 0) notes.push(`Para mantener las ${required} ${required === 1 ? "persona" : "personas"} de Dotación requerida, no cupieron enteras con la regla de su tipo y se compartieron entre personas: ${shared.join(", ")}.`);
    if (periodic.extraPeople > 0 || periodic.overflowHours > FIT) notes.push(`En la semana con actividades periódicas la carga pasa la capacidad${periodic.overflowHours > FIT ? ` en ${periodic.overflowHours.toFixed(1)} h` : ""}: harían falta ${Math.max(1, periodic.extraPeople)} ${Math.max(1, periodic.extraPeople) === 1 ? "persona más" : "personas más"} esa semana (refuerzo) o horas extra.`);
    if (common.overflowHours > FIT) notes.push(`En la semana común ${common.overflowHours.toFixed(1)} h quedaron SIN ASIGNAR (fila «Sin asignar»): no caben en la jornada de las personas que trabajan esos días ni se pueden juntar con tareas de horarios opuestos. Nadie queda cargado de más.${days.length > W ? " Con los descansos cada día cuenta con una persona menos." : ""} Faltan personas en esa franja o los tiempos y frecuencias son altos.`);
    if (common.freeHours > 0.05 && lines.some((l) => l.periodKind === "periodic")) notes.push("En la semana común queda disponibilidad sin tareas porque las actividades periódicas ocurren solo en algunas semanas; en la semana con periódicas esa disponibilidad se usa.");
    if (input.params.dailyWorkHours && input.params.dailyWorkHours * (1 - input.params.reservePct) * W < cw - 1e-9) notes.push(`La jornada diaria de Parámetros (${input.params.dailyWorkHours} h) en los ${W} días de trabajo de cada persona no alcanza para su jornada semanal útil (${cw.toFixed(1)} h): se reparte la jornada semanal en esos días. Revise la jornada diaria, la semanal o los días de los turnos.`);
    if (days.length === W && days.length !== Math.round(input.params.workDaysPerWeek)) notes.push(`El cargo trabaja ${days.length} días por sus turnos y Parámetros indica ${input.params.workDaysPerWeek}: las horas son las mismas de Cálculo de tiempos y solo cambia en cuántos días se reparten.`);
    const gaps = check.filter((c) => c.missingDays.length > 0);
    if (gaps.length > 0) notes.push(`${gaps.length} ${gaps.length === 1 ? "actividad no quedó" : "actividades no quedaron"} en todos sus días: ${gaps.map((g) => g.code).join(", ")}. Mire «Verificación de actividades» y la fila «Sin asignar».`);
    return { ...base, state: "ok", reason: "", required, common, periodic, check, notes };
  });
}

/** «45 min», «2 h», «2 h 15 min»: minutos con decimales del reparto, redondeados al minuto. */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
