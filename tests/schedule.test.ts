import { analyze } from "../src/domain/summary";
import { needOf } from "../src/domain/staffing";
import { buildSchedules, formatMinutes, moveTask, orderedTasks, positionKey, ruleOf, RULE_BY_TYPE, ACTIVITY_TYPES, type ActivityExtra, type ActivityTypeKey, type PositionSchedule, type WeekPlan } from "../src/domain/schedule";
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
const MON_SAT = [0, 1, 2, 3, 4, 5];
interface Run { schedules: PositionSchedule[]; hours: (position?: string) => number; required: (position?: string) => number | null }
function run(st: StaffingInput[], ac: ActivityInput[], types: Record<string, ActivityTypeKey | null> = {}, days: number[] = MON_SAT, over: Partial<Params> = {}, overload = 1): Run {
  const p = prm(over), a = analyze(st, ac, p, TH, "all");
  const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: x.code in types ? types[x.code] : "operational" }]));
  const shiftDays = new Map(a.positions.flatMap((x) => (days.length ? [[positionKey(x.dataKind, x.area, x.site, x.position), days] as const] : [])));
  return {
    schedules: buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays, overload }),
    hours: (position = "Cajero") => a.positions.find((x) => x.position === position)?.hours ?? 0,
    required: (position = "Cajero") => { const x = a.positions.find((y) => y.position === position); return x ? needOf(x, overload).required : null; },
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

  await check("Reserva: lo ocasional o no planificado no se programa; se reparte por igual entre personas y días y no aparece como actividad", () => {
    const r = run([staff("Cajero", 2, 40)], [act("R1", "Cajero", { hours: 3, executions: 2, period: "week", planning: "unplanned" }), act("R2", "Cajero", { hours: 1, executions: 2 }), act("O1", "Cajero", { hours: 1, executions: 1 })], { R1: "operational", R2: "operational", O1: "occasional" });
    const { common } = ok(one(r)); const celdas = common.grid.flat();
    if (common.activities.some((x) => x.code === "R1" || x.code === "O1")) throw new Error("la reserva no es una actividad programada");
    const iguales = celdas.every((c) => near(c.reserveMin, celdas[0].reserveMin));
    if (!iguales || !near(celdas.reduce((s, c) => s + c.reserveMin, 0), (6 + 1) * 60)) throw new Error("reserva: " + celdas.map((c) => c.reserveMin).join(","));
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
      if (!near(common.assignedHours, esperado, 1e-6)) throw new Error(`${nota}: repartido ${common.assignedHours} ≠ Cálculo ${esperado}`);
      const cw = jornada * 0.9, cd = Math.min(cw, p.dailyWorkHours ? Math.max(cw / dias.length, p.dailyWorkHours * 0.9) : cw / dias.length);
      for (const w of [common, periodic]) {
        if (w.overflowHours > 1e-6 && w.extraPeople < 1) throw new Error(`${nota}: ${w.kind}: horas que no caben sin pedir refuerzo; personas ${w.people}, no caben ${w.overflowHours}, asignado ${w.assignedHours}+${w.reserveHours}, capacidad ${w.capacityHours}, compartidas ${w.activities.filter((x) => x.shared).map((x) => x.code)}`);
        if (w.kind === "common" && w.overflowHours > 1e-6) throw new Error(`${nota}: en la semana común no debía sobrar nada (${w.overflowHours} h)`);
        for (const row of w.grid) {
          if (w.overflowHours <= 1e-6) { for (const c of row) if (c.totalMin > cd * overload * 60 + 1e-4) throw new Error(`${nota}: un día pasa la capacidad aceptada`); if (weekOf(row) > cw * overload * 60 + 1e-4) throw new Error(`${nota}: una semana pasa la capacidad aceptada`); }
          for (const c of row) if (Math.abs(c.tasks.reduce((s, x) => s + x.minutes, 0) - c.totalMin) > 0.5 + 1e-6) throw new Error(`${nota}: las tareas del día no suman el total de la celda`); // una reserva menor de medio minuto no se muestra como fila
        }
      }
    }
    if (conReparto < 300) throw new Error("la prueba debía cubrir al menos 300 cargos con reparto; cubrió " + conReparto);
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
    if (!filas.some((r) => r.code === "Imprevistos") || tables[1].rows.length !== w[0].activities.length + w[1].activities.length) throw new Error("imprevistos y actividades");
    const sin = tables[2].rows as { position: string; reason: string }[];
    if (sin.length !== 1 || sin[0].position !== "Auxiliar" || !/turnos/.test(sin[0].reason)) throw new Error(JSON.stringify(sin));
  });

  await check("«Reparto semanal» está en el grupo Resultados, después de Dotación requerida, y lo gobiernan los mismos permisos; existe la vista de exportación", () => {
    if (!(VIEWS as readonly string[]).includes("reparto") || !menuHrefs().includes("/resultados/reparto")) throw new Error("falta la vista o el menú");
    const g = MENU.find((e) => "group" in e && e.group === "Resultados") as { items: { href: string }[] };
    if (g.items.map((i) => i.href).join() !== "/resultados/dotacion,/resultados/reparto,/resultados/agente") throw new Error(g.items.map((i) => i.href).join());
    if (JSON.stringify(moduleOfPath("/resultados/reparto")) !== '["resultados","cargos","actividades"]') throw new Error("permisos");
  });
}
main().then(summary);
