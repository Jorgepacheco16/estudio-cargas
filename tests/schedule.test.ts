import { analyze } from "../src/domain/summary";
import { buildSchedules, formatMinutes, positionKey, ruleOf, RULE_BY_TYPE, ACTIVITY_TYPES, type ActivityExtra, type ActivityTypeKey, type PositionSchedule, type WeekPlan } from "../src/domain/schedule";
import type { ActivityInput, Params, StaffingInput } from "../src/domain/engine";
import { tablesFor, VIEWS } from "../src/lib/tables";
import { MENU, menuHrefs } from "../src/lib/nav";
import { moduleOfPath } from "../src/domain/access";
import { check, summary } from "./helpers";

/**
 * Reparto semanal (D-101, parte B): las horas salen del motor real (computeActivity vía analyze); aquí se comprueba que el reparto las conserve, respete la capacidad y aplique
 * la regla de cada TIPO de actividad (confirmada por el titular): operativa/servicio se parten; administrativa/control/apoyo, una persona por ejecución; coordinación,
 * una sola persona; ocasional o no planificada, reserva.
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
interface Run { schedules: PositionSchedule[]; hours: number }
function run(st: StaffingInput[], ac: ActivityInput[], types: Record<string, ActivityTypeKey | null> = {}, days: number[] = MON_SAT, over: Partial<Params> = {}): Run {
  const p = prm(over), a = analyze(st, ac, p, TH, "all");
  const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: x.code in types ? types[x.code] : "operational" }]));
  const shiftDays = new Map(a.positions.map((x) => [positionKey(x.dataKind, x.area, x.site, x.position), days]));
  return { schedules: buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays }), hours: a.positions[0]?.hours ?? 0 };
}
const one = (r: Run, position = "Cajero") => { const s = r.schedules.find((x) => x.position === position); if (!s) throw new Error("no está " + position); return s; };
const ok = (s: PositionSchedule) => { if (s.state !== "ok" || !s.common || !s.periodic) throw new Error(`estado ${s.state}: ${s.reason}`); return { common: s.common, periodic: s.periodic }; };
const minutesOf = (w: WeekPlan, code: string) => w.grid.map((row) => row.map((c) => c.items.filter((i) => i.code === code).reduce((s, i) => s + i.minutes, 0)));
const sum = (m: number[][]) => m.flat().reduce((a, b) => a + b, 0);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

async function main() {
  await check("Reglas por tipo: operativa y servicio se parten; administrativa, control y apoyo, una persona por ejecución; coordinación, una sola; ocasional y no planificada, reserva; sin tipo, la más prudente", () => {
    const want: Record<ActivityTypeKey, string> = { operational: "split", service: "split", administrative: "by_execution", control: "by_execution", support: "by_execution", coordination: "single", occasional: "reserve" };
    for (const t of ACTIVITY_TYPES) if (RULE_BY_TYPE[t] !== want[t] || ruleOf(t, "planned") !== want[t]) throw new Error(t);
    for (const t of ACTIVITY_TYPES) if (ruleOf(t, "unplanned") !== "reserve") throw new Error("la no planificada es reserva sea cual sea su tipo: " + t);
    if (ruleOf(null, "planned") !== "by_execution" || ruleOf(null, null) !== "by_execution") throw new Error("sin tipo");
  });

  await check("Conserva las horas del motor: con tantas personas como ocupantes, lo repartido (por cargo y por colaborador) suma exactamente las horas de Cálculo", () => {
    // 2 personas × 40 h → 36 h útiles; A1 del cargo 10 × 3 h = 30 h; A2 por colaborador, 1 h diaria × 6 días = 6 h por persona → motor: 30 + 2 × 6 = 42 h → 2 personas necesarias
    const r = run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 3, executions: 10 }), act("A2", "Cajero", { hours: 1, scope: "per_employee", period: "day" })], { A1: "administrative", A2: "operational" });
    const { common } = ok(one(r));
    if (common.people !== 2 || !near(r.hours, 42) || !near(common.assignedHours, r.hours) || common.overflowHours > 1e-6) throw new Error(`personas ${common.people}, motor ${r.hours}, repartido ${common.assignedHours}`);
    if (!near(sum(minutesOf(common, "A1")), 30 * 60) || !near(sum(minutesOf(common, "A2")), 12 * 60)) throw new Error("por actividad");
  });

  await check("Nadie pasa su capacidad diaria ni semanal, y con cada persona al máximo posible no sobra ninguna hora", () => {
    const r = run([staff("Cajero", 3, 48)], [act("A1", "Cajero", { hours: 2, executions: 12, period: "week" }), act("A2", "Cajero", { hours: 0.5, executions: 4, period: "day" }), act("A3", "Cajero", { hours: 1, executions: 6, period: "week" })], { A1: "operational", A2: "service", A3: "control" });
    const { common } = ok(one(r)); const cw = 48 * 0.9, cd = cw / 6;
    for (const row of common.grid) {
      for (const c of row) if (c.totalMin > cd * 60 + 1e-6) throw new Error(`día ${c.totalMin} > ${cd * 60}`);
      if (row.reduce((s, c) => s + c.totalMin, 0) > cw * 60 + 1e-6) throw new Error("semana");
    }
    if (common.overflowHours > 1e-6) throw new Error("sobra " + common.overflowHours);
  });

  await check("Coordinación: una sola persona responsable de todas sus ejecuciones", () => {
    const r = run([staff("Cajero", 3, 48)], [act("C1", "Cajero", { hours: 1, executions: 1, period: "day" })], { C1: "coordination" });
    const { common } = ok(one(r)); const a = common.activities.find((x) => x.code === "C1")!;
    if (a.persons.length !== 1 || a.rule !== "single") throw new Error(JSON.stringify(a));
    if (!near(sum(minutesOf(common, "C1")), 6 * 60)) throw new Error("debía repartir 6 ejecuciones de 1 h");
  });

  await check("Administrativa/Control/Apoyo: cada ejecución la hace una sola persona (nunca partida) y las ejecuciones se reparten entre personas", () => {
    for (const t of ["administrative", "control", "support"] as const) {
      const r = run([staff("Cajero", 4, 48)], [act("A1", "Cajero", { hours: 3, executions: 30, period: "week" })], { A1: t }); // 90 h: Dotación pide 3 personas
      const { common } = ok(one(r)); const m = minutesOf(common, "A1").flat().filter((x) => x > 1e-9);
      if (m.some((x) => !near(x % 180, 0) && !near((x % 180), 180))) throw new Error(`${t}: una ejecución quedó partida: ${m}`);
      if (new Set(common.activities.find((x) => x.code === "A1")!.persons).size < 2) throw new Error(`${t}: debía repartir las ejecuciones entre varias personas`);
    }
  });

  await check("Operativa/Servicio por unidad: se parte entre personas cuando no cabe en una; por evento, la ejecución no se parte", () => {
    // jornada diaria de 4 h (3,6 h útiles): una ejecución de 6 h por unidad (6 unidades de 1 h) no cabe en una persona
    const unit = act("U1", "Cajero", { hours: 1, calcMode: "per_unit", unitsPerExecution: 6, executions: 1, period: "day" });
    const r = run([staff("Cajero", 2, 24)], [unit], { U1: "operational" }, [0], { dailyWorkHours: 4 });
    const { common } = ok(one(r));
    if (new Set(common.activities.find((x) => x.code === "U1")!.persons).size !== 2 || common.overflowHours > 1e-6) throw new Error("debía partirse entre las dos personas: " + JSON.stringify(common.activities[0]));
    // por evento (indivisible): la misma carga como UN evento de 6 h no cabe en nadie → no se parte: queda entero y se marca
    const ev = act("E1", "Cajero", { hours: 6, executions: 1, period: "day" });
    const s = ok(one(run([staff("Cajero", 2, 24)], [ev], { E1: "operational" }, [0], { dailyWorkHours: 4 }))).common;
    const itemsE1 = s.grid.flat().flatMap((c) => c.items.filter((i) => i.code === "E1"));
    if (s.overflowHours <= 1e-6 || itemsE1.length !== 1 || !near(itemsE1[0].minutes, 360)) throw new Error("un evento indivisible de 6 h no cabe en 3,6 h: debe quedar entero y marcarse: " + JSON.stringify(itemsE1));
  });

  await check("Lo que hace cada colaborador aparece en la semana de CADA persona", () => {
    const r = run([staff("Cajero", 3, 48)], [act("P1", "Cajero", { hours: 0.5, scope: "per_employee", period: "day" })], { P1: "operational" });
    const { common } = ok(one(r)); const a = common.activities.find((x) => x.code === "P1")!;
    if (!a.perEmployee || a.persons.length !== common.people) throw new Error(JSON.stringify(a));
    const per = minutesOf(common, "P1").map((row) => row.reduce((s, x) => s + x, 0));
    if (per.some((x) => !near(x, 6 * 30))) throw new Error("cada persona debía tener 6 × 30 min: " + per);
  });

  await check("Exige varias personas a la vez: se asignan juntas, el mismo día y con los mismos minutos; si no hay tantas, se suma gente", () => {
    const r = run([staff("Cajero", 3, 48)], [act("S1", "Cajero", { hours: 1, simultaneous: 2, executions: 1, period: "week" })], { S1: "administrative" });
    const { common } = ok(one(r)); const m = minutesOf(common, "S1");
    const dias = common.grid[0].map((_, d) => m.filter((row) => row[d] > 1e-9).length);
    if (dias.filter((x) => x === 2).length !== 1 || dias.some((x) => x !== 0 && x !== 2)) throw new Error("debían ser 2 personas el mismo día: " + dias);
    if (!near(sum(m), 2 * 60)) throw new Error("2 personas × 1 h");
    const tres = ok(one(run([staff("Cajero", 1, 12)], [act("S2", "Cajero", { hours: 1, simultaneous: 3, executions: 1, period: "week" })], { S2: "administrative" }))).common;
    if (tres.people < 3 || tres.overflowHours > 1e-6) throw new Error("con 3 personas a la vez hacen falta al menos 3: " + tres.people);
  });

  await check("Reserva: lo ocasional o no planificado no se programa; se reparte por igual entre personas y días y no aparece como actividad", () => {
    const r = run([staff("Cajero", 2, 40)], [act("R1", "Cajero", { hours: 3, executions: 2, period: "week", planning: "unplanned" }), act("R2", "Cajero", { hours: 1, executions: 2 }), act("O1", "Cajero", { hours: 1, executions: 1 })], { R1: "operational", R2: "operational", O1: "occasional" });
    const { common } = ok(one(r)); const celdas = common.grid.flat();
    if (common.activities.some((x) => x.code === "R1" || x.code === "O1")) throw new Error("la reserva no es una actividad programada");
    const iguales = celdas.every((c) => near(c.reserveMin, celdas[0].reserveMin));
    if (!iguales || !near(celdas.reduce((s, c) => s + c.reserveMin, 0), (6 + 1) * 60)) throw new Error("reserva: " + celdas.map((c) => c.reserveMin).join(","));
  });

  await check("Semana con periódicas: lo mensual, trimestral y anual NO está en la semana común y SÍ en la otra; la semana común no cambia", () => {
    const r = run([staff("Cajero", 2, 40)], [act("D1", "Cajero", { hours: 1, executions: 2, period: "day" }), act("M1", "Cajero", { hours: 4, executions: 1, period: "month" }), act("T1", "Cajero", { hours: 2, executions: 3, period: "quarter" }), act("Y1", "Cajero", { hours: 5, executions: 1, period: "year" })], { D1: "operational", M1: "administrative", T1: "control", Y1: "support" });
    const { common, periodic } = ok(one(r));
    for (const c of ["M1", "T1", "Y1"]) { if (sum(minutesOf(common, c)) > 0) throw new Error(c + " en la semana común"); }
    if (!near(sum(minutesOf(periodic, "M1")), 4 * 60) || !near(sum(minutesOf(periodic, "T1")), 6 * 60) || !near(sum(minutesOf(periodic, "Y1")), 5 * 60)) throw new Error("periódicas: todas las ejecuciones del período en esa semana");
    if (!near(sum(minutesOf(periodic, "D1")), sum(minutesOf(common, "D1")))) throw new Error("lo diario debía ser igual en las dos semanas");
    if (periodic.people < common.people || periodic.assignedHours <= common.assignedHours) throw new Error("la semana con periódicas tiene más trabajo");
  });

  await check("La semana con periódicas pide refuerzo cuando la carga extra no cabe con la gente de la semana común, y lo dice", () => {
    const r = run([staff("Cajero", 1, 40)], [act("D1", "Cajero", { hours: 1, executions: 5, period: "week" }), act("M1", "Cajero", { hours: 30, executions: 1, period: "month" })], { D1: "operational", M1: "operational" });
    const s = one(r), { common, periodic } = ok(s);
    if (periodic.people <= common.people || !s.notes.some((n) => /refuerzo/.test(n))) throw new Error(`común ${common.people}, periódica ${periodic.people}, notas ${s.notes}`);
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

  await check("Si las reglas exigen más gente que Dotación requerida (una sola persona responsable de más horas que su día), se suma y se explica; si ni así cabe, se marca", () => {
    // coordinación de 10 h diarias: una sola persona no puede (7,2 h al día) → no cabe con ninguna cantidad de personas → se marca y no se oculta
    const s = one(run([staff("Cajero", 2, 48)], [act("C1", "Cajero", { hours: 10, executions: 1, period: "day" })], { C1: "coordination" }));
    const { common } = ok(s);
    if (common.overflowHours <= 1e-6 || !s.notes.some((n) => /no caben/.test(n))) throw new Error(`overflow ${common.overflowHours}; ${s.notes}`);
  });

  await check("Los días del reparto son los de los turnos; si no coinciden con los días de Parámetros se avisa", () => {
    const s = one(run([staff("Cajero", 2, 40)], [act("A1", "Cajero", { hours: 1, executions: 4 })], {}, [0, 2, 4]));
    if (s.days.join() !== "0,2,4" || ok(s).common.grid[0].length !== 3 || !s.notes.some((n) => /3 días por sus turnos/.test(n))) throw new Error(s.days + " | " + s.notes);
  });

  await check("Minutos legibles: 45 min, 2 h, 2 h 15 min; los minutos con decimales se redondean y 59,6 no queda en «60 min»", () => {
    const want: [number, string][] = [[0, "0 min"], [45, "45 min"], [59.6, "1 h"], [60, "1 h"], [120, "2 h"], [135, "2 h 15 min"], [135.4, "2 h 15 min"]];
    for (const [m, t] of want) if (formatMinutes(m) !== t) throw new Error(`${m} → ${formatMinutes(m)} (se esperaba ${t})`);
  });

  await check("Exportación del reparto: una fila por persona, día y actividad con los mismos minutos que la pantalla, una por actividad en «Actividades» y los cargos sin reparto con su motivo", () => {
    const st = [staff("Cajero", 2, 40), staff("Auxiliar", 2, 40)], ac = [act("A1", "Cajero", { hours: 2, executions: 6 }), act("A2", "Cajero", { hours: 1, executions: 1, period: "month" }), act("U1", "Cajero", { hours: 1, executions: 2, planning: "unplanned" }), act("X1", "Auxiliar", { hours: 1 })];
    const p = prm(), a = analyze(st, ac, p, TH, "all");
    const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: "operational" }]));
    const shiftDays = new Map([[positionKey("real", "Cajas", "CO1", "Cajero"), MON_SAT]]); // el Auxiliar no tiene turnos
    const schedules = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays });
    const { title, tables } = tablesFor("reparto", a, null as never, [], {}, "all", 0.1, undefined, schedules);
    if (title !== "Reparto semanal" || tables.map((t) => t.name).join() !== "Reparto,Actividades,Sin reparto") throw new Error(title + " " + tables.map((t) => t.name));
    const cajero = schedules.find((x) => x.position === "Cajero")!; const w = [cajero.common!, cajero.periodic!];
    const esperado = w.flatMap((x) => x.grid.flat()).reduce((sum, c) => sum + c.items.reduce((t, i) => t + i.minutes, 0) + c.reserveMin, 0);
    const exportado = (tables[0].rows as { minutes: number }[]).reduce((sum, r) => sum + r.minutes, 0);
    if (Math.abs(esperado - exportado) > 0.05 * tables[0].rows.length) throw new Error(`pantalla ${esperado} ≠ Excel ${exportado}`);
    if (!(tables[0].rows as { person: string }[]).every((r) => /^Persona \d+$/.test(r.person))) throw new Error("solo «Persona N», nunca nombres");
    if (!(tables[0].rows as { code: string }[]).some((r) => r.code === "Imprevistos") || tables[1].rows.length !== w[0].activities.length + w[1].activities.length) throw new Error("imprevistos y actividades");
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
