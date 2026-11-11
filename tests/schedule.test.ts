import { analyze } from "../src/domain/summary";
import { needOf, roundUpPeople } from "../src/domain/staffing";
import { applyOrder, attachSavedOrders, buildSchedules, formatMinutes, moveTask, orderKey, orderedTasks, positionKey, ruleOf, workDaysOf, reserveHoursByPosition, RULE_BY_TYPE, ACTIVITY_TYPES, serviceOf, type ActivityExtra, type ActivityTypeKey, type PositionSchedule, type SavedOrder, type ShiftRef, type WeekPlan } from "../src/domain/schedule";
import { computeActivity, occupantsOf, personDaysOf, type ActivityInput, type Params, type StaffingInput } from "../src/domain/engine";
import { tablesFor, VIEWS } from "../src/lib/tables";
import { MENU, menuHrefs } from "../src/lib/nav";
import { moduleOfPath } from "../src/domain/access";
import { check, summary } from "./helpers";

/**
 * Reparto semanal (D-101 y D-102). Las horas salen del motor real (computeActivity vía analyze). Se comprueba que el reparto: use SIEMPRE las personas de «Dotación requerida» (nunca
 * más), reparta exactamente las horas de Cálculo, nivele, respete la capacidad con la sobrecarga aceptada, aplique la regla de cada TIPO de actividad (confirmada por el titular) y
 * ofrezca las tareas de cada día en un orden sugerido, con su tiempo y SIN horas del día (D-103).
 */
const TH = { high: 1, low: 0.5 };
const prm = (over: Partial<Params> = {}): Params => ({ workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct: 0.1, scenario: "base", ...over });
const staff = (position: string, headcount: number | null, weeklyHours: number | null): StaffingInput => ({ dataKind: "real", area: "Cajas", site: "CO1", position, headcount, weeklyHours });
type Over = Partial<ActivityInput> & { hours?: number | null };
/** Actividad que dura `hours` horas por ejecución (por evento); por defecto del cargo completo, 1 ejecución por semana. */
const act = (code: string, position: string, o: Over = {}): ActivityInput => {
  const { hours, ...rest } = o;
  return {
    code, dataKind: "real", area: "Cajas", site: "CO1", position, employeeCode: null, calcMode: "per_event", scope: "position_total", executions: 1, period: "week", unitsPerExecution: null,
    timeAvgMin: hours === undefined ? 60 : hours === null ? null : hours * 60, timeMinMin: null, timeMaxMin: null, seasonHigh: null, seasonLow: null, simultaneous: null, loadShare: null, secondaryPosition: null, planning: "planned",
    waitMin: null, waitOccupies: null, travelMin: null, reworkPct: null, reworkMin: null, ...rest,
  };
};
const MON_SAT = [0, 1, 2, 3, 4, 5], ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
interface Run { schedules: PositionSchedule[]; hours: (position?: string) => number; required: (position?: string) => number | null }
function run(st: StaffingInput[], ac: ActivityInput[], types: Record<string, ActivityTypeKey | null> = {}, days: number[] = MON_SAT, over: Partial<Params> = {}, overload = 1, activityDays?: Map<string, number[] | null>): Run {
  const p = prm(over), a = analyze(st, ac, p, TH, "all");
  const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: x.code in types ? types[x.code] : "operational" }]));
  const shiftDays = new Map(a.positions.flatMap((x) => (days.length ? [[positionKey(x.dataKind, x.area, x.site, x.position), days] as const] : [])));
  return {
    schedules: buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays, activityDays, overload }),
    hours: (position = "Cajero") => a.positions.find((x) => x.position === position)?.hours ?? 0,
    required: (position = "Cajero") => { const x = a.positions.find((y) => y.position === position); return x ? needOf(x, overload, p.staffRoundFrom ?? 0).required : null; },
  };
}
const one = (r: Run, position = "Cajero") => { const s = r.schedules.find((x) => x.position === position); if (!s) throw new Error("no está " + position); return s; };
const ok = (s: PositionSchedule) => { if (s.state !== "ok" || !s.common || !s.periodic) throw new Error(`estado ${s.state}: ${s.reason}`); return { common: s.common, periodic: s.periodic }; };
const minutesOf = (w: WeekPlan, code: string) => w.grid.map((row) => row.map((c) => c.items.filter((i) => i.code === code).reduce((s, i) => s + i.minutes, 0)));
const sum = (m: number[][]) => m.flat().reduce((a, b) => a + b, 0);
const weekOf = (row: WeekPlan["grid"][number]) => row.reduce((s, c) => s + c.totalMin, 0);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

async function main() {
  await check("Reglas por tipo: operativa y servicio se parten; administrativa, control y apoyo, una persona por ejecución; coordinación, una sola; ocasional y no planificada, reserva; sin tipo, la más prudente", () => {
    const want: Record<ActivityTypeKey, string> = { operational: "split", service: "split", administrative: "by_execution", control: "by_execution", support: "by_execution", coordination: "single", occasional: "reserve" };
    for (const t of ACTIVITY_TYPES) if (RULE_BY_TYPE[t] !== want[t] || ruleOf(t, "planned") !== want[t]) throw new Error(t);
    for (const t of ACTIVITY_TYPES) if (ruleOf(t, "unplanned") !== "reserve") throw new Error("la no planificada es reserva sea cual sea su tipo: " + t);
    if (ruleOf(null, "planned") !== "by_execution" || ruleOf(null, null) !== "by_execution") throw new Error("sin tipo");
  });

  await check("Las personas del reparto son SIEMPRE las de Dotación requerida (nunca más), en las dos semanas, aunque haya tareas que no se parten, coordinaciones y actividades a la vez", () => {
    const escenarios: [StaffingInput[], ActivityInput[], Record<string, ActivityTypeKey | null>][] = [
      [[staff("Cajero", 5, 44)], [act("A1", "Cajero", { hours: 3, executions: 30 }), act("C1", "Cajero", { hours: 2, executions: 1, period: "day" }), act("S1", "Cajero", { hours: 1, simultaneous: 2, executions: 4 }), act("P1", "Cajero", { hours: 0.5, scope: "per_employee", period: "day" })], { A1: "administrative", C1: "coordination", S1: "control", P1: "service" }],
      [[staff("Cajero", 3, 40)], [act("A1", "Cajero", { hours: 5, executions: 14 }), act("A2", "Cajero", { hours: 4, executions: 9 })], { A1: "administrative", A2: "support" }],
      [[staff("Cajero", 6, 48)], [act("A1", "Cajero", { hours: 7, executions: 40 }), act("A2", "Cajero", { hours: 1.5, executions: 3, period: "day" })], { A1: "coordination", A2: "operational" }],
    ];
    for (const [st, ac, types] of escenarios) {
      const r = run(st, ac, types), s = one(r), { common, periodic } = ok(s);
      if (common.people !== r.required() || periodic.people !== r.required() || s.required !== r.required()) throw new Error(`Dotación ${r.required()}, común ${common.people}, periódica ${periodic.people}`);
      if (common.overflowHours > 1e-6) throw new Error("la semana común debía caber con las personas de Dotación: " + common.overflowHours);
    }
  });

  await check("Reparte EXACTAMENTE las horas de Cálculo de tiempos, también cuando las personas necesarias no son los ocupantes de hoy (actividades por colaborador incluidas)", () => {
    // 2 ocupantes × 40 h; A1 del cargo 10 × 3 h = 30 h; A2 por colaborador 1 h diaria × 6 días = 6 h por ocupante → motor: 30 + 2 × 6 = 42 h → 2 personas
    const igual = run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 3, executions: 10 }), act("A2", "Cajero", { hours: 1, scope: "per_employee", period: "day" })], { A1: "administrative", A2: "operational" });
    const a = ok(one(igual)).common;
    if (a.people !== 2 || !near(igual.hours(), 42) || !near(a.assignedHours, 42)) throw new Error(`personas ${a.people}, motor ${igual.hours()}, repartido ${a.assignedHours}`);
    // 2 ocupantes pero se necesitan 3: 80 h del cargo + 2 h diarias por colaborador (12 h × 2 ocupantes = 24 h) = 104 h; el reparto usa 3 personas y sigue sumando 104 h
    const distinto = run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 2, executions: 40 }), act("A2", "Cajero", { hours: 2, scope: "per_employee", period: "day" })], { A1: "operational", A2: "operational" });
    const b = ok(one(distinto)).common;
    if (b.people !== 3 || !near(distinto.hours(), 104) || !near(b.assignedHours, 104) || !near(sum(minutesOf(b, "A2")), 24 * 60)) throw new Error(`personas ${b.people}, motor ${distinto.hours()}, repartido ${b.assignedHours}`);
  });

  await check("Nadie pasa su capacidad diaria ni semanal (con la sobrecarga aceptada) y el reparto nivela: todas las personas quedan con tiempo parejo", () => {
    for (const overload of [1, 1.08]) {
      const r = run([staff("Cajero", 3, 48)], [act("A1", "Cajero", { hours: 1, executions: 60 }), act("A2", "Cajero", { hours: 0.5, executions: 4, period: "day" })], { A1: "operational", A2: "service" }, MON_SAT, {}, overload);
      const { common } = ok(one(r)); const cw = 48 * 0.9, cd = cw / 6;
      for (const row of common.grid) {
        for (const c of row) if (c.totalMin > cd * overload * 60 + 1e-6) throw new Error(`día ${c.totalMin} > ${cd * overload * 60}`);
        if (weekOf(row) > cw * overload * 60 + 1e-6) throw new Error("semana");
      }
      const semanas = common.grid.map(weekOf);
      if (Math.max(...semanas) - Math.min(...semanas) > 60 + 1e-6) throw new Error("debía quedar parejo (±1 h): " + semanas.map((x) => Math.round(x)).join(","));
      if (common.overflowHours > 1e-6) throw new Error("sobra " + common.overflowHours);
    }
  });

  await check("Tolerancia: con 5,2 personas de trabajo y umbral de sobrecarga de 105 % se necesitan 5 (no 6) y el reparto las deja al 104 %; con 100 % serían 6", () => {
    const st = [staff("Cajero", 6, 40)], ac = [act("A1", "Cajero", { hours: 2.4, executions: 78 })], types = { A1: "administrative" as const }; // 187,2 h ÷ 36 h = 5,2
    const estricto = run(st, ac, types), tolerante = run(st, ac, types, MON_SAT, {}, 1.05);
    if (estricto.required() !== 6 || tolerante.required() !== 5) throw new Error(`${estricto.required()} / ${tolerante.required()}`);
    const { common } = ok(one(tolerante));
    if (common.people !== 5 || !near(common.utilization, 187.2 / 180) || common.grid.some((row) => weekOf(row) > 36 * 1.05 * 60 + 1e-6) || common.overflowHours > 1e-6) throw new Error(JSON.stringify({ p: common.people, u: common.utilization, o: common.overflowHours }));
    const menor = run(st, ac, types, MON_SAT, {}, 0.8);
    if (menor.required() !== 6) throw new Error("un umbral menor que 100 % se trata como 100 %: " + menor.required());
  });

  await check("Disponibilidad sin tareas: cuando hay más capacidad que trabajo se dice cuánto sobra (no se esconde ni se inventa trabajo); si la carga la pasa, no sobra nada", () => {
    const r = run([staff("Cajero", 3, 40)], [act("A1", "Cajero", { hours: 2, executions: 40 })], { A1: "operational" }); // 80 h ÷ 36 h = 2,2 → 3 personas (108 h útiles)
    const { common } = ok(one(r));
    if (common.people !== 3 || !near(common.freeHours, 108 - 80) || !near(common.utilization, 80 / 108)) throw new Error(JSON.stringify({ p: common.people, f: common.freeHours, u: common.utilization }));
    const tight = run([staff("Cajero", 3, 40)], [act("A1", "Cajero", { hours: 2, executions: 54 })], { A1: "operational" }, MON_SAT, {}, 1.05); // 108 h = 100 % de 3 personas
    if (ok(one(tight)).common.freeHours > 1e-6) throw new Error("sin sobrante cuando la carga llena la capacidad");
  });

  await check("Coordinación: una sola persona responsable; si en un día no cabe entera con su jornada se comparte lo mínimo y se marca (el número de personas no cambia)", () => {
    const cabe = ok(one(run([staff("Cajero", 3, 48)], [act("C1", "Cajero", { hours: 1, executions: 1, period: "day" }), act("A1", "Cajero", { hours: 3, executions: 30 })], { C1: "coordination", A1: "administrative" }))).common;
    const a = cabe.activities.find((x) => x.code === "C1")!;
    if (a.persons.length !== 1 || a.rule !== "single" || a.shared || !near(sum(minutesOf(cabe, "C1")), 6 * 60)) throw new Error(JSON.stringify(a));
    // 10 h diarias de coordinación: una persona solo tiene 7,2 h al día → se comparte entre personas y se marca; sigue siendo la dotación de siempre
    const r = run([staff("Cajero", 2, 48)], [act("C1", "Cajero", { hours: 10, executions: 1, period: "day" })], { C1: "coordination" });
    const s = one(r), { common } = ok(s), c = common.activities.find((x) => x.code === "C1")!;
    if (common.people !== r.required() || !c.shared || c.persons.length < 2 || common.overflowHours > 1e-6 || !s.notes.some((n) => /compartieron entre personas: C1/.test(n))) throw new Error(JSON.stringify({ p: common.people, c, o: common.overflowHours, n: s.notes }));
    if (!near(sum(minutesOf(common, "C1")), 60 * 60)) throw new Error("las 60 h se conservan");
  });

  await check("Administrativa/Control/Apoyo: cada ejecución la hace una sola persona (nunca partida) y las ejecuciones se reparten entre personas", () => {
    for (const t of ["administrative", "control", "support"] as const) {
      const r = run([staff("Cajero", 4, 48)], [act("A1", "Cajero", { hours: 3, executions: 30, period: "week" })], { A1: t }); // 90 h: Dotación pide 3 personas
      const { common } = ok(one(r)); const m = minutesOf(common, "A1").flat().filter((x) => x > 1e-9);
      if (m.some((x) => !near(x % 180, 0) && !near((x % 180), 180))) throw new Error(`${t}: una ejecución quedó partida: ${m}`);
      if (new Set(common.activities.find((x) => x.code === "A1")!.persons).size < 2) throw new Error(`${t}: debía repartir las ejecuciones entre varias personas`);
    }
  });

  await check("Operativa/Servicio por unidad: se parte entre personas cuando no cabe en una; por evento la ejecución no se parte y, si no cabe entera, se comparte lo mínimo y se marca", () => {
    // jornada diaria de 4 h (3,6 h útiles): 6 unidades de 1 h en una ejecución no caben en una persona; A0 hace que Dotación pida 2 personas
    const base = act("A0", "Cajero", { hours: 1, executions: 30 });
    const unit = act("U1", "Cajero", { hours: 1, calcMode: "per_unit", unitsPerExecution: 6, executions: 1, period: "week" });
    const { common } = ok(one(run([staff("Cajero", 2, 24)], [base, unit], { A0: "administrative", U1: "operational" }, MON_SAT, { dailyWorkHours: 4 })));
    const u = common.activities.find((x) => x.code === "U1")!;
    if (common.people !== 2 || u.persons.length !== 2 || common.overflowHours > 1e-6 || !near(u.weekMinutes, 360)) throw new Error("debía partirse entre las dos personas: " + JSON.stringify(u));
    const ev = act("E1", "Cajero", { hours: 6, executions: 1, period: "week" });
    const e = ok(one(run([staff("Cajero", 2, 24)], [base, ev], { A0: "administrative", E1: "operational" }, MON_SAT, { dailyWorkHours: 4 }))).common;
    const e1 = e.activities.find((x) => x.code === "E1")!;
    if (!near(e1.weekMinutes, 360) || !e1.shared || e.overflowHours > 1e-6) throw new Error("las 6 h del evento se conservan y, como no caben enteras, se marcan como compartidas: " + JSON.stringify(e1));
  });

  await check("Lo que hace cada colaborador se reparte entre las personas sin perder horas (ocupantes × tiempo de cada uno) y el total de cada persona queda parejo", () => {
    const r = run([staff("Cajero", 3, 48)], [act("P1", "Cajero", { hours: 0.5, scope: "per_employee", period: "day" }), act("A1", "Cajero", { hours: 3, executions: 30 })], { P1: "operational", A1: "administrative" });
    const { common } = ok(one(r)); const a = common.activities.find((x) => x.code === "P1")!;
    if (!a.perEmployee || !near(a.weekMinutes, 3 * 6 * 30)) throw new Error(JSON.stringify(a)); // 3 ocupantes × 6 días × 30 min
    const semanas = common.grid.map(weekOf); // lo pequeño va a quien más margen tiene: al final todas quedan con tiempo parejo
    if (Math.max(...semanas) - Math.min(...semanas) > 180 + 1e-6) throw new Error("debía quedar parejo: " + semanas.map((x) => Math.round(x)).join(","));
  });

  await check("Exige varias personas a la vez: se asignan juntas, el mismo día y con los mismos minutos; si no hay tantas personas, se comparte lo mínimo y se marca", () => {
    const r = run([staff("Cajero", 3, 48)], [act("A0", "Cajero", { hours: 3, executions: 20 }), act("S1", "Cajero", { hours: 1, simultaneous: 2, executions: 1, period: "week" })], { A0: "administrative", S1: "administrative" });
    const { common } = ok(one(r)); const m = minutesOf(common, "S1");
    const dias = common.grid[0].map((_, d) => m.filter((row) => row[d] > 1e-9).length);
    if (common.people < 2 || dias.filter((x) => x === 2).length !== 1 || dias.some((x) => x !== 0 && x !== 2)) throw new Error("debían ser 2 personas el mismo día: " + dias);
    if (!near(sum(m), 2 * 60)) throw new Error("2 personas × 1 h");
    const una = run([staff("Cajero", 1, 12)], [act("S2", "Cajero", { hours: 1, simultaneous: 3, executions: 1, period: "week" })], { S2: "administrative" });
    const u = ok(one(una)).common;
    if (u.people !== una.required() || !u.activities[0].shared || !near(sum(minutesOf(u, "S2")), 3 * 60)) throw new Error(JSON.stringify({ p: u.people, a: u.activities[0] }));
  });

  await check("Reserva: lo ocasional o no planificado no se programa como actividad; se acomoda al final en lo que sobra, nivelando las horas de quienes la reciben, y no se pierde ningún minuto", () => {
    const r = run([staff("Cajero", 2, 40)], [act("R1", "Cajero", { hours: 3, executions: 2, period: "week", planning: "unplanned" }), act("R2", "Cajero", { hours: 1, executions: 2 }), act("O1", "Cajero", { hours: 1, executions: 1 })], { R1: "operational", R2: "operational", O1: "occasional" });
    const { common } = ok(one(r)); const celdas = common.grid.flat();
    if (common.activities.some((x) => x.code === "R1" || x.code === "O1")) throw new Error("la reserva no es una actividad programada");
    const conReserva = celdas.filter((c) => c.reserveMin > 1e-6);
    if (!near(celdas.reduce((s, c) => s + c.reserveMin, 0), (6 + 1) * 60)) throw new Error("reserva: " + celdas.map((c) => c.reserveMin).join(","));
    if (conReserva.length === 0 || !conReserva.every((c) => near(c.totalMin, conReserva[0].totalMin, 1e-6))) throw new Error("la reserva debe nivelar: " + conReserva.map((c) => c.totalMin).join(","));
    if (celdas.some((c) => c.reserveMin <= 1e-6 && c.totalMin < conReserva[0].totalMin - 1e-6)) throw new Error("quien no recibe reserva no debe quedar más bajo que quien la recibe");
  });

  await check("Semana con periódicas: lo mensual, trimestral y anual NO está en la semana común y SÍ en la otra; las personas son las mismas y, si la carga no cabe, se pide refuerzo", () => {
    const r = run([staff("Cajero", 2, 40)], [act("D1", "Cajero", { hours: 1, executions: 2, period: "day" }), act("M1", "Cajero", { hours: 4, executions: 1, period: "month" }), act("T1", "Cajero", { hours: 2, executions: 3, period: "quarter" }), act("Y1", "Cajero", { hours: 5, executions: 1, period: "year" })], { D1: "operational", M1: "administrative", T1: "control", Y1: "support" });
    const { common, periodic } = ok(one(r));
    for (const c of ["M1", "T1", "Y1"]) { if (sum(minutesOf(common, c)) > 0) throw new Error(c + " en la semana común"); }
    if (!near(sum(minutesOf(periodic, "M1")), 4 * 60) || !near(sum(minutesOf(periodic, "T1")), 6 * 60) || !near(sum(minutesOf(periodic, "Y1")), 5 * 60)) throw new Error("periódicas: todas las ejecuciones del período en esa semana");
    if (!near(sum(minutesOf(periodic, "D1")), sum(minutesOf(common, "D1")))) throw new Error("lo diario debía ser igual en las dos semanas");
    if (periodic.people !== common.people || periodic.assignedHours <= common.assignedHours) throw new Error("mismas personas y más trabajo en la semana con periódicas");
    const pesada = run([staff("Cajero", 1, 40)], [act("D1", "Cajero", { hours: 1, executions: 5, period: "week" }), act("M1", "Cajero", { hours: 50, executions: 1, period: "month" })], { D1: "operational", M1: "operational" });
    const s = one(pesada), w = ok(s);
    if (w.periodic.people !== w.common.people || w.periodic.extraPeople < 1 || !s.notes.some((n) => /refuerzo/.test(n)) || w.common.extraPeople !== 0) throw new Error(`refuerzo ${w.periodic.extraPeople}; notas ${s.notes}`);
  });

  await check("Los minutos no se pierden ni se inventan con ejecuciones fraccionarias (2,5 por semana)", () => {
    const r = run([staff("Cajero", 2, 40)], [act("F1", "Cajero", { hours: 2, executions: 2.5, period: "week" })], { F1: "operational" });
    if (!near(sum(minutesOf(ok(one(r)).common, "F1")), 5 * 60)) throw new Error("2,5 × 2 h = 5 h");
  });

  await check("Una actividad compartida entre dos cargos aporta a cada uno su parte (60 % / 40 %) en el reparto", () => {
    const r = run([staff("Cajero", 2, 40), staff("Auxiliar", 2, 40)], [act("C1", "Cajero", { hours: 1, executions: 10, period: "week", loadShare: 0.6, secondaryPosition: "Auxiliar" })], { C1: "operational" });
    const a = ok(one(r, "Cajero")).common, b = ok(one(r, "Auxiliar")).common;
    if (!near(sum(minutesOf(a, "C1")), 6 * 60) || !near(sum(minutesOf(b, "C1")), 4 * 60)) throw new Error(`${sum(minutesOf(a, "C1"))} / ${sum(minutesOf(b, "C1"))}`);
  });

  await check("El reparto es determinista: los mismos datos dan exactamente el mismo resultado", () => {
    const go = () => JSON.stringify(run([staff("Cajero", 3, 44)], [act("A1", "Cajero", { hours: 1.5, executions: 7 }), act("A2", "Cajero", { hours: 0.25, executions: 3, period: "day" }), act("A3", "Cajero", { hours: 2, executions: 1, period: "month" })], { A1: "administrative", A2: "service", A3: "coordination" }).schedules);
    if (go() !== go()) throw new Error("dos ejecuciones difieren");
  });

  await check("Sin turnos no se inventan días; sin dotación o sin actividades completas no hay reparto; se dice por qué", () => {
    const sinTurnos = one(run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 5 })], {}, []));
    if (sinTurnos.state !== "noshifts" || sinTurnos.common !== null || !/turnos/.test(sinTurnos.reason) || sinTurnos.required === null) throw new Error(JSON.stringify(sinTurnos));
    const sinDotacion = one(run([], [act("A1", "Cajero", { hours: 5 })]));
    const incompleta = one(run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: null })]));
    for (const s of [sinDotacion, incompleta]) if (s.state !== "nodata" || s.common !== null || s.reason === "") throw new Error(s.state + " " + s.reason);
  });

  await check("Las actividades con datos incompletos no entran y se avisa; las sin tipo se reparten con la regla prudente y se avisa", () => {
    const s = one(run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 2 }), act("A2", "Cajero", { hours: null }), act("A3", "Cajero", { hours: 1 })], { A1: "operational", A3: null }));
    if (!s.notes.some((n) => /incompletos/.test(n)) || !s.notes.some((n) => /sin tipo/.test(n))) throw new Error(s.notes.join(" | "));
    const a3 = ok(s).common.activities.find((x) => x.code === "A3")!;
    if (a3.rule !== "by_execution") throw new Error(a3.rule);
  });

  await check("Los días del reparto son los de los turnos (unión de todos); si no coinciden con los días de Parámetros se avisa, y las horas siguen siendo las de Cálculo", () => {
    const r = run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 1, executions: 4 })], {}, [0, 2, 4]);
    const s = one(r);
    if (s.days.join() !== "0,2,4" || ok(s).common.grid[0].length !== 3 || !s.notes.some((n) => /3 días por sus turnos/.test(n)) || !near(ok(s).common.assignedHours, r.hours())) throw new Error(s.days + " | " + s.notes);
  });

  await check("Orden sugerido del día (sin horas): primero lo diario, luego lo semanal y lo periódico, al final los imprevistos; dentro de cada grupo por código; cada tarea trae su nombre y su tiempo", () => {
    const t = orderedTasks([{ code: "B2", name: "Semanal", minutes: 60, rank: 1 }, { code: "A1", name: "Diaria", minutes: 120, rank: 0 }, { code: "A0", name: "Otra diaria", minutes: 30, rank: 0 }, { code: "Z9", name: "Periódica", minutes: 45, rank: 2 }], 30);
    if (t.map((x) => x.code).join() !== "A0,A1,B2,Z9,Imprevistos" || t.map((x) => x.kind).join() !== "task,task,task,task,reserve") throw new Error(t.map((x) => x.code).join());
    if (t[1].name !== "Diaria" || t[1].minutes !== 120 || t[4].minutes !== 30) throw new Error("nombre y tiempo");
    if (Object.keys(t[0]).sort().join() !== "code,kind,minutes,name") throw new Error("no debe haber horas ni descansos: " + Object.keys(t[0]));
    if (orderedTasks([], 0.2).length !== 0 || orderedTasks([], 30).length !== 1) throw new Error("imprevistos mínimos");
  });

  await check("Cambiar el orden: sube o baja una tarea, no hace nada en los extremos y nunca modifica la lista recibida (el cambio es solo de la vista)", () => {
    const base = ["A", "B", "C", "D"] as const;
    const j = (xs: readonly string[]) => xs.join("");
    if (j(moveTask(base, 1, -1)) !== "BACD" || j(moveTask(base, 1, 1)) !== "ACBD" || j(moveTask(base, 0, 1)) !== "BACD" || j(moveTask(base, 3, -1)) !== "ABDC") throw new Error("mover");
    if (j(moveTask(base, 0, -1)) !== "ABCD" || j(moveTask(base, 3, 1)) !== "ABCD" || j(moveTask(base, -1, 1)) !== "ABCD" || j(moveTask(base, 9, -1)) !== "ABCD") throw new Error("extremos");
    if (j(base) !== "ABCD") throw new Error("la lista original no debe cambiar");
    let xs: readonly string[] = base; for (const [i, d] of [[0, 1], [1, 1], [2, 1], [3, -1]] as const) xs = moveTask(xs, i, d);
    if ([...xs].sort().join("") !== "ABCD") throw new Error("mover nunca pierde ni duplica tareas");
  });

  await check("Orden guardado (D-104): se aplica por código, lo nuevo queda al final en su orden sugerido, lo que ya no existe se ignora, vacío = sugerido y la lista original no se modifica", () => {
    const tareas = [{ code: "A1" }, { code: "A2" }, { code: "B1" }, { code: "Imprevistos" }];
    const j = (xs: readonly { code: string }[]) => xs.map((t) => t.code).join();
    if (j(applyOrder(tareas, ["B1", "A1"])) !== "B1,A1,A2,Imprevistos") throw new Error("lo guardado primero y lo nuevo al final: " + j(applyOrder(tareas, ["B1", "A1"])));
    if (j(applyOrder(tareas, ["Z9", "A2", "ya-no-existe", "A1", "B1", "Imprevistos"])) !== "A2,A1,B1,Imprevistos") throw new Error("lo que ya no existe se ignora");
    if (j(applyOrder(tareas, [])) !== "A1,A2,B1,Imprevistos" || j(applyOrder(tareas, null)) !== "A1,A2,B1,Imprevistos" || j(applyOrder(tareas, undefined)) !== "A1,A2,B1,Imprevistos") throw new Error("vacío = sugerido");
    if (j(applyOrder(tareas, ["Imprevistos"])) !== "Imprevistos,A1,A2,B1") throw new Error("un solo código guardado");
    if (j(tareas) !== "A1,A2,B1,Imprevistos") throw new Error("no debe modificar la lista original");
    if (applyOrder(tareas, ["B1"]).some((t, i) => t !== (applyOrder(tareas, ["B1"])[i]))) throw new Error("estable");
    const guardado = applyOrder(tareas, ["B1", "A2"]); if ([...guardado].map((t) => t.code).sort().join() !== "A1,A2,B1,Imprevistos") throw new Error("nunca pierde ni duplica tareas");
  });

  await check("Los órdenes guardados se ponen en la celda exacta (cargo, semana, persona y día de la semana) y no alteran tiempos, totales ni el reparto", () => {
    const r = run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 1, executions: 6, period: "day" }), act("A2", "Cajero", { hours: 0.5, executions: 6, period: "day" })], { A1: "administrative", A2: "operational" });
    const sch = one(r); const antes = JSON.stringify(ok(sch).common.grid.map((row) => row.map((c) => [c.totalMin, c.items])));
    const key = sch.key, miercoles = sch.days.indexOf(2);
    const guardados = new Map<string, SavedOrder>([[orderKey(key, "common", 1, 2), { codes: ["A2", "A1"], at: "2026-11-06T18:00:00.000Z" }], [orderKey(key, "periodic", 1, 2), { codes: ["A1"], at: "2026-11-06T18:00:00.000Z" }]]);
    attachSavedOrders([sch], guardados);
    const w = ok(sch);
    if (w.common.grid[0][miercoles].saved?.codes.join() !== "A2,A1" || w.periodic.grid[0][miercoles].saved?.codes.join() !== "A1") throw new Error("debía quedar en la celda de la persona 1 del miércoles");
    const otras = w.common.grid.flatMap((row, p) => row.map((c, d) => [p, d, c.saved] as const)).filter(([p, d]) => !(p === 0 && d === miercoles));
    if (otras.some(([, , sv]) => sv !== null)) throw new Error("solo esa celda debía tener orden guardado");
    if (JSON.stringify(w.common.grid.map((row) => row.map((c) => [c.totalMin, c.items]))) !== antes) throw new Error("guardar el orden no debe cambiar tiempos ni totales");
    if (JSON.stringify(w.common.grid[0][miercoles].tasks.map((t) => t.code)) !== JSON.stringify(["A1", "A2"])) throw new Error("las tareas siguen en el orden sugerido; el guardado va aparte");
    if (attachSavedOrders([sch], new Map()) .length !== 1) throw new Error("sin órdenes no hace nada");
  });

  await check("La exportación sigue el orden guardado y, sin él, el sugerido", () => {
    const st = [staff("Cajero", 2, 40)], ac = [act("A1", "Cajero", { hours: 1, executions: 6, period: "day" }), act("A2", "Cajero", { hours: 0.5, executions: 6, period: "day" })];
    const p = prm(), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: "operational" }]));
    const shiftDays = new Map([[positionKey("real", "Cajas", "CO1", "Cajero"), MON_SAT]]);
    const sch = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays });
    const lunes = (rows: { person: string; day: string; code: string; order: number; week: string }[]) => rows.filter((r) => r.person === "Persona 1" && r.day === "Lunes" && r.week === "Semana común").sort((x, y) => x.order - y.order).map((r) => r.code).join();
    const filas = () => tablesFor("reparto", a, null as never, [], {}, "all", 0.1, undefined, sch).tables[0].rows as { person: string; day: string; code: string; order: number; week: string }[];
    if (lunes(filas()) !== "A1,A2") throw new Error("sin guardado: " + lunes(filas()));
    attachSavedOrders(sch, new Map([[orderKey(sch[0].key, "common", 1, 0), { codes: ["A2", "A1"], at: "2026-11-06T18:00:00.000Z" }]]));
    if (lunes(filas()) !== "A2,A1") throw new Error("con guardado: " + lunes(filas()));
  });

  await check("Cada celda trae sus tareas en orden, con el mismo total del día, y el reparto no trae horas del día", () => {
    const r = run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 1, executions: 10 }), act("D1", "Cajero", { hours: 0.5, executions: 1, period: "day" }), act("R1", "Cajero", { hours: 2, executions: 1, planning: "unplanned" })], { A1: "administrative", D1: "operational", R1: "operational" });
    const { common } = ok(one(r));
    for (const row of common.grid) for (const c of row) {
      const trabajo = c.tasks.reduce((s, x) => s + x.minutes, 0);
      if (!near(trabajo, c.totalMin) || c.tasks.filter((x) => x.kind === "task").length !== c.items.length) throw new Error("las tareas no coinciden con la celda");
      const ranks = c.tasks.map((x) => x.kind === "reserve" ? 9 : c.items.find((i) => i.code === x.code)!.rank);
      if (ranks.some((x, i) => i > 0 && x < ranks[i - 1])) throw new Error("orden: lo diario primero, los imprevistos al final");
      if (JSON.stringify(c).includes("startClock") || JSON.stringify(c).includes("\"from\"")) throw new Error("no hay horas del día");
    }
  });

  await check("Propiedad con 400 cargos al azar (siempre los mismos): las personas son las de Dotación, la semana común repartida suma exactamente las horas de Cálculo, nadie pasa la capacidad aceptada, no sobra ninguna hora y las tareas de cada día suman el total de su celda", () => {
    let seed = 20261106;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const TIPOS: (ActivityTypeKey | null)[] = [...ACTIVITY_TYPES, null];
    let conReparto = 0;
    for (let caso = 0; caso < 400; caso++) {
      const ocupantes = 1 + Math.floor(rnd() * 8), jornada = pick([36, 40, 44, 48]), overload = pick([1, 1, 1.05, 1.1]);
      const dias = pick([[0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5, 6], [0, 2, 4]]);
      const types: Record<string, ActivityTypeKey | null> = {};
      const ac = Array.from({ length: 1 + Math.floor(rnd() * 7) }, (_, i) => {
        const code = `P${i}`; types[code] = pick(TIPOS);
        const period = pick(["day", "day", "week", "week", "month", "quarter"] as const);
        const per = period === "day" ? 1 + Math.floor(rnd() * 4) : period === "week" ? 1 + Math.floor(rnd() * 20) : 1 + Math.floor(rnd() * 3);
        return act(code, "Cajero", { hours: pick([0.25, 0.5, 1, 1.5, 2, 3, 6]), executions: per, period, scope: rnd() < 0.3 ? "per_employee" : "position_total", simultaneous: rnd() < 0.15 ? 2 : null,
          planning: rnd() < 0.1 ? "unplanned" : "planned", calcMode: rnd() < 0.2 ? "per_unit" : "per_event", unitsPerExecution: 1 + Math.floor(rnd() * 5) });
      });
      const st = [staff("Cajero", ocupantes, jornada)], p = prm({ dailyWorkHours: rnd() < 0.4 ? pick([6, 8]) : null });
      const r = run(st, ac, types, dias, { dailyWorkHours: p.dailyWorkHours }, overload);
      const sch = one(r);
      if (sch.state !== "ok") continue;
      conReparto++;
      const { common, periodic } = ok(sch), nota = `caso ${caso} ${JSON.stringify({ ocupantes, jornada, overload, dias: dias.length, dailyWorkHours: p.dailyWorkHours, acts: ac.map((x) => [x.code, types[x.code], x.period, x.executions, x.timeAvgMin, x.scope, x.simultaneous, x.planning, x.calcMode, x.unitsPerExecution]) })}`;
      if (common.people !== r.required() || periodic.people !== r.required()) throw new Error(`${nota}: personas ${common.people}/${periodic.people} ≠ Dotación ${r.required()}`);
      // horas de Cálculo de lo que se programa en la semana común (diario y semanal, sin la reserva)
      const staffRows = st, prmx = prm({ dailyWorkHours: p.dailyWorkHours });
      const esperado = ac.filter((x) => (x.period === "day" || x.period === "week") && x.planning === "planned" && types[x.code] !== "occasional").reduce((t, x) => t + (computeActivity(x, prmx, occupantsOf(staffRows, x), personDaysOf(staffRows, x, prmx)).hTotal ?? 0), 0);
      if (!near(common.assignedHours + common.overflowHours, esperado, 1e-6)) throw new Error(`${nota}: repartido ${common.assignedHours} + sin asignar ${common.overflowHours} ≠ Cálculo ${esperado}`);
      const cw = jornada * 0.9, W = workDaysOf(cw, dias.length, prmx), cd = Math.min(cw, p.dailyWorkHours ? Math.max(cw / W, p.dailyWorkHours * 0.9) : cw / W), hayDescanso = dias.length > W;
      for (const w of [common, periodic]) {
        if (!hayDescanso && w.overflowHours > 1e-6 && w.extraPeople < 1) throw new Error(`${nota}: ${w.kind}: horas que no caben sin pedir refuerzo; personas ${w.people}, no caben ${w.overflowHours}, asignado ${w.assignedHours}+${w.reserveHours}, capacidad ${w.capacityHours}, compartidas ${w.activities.filter((x) => x.shared).map((x) => x.code)}`);
        if (!hayDescanso && w.kind === "common" && w.overflowHours > 1e-6) throw new Error(`${nota}: en la semana común no debía sobrar nada (${w.overflowHours} h)`);
        for (const row of w.grid) {
          if (row.filter((c) => c.rest).length > dias.length - W || row.some((c) => c.rest && (c.totalMin > 0 || c.tasks.length > 0 || c.capacityMin !== 0))) throw new Error(`${nota}: cada persona descansa a lo más ${dias.length - W} día(s) y ese día no tiene tareas`);
          if (w.restMissing === 0 && row.filter((c) => c.rest).length !== dias.length - W) throw new Error(`${nota}: sin descansos pendientes, cada persona descansa exactamente ${dias.length - W} día(s)`);
          if (w.overflowHours <= 1e-6) { for (const c of row) if (c.totalMin > cd * overload * 60 + 1e-4) throw new Error(`${nota}: un día pasa la capacidad aceptada`); if (weekOf(row) > cw * overload * 60 + 1e-4) throw new Error(`${nota}: una semana pasa la capacidad aceptada`); }
          for (const c of row) if (Math.abs(c.tasks.reduce((s, x) => s + x.minutes, 0) - c.totalMin) > 0.5 + 1e-6) throw new Error(`${nota}: las tareas del día no suman el total de la celda`); // una reserva menor de medio minuto no se muestra como fila
        }
      }
    }
    if (conReparto < 300) throw new Error("la prueba debía cubrir al menos 300 cargos con reparto; cubrió " + conReparto);
  });

  await check("Descanso rotativo (D-108): con el cargo abierto 7 días y 42 h en 6 días, cada persona descansa exactamente 1 día, los descansos van primero al domingo, el día de descanso no tiene tareas y se reparten las mismas horas de Cálculo", () => {
    const st = [staff("Fiscal", 6, 42)], ac = [
      act("TES1", "Fiscal", { hours: 1, executions: 3, period: "day" }), act("CAJ1", "Fiscal", { hours: 0.75, executions: 5, period: "day" }),
      act("CAJ2", "Fiscal", { hours: 3, executions: 30, period: "week" }), act("COO1", "Fiscal", { hours: 0.5, executions: 1, period: "day" }),
    ];
    const types: Record<string, ActivityTypeKey | null> = { TES1: "control", CAJ1: "operational", CAJ2: "administrative", COO1: "coordination" };
    const r = run(st, ac, types, ALL_DAYS, { workDaysPerWeek: 7, dailyWorkHours: 7, staffRoundFrom: 0.5 }, 1, new Map([["tes1", MON_SAT]]));
    const s = one(r, "Fiscal"), { common, periodic } = ok(s);
    for (const w of [common, periodic]) {
      for (const row of w.grid) {
        const libres = row.filter((c) => c.rest);
        if (libres.length !== 1) throw new Error("cada persona descansa 1 día; descansa " + libres.length);
        if (libres.some((c) => c.totalMin > 0 || c.tasks.length > 0 || c.capacityMin !== 0 || c.toleranceMin !== 0)) throw new Error("el día de descanso no tiene tareas ni jornada");
      }
      const dom = w.grid.filter((row) => row[6].rest).length;
      for (let d = 0; d < 6; d++) if (w.grid.filter((row) => row[d].rest).length > dom) throw new Error("el domingo debe concentrar los descansos");
      if (dom < Math.ceil(w.people / 2)) throw new Error("al menos la mitad descansa el domingo (así cada una tiene 2 domingos libres al mes); descansan " + dom);
    }
    if (!s.notes.some((n) => /descansa el otro/.test(n) && /rotan/.test(n) && /domingos al mes/.test(n))) throw new Error("falta la nota de rotación: " + s.notes.join(" | "));
    const esperado = ac.filter((x) => x.period === "day" || x.period === "week").reduce((t, x) => t + (computeActivity(x, prm({ workDaysPerWeek: 7, dailyWorkHours: 7 }), occupantsOf(st, x), personDaysOf(st, x, prm({ workDaysPerWeek: 7, dailyWorkHours: 7 }))).hTotal ?? 0), 0);
    if (!near(common.assignedHours + common.overflowHours, esperado, 1e-6)) throw new Error("repartido " + common.assignedHours + " ≠ Cálculo " + esperado);
  });

  await check("Días por actividad (D-108): una actividad con turnos de lunes a sábado nunca cae el domingo; sin turnos marcados cae en todos los días del cargo; la reserva y lo demás siguen igual", () => {
    const st = [staff("Fiscal", 4, 42)], ac = [act("TES1", "Fiscal", { hours: 1, executions: 2, period: "day" }), act("CAJ1", "Fiscal", { hours: 1, executions: 2, period: "day" }), act("SEM1", "Fiscal", { hours: 2, executions: 3, period: "week" })];
    const types: Record<string, ActivityTypeKey | null> = { TES1: "control", CAJ1: "operational", SEM1: "administrative" };
    const lim = ok(one(run(st, ac, types, ALL_DAYS, { workDaysPerWeek: 7, dailyWorkHours: 7 }, 1, new Map([["tes1", MON_SAT], ["sem1", MON_SAT]])), "Fiscal")).common;
    const libre = ok(one(run(st, ac, types, ALL_DAYS, { workDaysPerWeek: 7, dailyWorkHours: 7 }), "Fiscal")).common;
    if (sum(minutesOf(lim, "TES1").map((row) => [row[6]])) !== 0 || sum(minutesOf(lim, "SEM1").map((row) => [row[6]])) !== 0) throw new Error("lo de lunes a sábado cayó en domingo");
    if (sum(minutesOf(lim, "CAJ1").map((row) => [row[6]])) <= 0) throw new Error("CAJ1 sin turnos marcados debe caer también el domingo");
    if (sum(minutesOf(libre, "TES1").map((row) => [row[6]])) <= 0) throw new Error("sin turnos marcados, la actividad cae todos los días");
    if (!near(sum(minutesOf(lim, "TES1")), sum(minutesOf(libre, "TES1")))) throw new Error("las horas de la actividad no deben cambiar, solo en qué días caen");
  });

  await check("Cobertura del descanso (D-108): con una sola persona en un cargo de 7 días no se concede un descanso que dejaría días sin nadie, y se avisa que hacen falta más personas; las tareas nunca caen en un día de descanso", () => {
    const st = [staff("Fiscal", 1, 42)], ac = [act("CAJ1", "Fiscal", { hours: 0.5, executions: 2, period: "day" })];
    const s = one(run(st, ac, { CAJ1: "operational" }, ALL_DAYS, { workDaysPerWeek: 7, dailyWorkHours: 7 }), "Fiscal"), { common } = ok(s);
    if (common.people !== 1 || common.restMissing !== 1) throw new Error("debía faltar 1 descanso: " + common.restMissing);
    if (common.grid[0].some((c) => c.rest)) throw new Error("no debía haber descanso con una sola persona");
    if (!s.notes.some((n) => /No se pudo dar un descanso/.test(n) && /más personas/.test(n))) throw new Error("falta el aviso: " + s.notes.join(" | "));
  });

  await check("Regla de redondeo (D-108): 5,0 a 5,4 son 5 y desde 5,5 son 6; con 0 siempre hacia arriba; con 1 solo sube la carga entera; la sobrecarga aceptada se descuenta antes", () => {
    const f = (x: number, over = 1, from = 0) => roundUpPeople(x, over, from);
    const casos: [number, number][] = [[5, 5], [5.0000001, 5], [5.2, 5], [5.4, 5], [5.49, 5], [5.5, 6], [5.6, 6], [5.99, 6], [0.3, 0], [0.5, 1]];
    for (const [x, esperadas] of casos) if (f(x, 1, 0.5) !== esperadas) throw new Error(x + " con 0,5 → " + f(x, 1, 0.5) + " ≠ " + esperadas);
    if (f(5.2) !== 6 || f(5.01, 1, 0) !== 6 || f(5, 1, 0) !== 5) throw new Error("con 0 siempre hacia arriba");
    if (f(5.9, 1, 1) !== 5 || f(6, 1, 1) !== 6) throw new Error("con 1 nunca sube por la fracción");
    if (f(5.2, 1.05, 0.5) !== 5 || f(5.7, 1.05, 0.5) !== 5 || f(5.6, 1, 0.5) !== 6) throw new Error("la sobrecarga se descuenta antes de redondear");
    if (f(5.2, 1, 5) !== 5 || f(5.2, 1, -1) !== 6) throw new Error("la fracción se limita entre 0 y 1");
  });

  await check("Dotación y Reparto usan la misma regla: con 5,2 personas de trabajo salen 5 (no 6), cada una queda sobre su jornada, el reparto lo acepta sin marcar sobrecarga y lo explica", () => {
    // 36 h útiles por persona; 187,2 h son 5,2 personas
    const st = [staff("Cajero", 6, 40)], ac = [act("A1", "Cajero", { hours: 3.6, executions: 52, period: "week" })];
    const r = run(st, ac, { A1: "operational" }, MON_SAT, { staffRoundFrom: 0.5 });
    const s = one(r), { common } = ok(s);
    if (s.required !== 5 || common.people !== 5) throw new Error("personas " + s.required + "/" + common.people);
    if (common.overflowHours > 1e-6 || common.extraPeople !== 0) throw new Error("el reparto debía aceptar la carga del redondeo: no caben " + common.overflowHours);
    if (!s.notes.some((n) => /104 %/.test(n) && /desde 50 %/.test(n))) throw new Error("falta la explicación del redondeo: " + s.notes.join(" | "));
    const sin = one(run(st, ac, { A1: "operational" }, MON_SAT, { staffRoundFrom: 0 }));
    if (sin.required !== 6) throw new Error("con 0 son 6: " + sin.required);
    const lectura = needOf(analyze(st, ac, prm({ staffRoundFrom: 0.5 }), TH, "all").positions[0], 1, 0.5).reading;
    if (!/104 %/.test(lectura)) throw new Error("la lectura de Dotación debe decir la carga: " + lectura);
  });

  await check("Exportación del reparto: el día de descanso sale como una fila «Descanso» (orden 0, 0 minutos) y la suma de minutos sigue siendo la de la pantalla", () => {
    const st = [staff("Fiscal", 3, 42)], ac = [act("CAJ1", "Fiscal", { hours: 1, executions: 6, period: "day" }), act("CAJ2", "Fiscal", { hours: 2, executions: 40, period: "week" })];
    const p = prm({ workDaysPerWeek: 7, dailyWorkHours: 7 }), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>([["caj1", { name: "Actividad CAJ1", type: "operational" }], ["caj2", { name: "Actividad CAJ2", type: "operational" }]]);
    const schedules = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays: new Map([[positionKey("real", "Cajas", "CO1", "Fiscal"), ALL_DAYS]]) });
    const { tables } = tablesFor("reparto", a, null as never, [], {}, "all", 0.1, undefined, schedules);
    const filas = tables[0].rows as { code: string; order: number; minutes: number; person: string }[];
    const descansos = filas.filter((x) => x.code === "Descanso");
    const esperados = schedules[0].common!.grid.flat().filter((c) => c.rest).length + schedules[0].periodic!.grid.flat().filter((c) => c.rest).length;
    if (descansos.length !== esperados || esperados === 0 || descansos.some((x) => x.order !== 0 || x.minutes !== 0)) throw new Error("filas de descanso " + descansos.length + " / " + esperados);
  });

  await check("Horarios compatibles y equilibrio (D-110): una persona puede tener apertura y tesorería el mismo día (se solapan) pero nunca apertura y cierre; el día queda parejo entre las personas; nadie pasa su jornada; y cada actividad queda en todos sus días", () => {
    const ALL = [0, 1, 2, 3, 4, 5, 6];
    const AP: ShiftRef = { id: "ap", name: "Apertura", days: ALL, start: "05:30", end: "13:00" }, TE: ShiftRef = { id: "te", name: "Tesorería", days: MON_SAT, start: "08:00", end: "15:30" };
    const IN: ShiftRef = { id: "in", name: "Intermedio", days: ALL, start: "09:00", end: "16:30" }, CI: ShiftRef = { id: "ci", name: "Cierre", days: MON_SAT, start: "13:00", end: "20:30" };
    const st = [staff("Fiscal", 6, 42)], ac = [
      act("APER", "Fiscal", { hours: 1, executions: 1, period: "day" }), act("TESO", "Fiscal", { hours: 1.5, executions: 2, period: "day" }), act("CIER", "Fiscal", { hours: 1, executions: 1, period: "day" }),
      act("CAJA", "Fiscal", { hours: 1, executions: 22, period: "day" }), act("ARQ1", "Fiscal", { hours: 0.5, executions: 4, period: "day" }), act("SEM1", "Fiscal", { hours: 3, executions: 5, period: "week" }), act("INT1", "Fiscal", { hours: 1, executions: 2, period: "day" }),
    ];
    const types: Record<string, ActivityTypeKey | null> = { APER: "control", TESO: "control", CIER: "control", CAJA: "operational", ARQ1: "operational", SEM1: "administrative", INT1: "operational" };
    const p = prm({ workDaysPerWeek: 7, dailyWorkHours: 7, staffRoundFrom: 0.5 }), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: "Actividad " + x.code, type: types[x.code] }]));
    const key = positionKey("real", "Cajas", "CO1", "Fiscal");
    const restricted = new Map<string, ShiftRef[] | null>([["aper", [AP]], ["teso", [TE]], ["cier", [CI]], ["int1", [IN]], ["arq1", [AP, IN]]]);
    const [sch] = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays: new Map([[key, ALL]]), activityShifts: restricted, positionShifts: new Map([[key, [AP, TE, IN, CI]]]) });
    const { common, periodic } = ok(sch);
    if (!sch.service || sch.service.start !== "05:30" || sch.service.end !== "20:30" || sch.service.hours !== 15) throw new Error("franja de atención: " + JSON.stringify(sch.service));
    const winOf = (code: string, weekday: number): [number, number] | null => {
      const u = restricted.get(code.toLowerCase())?.filter((x) => x.days.includes(weekday)); if (!u || u.length === 0) return null;
      const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      return [Math.min(...u.map((x) => m(x.start!))), Math.max(...u.map((x) => m(x.end!)))];
    };
    let conjuntas = 0;
    for (const w of [common, periodic]) {
      if (w.overflowHours > 1e-6) throw new Error("el escenario debía caber: sin asignar " + w.overflowHours + " h");
      w.grid.forEach((row) => row.forEach((c, d) => {
        if (c.rest) { if (c.shift !== null) throw new Error("el día de descanso no tiene franja"); return; }
        if (c.totalMin > c.toleranceMin + 1e-6) throw new Error("nadie pasa su jornada del día: " + c.totalMin + " > " + c.toleranceMin);
        const ws = c.items.map((i) => winOf(i.code, sch.days[d])).filter((x): x is [number, number] => !!x);
        for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
          const sh = Math.min(ws[i][1], ws[j][1]) - Math.max(ws[i][0], ws[j][0]);
          if (sh <= 0 || sh + 1e-9 < Math.min(180, ws[i][1] - ws[i][0], ws[j][1] - ws[j][0])) throw new Error("la celda junta horarios que no cuadran: " + c.items.map((x) => x.code).join(","));
        }
        const cs = c.items.map((i) => i.code);
        if (cs.includes("APER") && cs.includes("TESO")) conjuntas++;
        if (cs.includes("APER") && cs.includes("CIER")) throw new Error("apertura y cierre el mismo día en una persona");
        if (c.shift && sch.days[d] === 6 && /^1[3-9]/.test(c.shift)) throw new Error("«Cierre» (L–S) no aplica el domingo");
      }));
      // equilibrio: cada día, las horas de las personas que trabajan no se separan más de 2 h
      for (let d = 0; d < sch.days.length; d++) {
        const loads = w.grid.filter((row) => !row[d].rest).map((row) => row[d].totalMin / 60);
        if (loads.length > 1 && Math.max(...loads) - Math.min(...loads) > 2) throw new Error("día " + sch.days[d] + " desparejo: " + loads.map((x) => x.toFixed(1)).join(" / "));
      }
    }
    if (conjuntas === 0) throw new Error("apertura y tesorería (horarios que se solapan) debían poder ir a la misma persona");
    if (sch.check.some((c) => c.missingDays.length > 0)) throw new Error("actividades que no quedaron en sus días: " + sch.check.filter((c) => c.missingDays.length > 0).map((c) => c.code).join(","));
    const aper = sch.check.find((c) => c.code === "APER")!, teso = sch.check.find((c) => c.code === "TESO")!;
    if (aper.expectedDays.length !== 7 || teso.expectedDays.join() !== "0,1,2,3,4,5") throw new Error("días que corresponden: " + aper.expectedDays + " / " + teso.expectedDays);
    if (!sch.notes.some((n) => /comparten al menos 3 h/.test(n) && /no abre y cierra el mismo día/.test(n))) throw new Error("falta la nota de horarios: " + sch.notes.join(" | "));
    // las horas de cada actividad no cambian por tener turnos
    const sin = ok(buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays: new Map([[key, ALL]]) })[0]).common;
    for (const code of ["APER", "TESO", "CIER", "CAJA", "ARQ1", "INT1", "SEM1"]) if (!near(sum(minutesOf(common, code)), sum(minutesOf(sin, code)), 1e-6)) throw new Error("las horas de " + code + " no deben cambiar por los turnos");
    // la exportación trae la franja del día
    const { tables } = tablesFor("reparto", a, null as never, [], {}, "all", 0.1, undefined, [sch]);
    const filas = tables[0].rows as { code: string; shift: string }[];
    if (!tables[0].columns.some((c) => c.header === "Franja del día") || filas.filter((f) => f.code === "CIER").length === 0 || !filas.filter((f) => f.code === "CIER").every((f) => /^1[3-9]/.test(f.shift))) throw new Error("la exportación debe traer la franja del día");
  });

  await check("Sin asignar (D-110): con una persona y tareas de apertura y de cierre cada día, lo que no cabe queda en «Sin asignar», nadie pasa su jornada ni junta horarios opuestos, y la verificación dice qué actividad no quedó", () => {
    const ALL = [0, 1, 2, 3, 4, 5];
    const AP: ShiftRef = { id: "ap", name: "Apertura", days: ALL, start: "05:30", end: "13:00" }, CI: ShiftRef = { id: "ci", name: "Cierre", days: ALL, start: "13:00", end: "20:30" };
    const st = [staff("Fiscal", 1, 42)], ac = [act("APER", "Fiscal", { hours: 2, executions: 1, period: "day" }), act("CIER", "Fiscal", { hours: 2, executions: 1, period: "day" })];
    const p = prm({ workDaysPerWeek: 6, dailyWorkHours: 7 }), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: x.code, type: "control" as ActivityTypeKey }]));
    const key = positionKey("real", "Cajas", "CO1", "Fiscal");
    const [sch] = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays: new Map([[key, ALL]]), activityShifts: new Map<string, ShiftRef[] | null>([["aper", [AP]], ["cier", [CI]]]), positionShifts: new Map([[key, [AP, CI]]]) });
    const { common } = ok(sch);
    if (common.overflowHours <= 0) throw new Error("debía quedar algo sin asignar");
    if (common.grid[0].some((c) => c.totalMin > c.toleranceMin + 1e-6)) throw new Error("nadie pasa su jornada");
    if (common.grid[0].some((c) => c.items.some((i) => i.code === "APER") && c.items.some((i) => i.code === "CIER"))) throw new Error("apertura y cierre no van juntos");
    if (common.unassigned.reduce((t, u) => t + u.minutes, 0) / 60 < common.overflowHours - 1e-6) throw new Error("lo sin asignar debe sumar lo que no cupo");
    const faltan = sch.check.filter((c) => c.missingDays.length > 0);
    if (faltan.length === 0 || !sch.notes.some((n) => /SIN ASIGNAR/.test(n)) || !sch.notes.some((n) => /no (quedó|quedaron) en todos sus días/.test(n))) throw new Error("falta el aviso: " + sch.notes.join(" | "));
    // con el parámetro en 0 solo se exige que los horarios se solapen: apertura y cierre se tocan en un borde (13:00) y siguen sin poder juntarse
    const p0 = prm({ workDaysPerWeek: 6, dailyWorkHours: 7, minSharedHours: 0 });
    const [s0] = buildSchedules({ staff: st, acts: ac, params: p0, positions: analyze(st, ac, p0, TH, "all").positions, extras, shiftDays: new Map([[key, ALL]]), activityShifts: new Map<string, ShiftRef[] | null>([["aper", [AP]], ["cier", [CI]]]), positionShifts: new Map([[key, [AP, CI]]]) });
    if (ok(s0).common.grid[0].some((c) => c.items.some((i) => i.code === "APER") && c.items.some((i) => i.code === "CIER"))) throw new Error("con 0 h, un borde compartido no basta");
  });

  await check("Franja de atención: de la primera hora de inicio a la última de fin entre los turnos con horario; sin horarios no hay franja", () => {
    const sh = (id: string, start: string | null, end: string | null): ShiftRef => ({ id, name: id, days: [0], start, end });
    const f = serviceOf([sh("a", "05:30", "13:00"), sh("b", "13:00", "20:30"), sh("c", null, null)]);
    if (!f || f.start !== "05:30" || f.end !== "20:30" || f.hours !== 15) throw new Error(JSON.stringify(f));
    if (serviceOf([sh("c", null, null)]) !== null || serviceOf(undefined) !== null || serviceOf([]) !== null) throw new Error("sin horarios no hay franja");
    if (serviceOf([sh("n", "22:00", "06:00")]) !== null) throw new Error("un turno que cruza la medianoche no se considera");
  });

  await check("Cargo real de fiscales de caja y tesorería (30 actividades, 4 turnos): se reparte entre las 6 personas recomendadas sin dejar nada sin asignar, parejo por día y por semana, con todas las actividades en sus días y las de varios turnos repartidas entre la mañana y la tarde", () => {
    const ALL = [0, 1, 2, 3, 4, 5, 6];
    const AP: ShiftRef = { id: "ap", name: "Apertura", days: ALL, start: "05:30", end: "13:00" }, IN: ShiftRef = { id: "in", name: "Intermedio", days: ALL, start: "09:00", end: "16:30" };
    const CI: ShiftRef = { id: "ci", name: "Cierre", days: ALL, start: "13:00", end: "20:30" }, TI: ShiftRef = { id: "ti", name: "Tesorería integral", days: MON_SAT, start: "08:00", end: "15:30" };
    const ALL3 = [AP, IN, CI];
    // [código, tipo, veces por período, período, minutos, simultáneas, planeación, turnos] (tomado del estudio; sin datos de personas)
    const D: [string, ActivityTypeKey, number, "day" | "week" | "month", number, number, "planned" | "unplanned" | null, ShiftRef[] | null][] = [
      ["SUP-001", "operational", 2, "day", 15, 1, "planned", [AP]], ["SUP-002", "operational", 1, "day", 20, 1, "planned", [AP]], ["SUP-003", "operational", 5, "day", 10, 1, "planned", ALL3],
      ["SUP-004", "coordination", 2, "day", 30, 1, "planned", [AP, CI]], ["SUP-005", "service", 6, "day", 20, 1, "planned", [AP]], ["SUP-006", "service", 20, "day", 15, 1, "unplanned", ALL3],
      ["SUP-007", "service", 10, "day", 15, 1, "planned", ALL3], ["SUP-008", "operational", 5, "day", 10, 1, "planned", ALL3], ["SUP-009", "operational", 1, "day", 20, 1, "planned", null],
      ["SUP-010", "control", 4, "day", 5, 1, "planned", [AP, CI]], ["SUP-011", "control", 1, "day", 10, 1, "planned", ALL3], ["SUP-012", "coordination", 6, "day", 5, 1, "planned", ALL3],
      ["SUP-013", "administrative", 1, "day", 30, 1, "planned", [AP]], ["SUP-014", "occasional", 1, "week", 60, 1, "planned", [CI]], ["SUP-015", "operational", 5, "day", 60, 1, "planned", ALL3],
      ["SUP-016", "administrative", 2, "day", 45, 1, "planned", [CI]], ["SUP-017", "occasional", 1, "day", 10, 1, "unplanned", [CI]], ["SUP-018", "control", 2, "day", 10, 2, null, [TI]],
      ["SUP-019", "control", 1, "day", 15, 1, "planned", [TI]], ["SUP-020", "operational", 1, "day", 180, 1, "planned", [TI]], ["SUP-021", "operational", 1, "day", 15, 1, "planned", [TI]],
      ["SUP-022", "operational", 1, "day", 60, 1, "planned", [TI]], ["SUP-023", "control", 2, "day", 30, 1, "planned", [TI]], ["SUP-024", "administrative", 1, "day", 20, 1, "planned", [TI]],
      ["SUP-025", "administrative", 1, "day", 40, 1, "planned", [TI]], ["SUP-026", "operational", 2, "month", 40, 1, "planned", [TI]], ["SUP-027", "administrative", 1, "day", 15, 1, "planned", [TI]],
      ["SUP-028", "control", 6, "day", 10, 1, "planned", ALL3], ["SUP-029", "control", 1, "day", 10, 1, "planned", ALL3], ["SUP-030", "operational", 1, "month", 10, 1, "planned", [AP]],
    ];
    const st = [staff("Fiscal", 4, 42)], ac = D.map(([code, , n, period, min, sim, plan]) => act(code, "Fiscal", { hours: min / 60, executions: n, period, simultaneous: sim === 1 ? null : sim, planning: plan }));
    const p = prm({ workDaysPerWeek: 7, dailyWorkHours: 7, staffRoundFrom: 0.5, minSharedHours: 3 }), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(D.map(([code, tipo]) => [code.toLowerCase(), { name: code, type: tipo }]));
    const key = positionKey("real", "Cajas", "CO1", "Fiscal");
    const [sch] = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays: new Map([[key, ALL]]), activityShifts: new Map(D.map(([code, , , , , , , sh]) => [code.toLowerCase(), sh] as const)), positionShifts: new Map([[key, [AP, IN, CI, TI]]]), overload: 1 });
    const { common } = ok(sch);
    if (sch.required !== 6) throw new Error("el estudio recomienda 6 fiscales: " + sch.required);
    if (common.overflowHours > 1e-6) throw new Error("no debía quedar nada sin asignar (sobra capacidad en la semana): " + common.overflowHours.toFixed(2) + " h " + JSON.stringify(common.unassigned.filter((u) => u.minutes > 0).map((u) => u.items.map((i) => i.code))));
    const faltan = sch.check.filter((c) => c.missingDays.length > 0);
    if (faltan.length > 0) throw new Error("actividades que no quedaron en sus días: " + faltan.map((c) => c.code + ":" + c.missingDays).join(" "));
    const semana = common.grid.map((row) => row.reduce((t, c) => t + c.totalMin, 0) / 60);
    if (Math.max(...semana) - Math.min(...semana) > 1) throw new Error("las semanas de las personas deben quedar parejas (±1 h): " + semana.map((x) => x.toFixed(1)).join(" "));
    for (let d = 0; d < sch.days.length; d++) {
      const dia = common.grid.filter((row) => !row[d].rest).map((row) => row[d].totalMin / 60);
      if (Math.max(...dia) - Math.min(...dia) > 1.5) throw new Error("el día " + sch.days[d] + " debe quedar parejo (±1,5 h): " + dia.map((x) => x.toFixed(1)).join(" "));
    }
    // los imprevistos salen con el nombre de su actividad (no como «Imprevistos»), con tope de 2 h por celda mientras haya espacio, y su total es el de las actividades no planificadas del estudio
    const trabajo = common.grid.flat().filter((c) => !c.rest);
    if (Math.abs(sch.reserveHours - (35 + 10 / 60 * 7 + 1)) > 0.01) throw new Error("horas no planificadas del cargo (SUP-006 35 h + SUP-017 + SUP-014): " + sch.reserveHours);
    if (trabajo.some((c) => c.reserveMin > 120 + 1e-6)) throw new Error("ninguna celda debe pasar de 2 h de imprevistos: " + Math.max(...trabajo.map((c) => c.reserveMin)));
    if (trabajo.some((c) => c.tasks.some((t) => t.code === "Imprevistos" || (t.kind === "reserve" && !/^SUP-(006|014|017)$/.test(t.code))))) throw new Error("los imprevistos deben salir con el código de su actividad");
    if (trabajo.some((c) => Math.abs(c.tasks.filter((t) => t.kind === "reserve").reduce((x, t) => x + t.minutes, 0) - c.reserveMin) > 1)) throw new Error("las partes de la reserva deben sumar la reserva de la celda");
    // SUP-003 (apertura, intermedio y cierre, 5 veces al día) se hace en la mañana Y en la tarde cada día
    for (let d = 0; d < sch.days.length; d++) {
      const fr = common.grid.filter((row) => !row[d].rest && row[d].items.some((i) => i.code === "SUP-003")).map((row) => row[d].shift);
      const manana = fr.some((f) => f && f.slice(6) <= "13:00"), tarde = fr.some((f) => f && f.slice(0, 5) >= "13:00");
      if (!manana || !tarde) throw new Error("SUP-003 debe quedar en la mañana y en la tarde el día " + sch.days[d] + ": " + JSON.stringify(fr));
    }
  });

  await check("Dotación (D-112): cada cargo muestra cuántas de sus horas son actividades no planificadas u ocasionales, también en la exportación; sin reparto se calcula igual y no se pierde nada", () => {
    const st = [staff("Cajero", 3, 40), staff("Auxiliar", 2, 40)], ac = [act("A1", "Cajero", { hours: 2, executions: 5 }), act("U1", "Cajero", { hours: 1, executions: 4, planning: "unplanned" }), act("O1", "Cajero", { hours: 3, executions: 1 }), act("X1", "Auxiliar", { hours: 4, executions: 2 })];
    const types: Record<string, ActivityTypeKey | null> = { A1: "operational", U1: "operational", O1: "occasional", X1: "operational" };
    const p = prm(), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: x.code, type: types[x.code] }]));
    const input = { staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays: new Map<string, number[]>() };
    const r = reserveHoursByPosition(input);
    const cajero = r.get(positionKey("real", "Cajas", "CO1", "Cajero")), aux = r.get(positionKey("real", "Cajas", "CO1", "Auxiliar"));
    if (cajero === undefined || !near(cajero, 4 + 3) || aux !== 0) throw new Error("horas no planificadas: Cajero " + cajero + " (esperado 7), Auxiliar " + aux);
    const sch = buildSchedules(input).find((x) => x.position === "Cajero")!; // sin turnos: no hay reparto, pero sí las horas no planificadas
    if (sch.state !== "noshifts" || !near(sch.reserveHours, 7)) throw new Error("sin reparto también debe traer las horas no planificadas: " + sch.reserveHours);
    const { tables } = tablesFor("dotacion", a, null as never, [], {}, "all", 0.1, undefined, [], 1, undefined, 0, r);
    const col = tables[0].columns.find((c) => c.header === "De ellas, no planificadas (h)");
    const fila = (tables[0].rows as { position: string; unplanned: number }[]).find((x) => x.position === "Cajero");
    if (!col || !fila || !near(fila.unplanned, 7)) throw new Error("la exportación debe traer las horas no planificadas: " + JSON.stringify(fila));
  });

  await check("Minutos legibles: 45 min, 2 h, 2 h 15 min; los minutos con decimales se redondean y 59,6 no queda en «60 min»", () => {
    const want: [number, string][] = [[0, "0 min"], [45, "45 min"], [59.6, "1 h"], [60, "1 h"], [120, "2 h"], [135, "2 h 15 min"], [135.4, "2 h 15 min"]];
    for (const [m, t] of want) if (formatMinutes(m) !== t) throw new Error(`${m} → ${formatMinutes(m)} (se esperaba ${t})`);
  });

  await check("Exportación del reparto: una fila por persona, día y tarea con su orden sugerido y los mismos minutos que la pantalla; «Actividades» y los cargos sin reparto con su motivo", () => {
    const st = [staff("Cajero", 2, 40), staff("Auxiliar", 2, 40)], ac = [act("A1", "Cajero", { hours: 2, executions: 6 }), act("A2", "Cajero", { hours: 1, executions: 1, period: "month" }), act("U1", "Cajero", { hours: 1, executions: 2, planning: "unplanned" }), act("X1", "Auxiliar", { hours: 1 })];
    const p = prm(), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: "operational" }]));
    const shiftDays = new Map([[positionKey("real", "Cajas", "CO1", "Cajero"), MON_SAT]]); // el Auxiliar no tiene turnos
    const schedules = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays });
    const { title, tables } = tablesFor("reparto", a, null as never, [], {}, "all", 0.1, undefined, schedules);
    if (title !== "Reparto semanal" || tables.map((t) => t.name).join() !== "Reparto,Actividades,Sin reparto") throw new Error(title + " " + tables.map((t) => t.name));
    const cajero = schedules.find((x) => x.position === "Cajero")!; const w = [cajero.common!, cajero.periodic!];
    const esperado = w.flatMap((x) => x.grid.flat()).reduce((sum, c) => sum + c.items.reduce((t, i) => t + i.minutes, 0) + c.reserveMin, 0);
    const filas = tables[0].rows as { minutes: number; person: string; order: number; code: string }[];
    const exportado = filas.reduce((sum, r) => sum + r.minutes, 0);
    if (Math.abs(esperado - exportado) > 0.05 * filas.length) throw new Error(`pantalla ${esperado} ≠ Excel ${exportado}`);
    if (!filas.every((r) => /^Persona \d+$/.test(r.person))) throw new Error("solo «Persona N», nunca nombres");
    if (!filas.every((r) => Number.isInteger(r.order) && r.order >= 1) || "from" in filas[0] || tables[0].columns.some((c) => /Desde|Hasta/.test(c.header))) throw new Error("cada fila trae su orden sugerido y ninguna hora del día");
    if (!filas.some((r) => r.code === "U1") || tables[1].rows.length !== w[0].activities.length + w[1].activities.length) throw new Error("imprevistos y actividades");
    const sin = tables[2].rows as { position: string; reason: string }[];
    if (sin.length !== 1 || sin[0].position !== "Auxiliar" || !/turnos/.test(sin[0].reason)) throw new Error(JSON.stringify(sin));
  });

  await check("«Reparto semanal» está en el grupo Resultados, después de Dotación requerida, y lo gobiernan los mismos permisos; existe la vista de exportación", () => {
    if (!(VIEWS as readonly string[]).includes("reparto") || !menuHrefs().includes("/resultados/reparto")) throw new Error("falta la vista o el menú");
    const g = MENU.find((e) => "group" in e && e.group === "Resultados") as { items: { href: string }[] };
    if (g.items.map((i) => i.href).join() !== "/resultados/dotacion,/resultados/reparto,/resultados/informe,/resultados/agente") throw new Error(g.items.map((i) => i.href).join());
    if (JSON.stringify(moduleOfPath("/resultados/reparto")) !== '["resultados","cargos","actividades"]') throw new Error("permisos");
  });
}
main().then(summary);
