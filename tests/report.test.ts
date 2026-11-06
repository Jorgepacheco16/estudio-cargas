import { analyze } from "../src/domain/summary";
import { needsOf, summaryOf } from "../src/domain/staffing";
import { buildSchedules, positionKey, type ActivityExtra } from "../src/domain/schedule";
import { buildReportFacts, weekFact, LEVEL_ES, SCENARIO_ES, type ReportFacts } from "../src/domain/report";
import { axisTicks, niceStep, peopleByAreaChart, truncate, useByPositionChart, weeksChart } from "../src/domain/report-charts";
import { informeTables, tablesFor, VIEWS } from "../src/lib/tables";
import { MENU, menuHrefs } from "../src/lib/nav";
import { moduleOfPath } from "../src/domain/access";
import type { ActivityInput, Params, StaffingInput } from "../src/domain/engine";
import { check, summary } from "./helpers";

/**
 * Informe de resultados, parte C1 (D-105): las cifras del tablero salen de lo que ya calculan Dotación requerida y Reparto semanal (no se calcula nada nuevo), la geometría de las
 * gráficas es correcta y probada sin navegador, y la exportación trae las mismas cifras que la pantalla.
 */
const TH = { high: 1.05, low: 0.5 };
const prm = (): Params => ({ workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct: 0.1, scenario: "base" });
const staff = (area: string, position: string, headcount: number | null, weeklyHours: number | null): StaffingInput => ({ dataKind: "real", area, site: "CO1", position, headcount, weeklyHours });
const act = (code: string, area: string, position: string, hours: number | null, o: Partial<ActivityInput> = {}): ActivityInput => ({
  code, dataKind: "real", area, site: "CO1", position, employeeCode: null, calcMode: "per_event", scope: "position_total", executions: 1, period: "week", unitsPerExecution: null,
  timeAvgMin: hours === null ? null : hours * 60, timeMinMin: null, timeMaxMin: null, seasonHigh: null, seasonLow: null, simultaneous: null, loadShare: null, secondaryPosition: null, planning: "planned",
  waitMin: null, waitOccupies: null, travelMin: null, reworkPct: null, reworkMin: null, ...o,
});
const MON_SAT = [0, 1, 2, 3, 4, 5];
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/** Un estudio pequeño: dos áreas, cuatro cargos (uno sin turnos, uno sin dotación) y una actividad incompleta. */
function estudio() {
  const st = [staff("Cajas", "Cajero", 9, 40), staff("Cajas", "Fiscal", 3, 40), staff("Domicilios", "Auxiliar", 8, 40), staff("Bodega", "Operario", 6, 40)];
  const ac = [
    act("C1", "Cajas", "Cajero", 2.4, { executions: 150 }), act("C2", "Cajas", "Cajero", 6, { executions: 1, period: "month" }), act("F1", "Cajas", "Fiscal", 1.4, { executions: 75 }),
    act("D1", "Domicilios", "Auxiliar", 1, { executions: 6, period: "day" }), act("D2", "Domicilios", "Auxiliar", null), act("O1", "Bodega", "Operario", 2, { executions: 100 }),
    act("X1", "Sinpersonas", "Fantasma", 3),
  ];
  const p = prm(), a = analyze(st, ac, p, TH, "all");
  const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: `Actividad ${x.code}`, type: "operational" }]));
  const shiftDays = new Map([["Cajero", "Cajas"], ["Fiscal", "Cajas"], ["Auxiliar", "Domicilios"]].map(([pos, area]) => [positionKey("real", area, "CO1", pos), MON_SAT] as const)); // Operario sin turnos
  const schedules = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays, overload: TH.high });
  const facts = buildReportFacts({ positions: a.positions, schedules, kpis: a.kpis, overload: TH.high, reservePct: p.reservePct, scenario: p.scenario });
  return { a, schedules, facts };
}

async function main() {
  await check("Eje con marcas redondas: el paso es 1, 2, 5 por una potencia de 10, hay pocas marcas y la última cubre el máximo", () => {
    const pasos: [number, number][] = [[0, 1], [0.4, 0.1], [4, 1], [14, 5], [16, 5], [37, 10], [100, 20], [1000, 200], [1090, 500]];
    for (const [max, paso] of pasos) if (niceStep(max) !== paso) throw new Error(`niceStep(${max}) = ${niceStep(max)} ≠ ${paso}`);
    for (const max of [0, 0.3, 1, 4, 7, 14, 16, 99, 862, 1012, 1145.6, 25000]) {
      const t = axisTicks(max);
      if (t[0] !== 0 || t[t.length - 1] < max - 1e-9 || t.length > 7 || t.some((v, i) => i > 0 && v <= t[i - 1])) throw new Error(`marcas de ${max}: ${t}`);
    }
    if (truncate("Fiscal de cajas y tesorería del centro", 26).length !== 26 || !truncate("Fiscal de cajas y tesorería del centro", 26).endsWith("…") || truncate("Cajero", 26) !== "Cajero") throw new Error("truncar");
  });

  await check("Gráfica de personas por área: la altura de cada barra es proporcional a su valor, «hay» queda a la izquierda de «necesarias», los grupos están parejos y el lienzo crece con las áreas", () => {
    const c = peopleByAreaChart([{ label: "Cajas", hay: 12, necesarias: 14 }, { label: "Domicilios", hay: 8, necesarias: 7 }, { label: "Bodega", hay: 6, necesarias: 6 }]);
    const top = c.ticks[c.ticks.length - 1].value, plotH = c.baseline - c.ticks[c.ticks.length - 1].y;
    if (top < 14 || c.ticks[0].value !== 0 || !near(c.ticks[0].y, c.baseline)) throw new Error("eje: " + JSON.stringify(c.ticks));
    for (const g of c.groups) {
      const [hay, nec] = g.bars;
      if (hay.series !== "hay" || nec.series !== "necesarias" || hay.x >= nec.x) throw new Error("orden de las barras");
      for (const b of g.bars) if (!near(b.h, (b.value / top) * plotH) || !near(b.y + b.h, c.baseline)) throw new Error(`altura de ${g.label}: ${b.h}`);
    }
    const dx = [c.groups[1].cx - c.groups[0].cx, c.groups[2].cx - c.groups[1].cx];
    if (!near(dx[0], dx[1]) || c.groups.map((g) => g.bars[0].value).join() !== "12,8,6") throw new Error("grupos parejos");
    const muchas = peopleByAreaChart(Array.from({ length: 14 }, (_, i) => ({ label: `A${i}`, hay: i, necesarias: i + 1 })));
    if (muchas.width < 44 + 16 + 14 * 96 || peopleByAreaChart([]).groups.length !== 0 || peopleByAreaChart([]).ticks.length < 2) throw new Error("tamaño con 14 áreas o vacío");
  });

  await check("Gráfica de uso por cargo: el 100 % y el umbral caen donde deben, el ancho de cada barra es su porcentaje, el eje crece con una sobrecarga grande y solo se muestran 10 cargos", () => {
    const c = useByPositionChart([{ label: "Cajero", pct: 1.2, level: "overload" }, { label: "Fiscal de cajas y tesorería del centro", pct: 0.93, level: "ok" }], 1.05);
    const px = (pct: number) => c.plotLeft + (pct / c.axisMax) * (c.plotRight - c.plotLeft);
    if (c.axisMax !== 140 || !near(c.x100, px(100)) || !near(c.xThreshold, px(105)) || c.xThreshold <= c.x100) throw new Error(`líneas: ${c.x100} ${c.xThreshold}`);
    if (!near(c.rows[0].w, px(120) - c.plotLeft) || !near(c.rows[1].w, px(93) - c.plotLeft) || c.rows[1].short.length > 26 || !c.rows[1].short.endsWith("…")) throw new Error("barras o etiquetas");
    if (c.rows[1].y <= c.rows[0].y || c.height < c.rows[1].y + 22) throw new Error("filas dentro del lienzo");
    const alta = useByPositionChart([{ label: "X", pct: 2.3, level: "overload" }], 1.05);
    if (alta.axisMax < 230 || alta.axisMax % 20 !== 0 || alta.rows[0].w > alta.plotRight - alta.plotLeft + 1e-6) throw new Error("eje con sobrecarga grande: " + alta.axisMax);
    const quince = useByPositionChart(Array.from({ length: 15 }, (_, i) => ({ label: `C${i}`, pct: 0.5 + i / 20, level: "ok" as const })), 1);
    if (quince.rows.length !== 10 || useByPositionChart([], 1).rows.length !== 0 || useByPositionChart([], 1).height < 40) throw new Error("máximo de filas o vacío");
    if (c.ticks.map((t) => t.pct).join() !== "0,50,100,140") throw new Error("marcas: " + c.ticks.map((t) => t.pct));
  });

  await check("Gráfica de semanas: las barras, la capacidad y el umbral están a escala; sin reparto no hay barras ni líneas", () => {
    const wf = (work: number) => ({ positions: 4, people: 27, workHours: work, capacityHours: 972, utilization: work / 972, freeHours: Math.max(0, 972 - work), extraPeople: 0 });
    const c = weeksChart(wf(862), wf(1012), 1.05);
    const plotW = 270, px = (v: number) => c.plotLeft + (v / c.axisMax) * plotW;
    if (c.axisMax < 1020 || c.bars.length !== 2 || !near(c.bars[0].w, (862 / c.axisMax) * plotW) || !near(c.bars[1].w, (1012 / c.axisMax) * plotW) || c.bars[1].w <= c.bars[0].w) throw new Error("barras");
    if (!near(c.xCapacity!, px(972)) || !near(c.xThreshold!, px(972 * 1.05)) || !near(c.thresholdHours, 1020.6) || c.bars[0].y >= c.bars[1].y) throw new Error("líneas");
    const sola = weeksChart(wf(500), null, 1);
    if (sola.bars.length !== 1 || sola.bars[0].id !== "common") throw new Error("una sola semana");
    const nada = weeksChart(null, null, 1.05);
    if (nada.bars.length !== 0 || nada.xCapacity !== null || nada.xThreshold !== null || nada.height < 40) throw new Error("sin reparto");
  });

  await check("Las cifras del informe son las de Dotación requerida: totales, áreas y cargos coinciden, y la brecha de las áreas suma la general", () => {
    const { a, facts } = estudio();
    const needs = needsOf(a.positions, TH.high), s = summaryOf(needs);
    if (JSON.stringify(facts.totals) !== JSON.stringify(s)) throw new Error("totales difieren");
    if (facts.areas.reduce((t, x) => t + x.gap, 0) !== facts.totals.gap || facts.areas.reduce((t, x) => t + x.required, 0) !== facts.totals.required || facts.areas.reduce((t, x) => t + x.occupants, 0) !== facts.totals.occupants) throw new Error("las áreas no suman el total");
    if (facts.positions.some((p) => p.gap !== p.required - p.occupants) || facts.positions.length !== needs.filter((n) => n.required !== null).length) throw new Error("cargos");
    if (facts.positions.some((p, i, xs) => i > 0 && (xs[i - 1].usePct ?? -1) < (p.usePct ?? -1))) throw new Error("los cargos van de más a menos uso");
    if (facts.positions.some((p) => p.usePct !== a.positions.find((x) => x.position === p.position)!.pct)) throw new Error("el uso actual es el de Cargos y dotación");
  });

  await check("Las semanas del informe suman el reparto: trabajo, capacidad, uso y disponibilidad coinciden con Reparto semanal, y las personas son las de Dotación", () => {
    const { schedules, facts } = estudio();
    const ok = schedules.filter((s) => s.state === "ok");
    if (ok.length !== 3) throw new Error("debían ser 3 cargos con reparto: " + ok.length);
    const c = facts.weeks.common!, p = facts.weeks.periodic!;
    if (!near(c.workHours, ok.reduce((t, s) => t + s.common!.assignedHours + s.common!.reserveHours, 0)) || !near(p.workHours, ok.reduce((t, s) => t + s.periodic!.assignedHours + s.periodic!.reserveHours, 0))) throw new Error("horas de trabajo");
    if (!near(c.capacityHours, ok.reduce((t, s) => t + s.common!.capacityHours, 0)) || !near(c.utilization, c.workHours / c.capacityHours) || !near(c.freeHours, Math.max(0, c.capacityHours - c.workHours))) throw new Error("capacidad, uso o disponibilidad");
    if (c.people !== ok.reduce((t, s) => t + (s.required ?? 0), 0) || c.positions !== 3) throw new Error("personas");
    if (p.workHours <= c.workHours) throw new Error("la semana con periódicas trae más trabajo (la mensual de Cajas)");
    if (weekFact([], (s) => s.common) !== null || weekFact(schedules.filter((s) => s.state !== "ok"), (s) => s.common) !== null) throw new Error("sin cargos con reparto no hay semana");
  });

  await check("Calidad de los datos: actividades completas e incompletas, cargos sin cifra, con cifra mínima y sin turnos, contados con las mismas reglas de las otras secciones", () => {
    const { a, facts } = estudio();
    const d = facts.data;
    if (d.activities !== a.kpis.activities || d.complete !== a.kpis.complete || d.incomplete !== d.activities - d.complete || d.incomplete < 1) throw new Error(JSON.stringify(d));
    if (!near(d.completePct!, d.complete / d.activities)) throw new Error("porcentaje");
    if (d.positionsWithFigure + d.positionsWithoutFigure !== d.positions || d.positionsWithoutFigure < 1) throw new Error("cargos con y sin cifra");
    if (d.positionsWithoutShifts !== 2 || d.positionsPartial !== 1) throw new Error(`sin turnos ${d.positionsWithoutShifts}, mínimas ${d.positionsPartial}`); // sin turnos: Operario y Fantasma (existe solo por una actividad); cifra mínima: Auxiliar, con una actividad incompleta
    const vacio = buildReportFacts({ positions: [], schedules: [], kpis: { activities: 0, complete: 0 }, overload: 1, reservePct: 0.1, scenario: "base" });
    if (vacio.data.completePct !== null || vacio.weeks.common !== null || vacio.positions.length !== 0 || vacio.totals.required !== 0) throw new Error("estudio vacío");
  });

  await check("Con otro umbral de sobrecarga el informe cambia igual que Dotación: 100 % pide al menos tantas personas como 105 %", () => {
    const { a, schedules } = estudio();
    const base = { positions: a.positions, schedules, kpis: a.kpis, reservePct: 0.1, scenario: "base" };
    const estricto = buildReportFacts({ ...base, overload: 1 }), tolerante = buildReportFacts({ ...base, overload: 1.05 });
    if (estricto.totals.required < tolerante.totals.required || estricto.overload !== 1 || tolerante.overload !== 1.05) throw new Error(`${estricto.totals.required} / ${tolerante.totals.required}`);
  });

  await check("Exportación del informe: cinco hojas con las mismas cifras que el tablero y sin nombres de personas; la vista existe, está en el menú y la gobiernan los mismos permisos", () => {
    const { facts } = estudio();
    const t = informeTables(facts);
    if (t.map((x) => x.name).join() !== "Resumen,Por área,Por cargo,Semanas,Calidad de datos") throw new Error(t.map((x) => x.name).join());
    const resumen = Object.fromEntries((t[0].rows as { metric: string; value: number }[]).map((r) => [r.metric, r.value]));
    if (resumen["Personas que hay"] !== facts.totals.occupants || resumen["Personas necesarias"] !== facts.totals.required || resumen["Brecha (+ faltan, − sobran)"] !== facts.totals.gap) throw new Error("resumen");
    if (t[1].rows.length !== facts.areas.length || t[2].rows.length !== facts.positions.length || t[3].rows.length !== 2) throw new Error("filas");
    const sem = t[3].rows as { week: string; work: number; people: number }[];
    if (sem[0].week !== "Semana común" || !near(sem[0].work, Math.round(facts.weeks.common!.workHours * 100) / 100, 1e-6) || sem[1].people !== facts.weeks.periodic!.people) throw new Error("semanas");
    if ((t[2].rows as { level: string }[]).some((r) => !Object.values(LEVEL_ES).includes(r.level))) throw new Error("estados");
    const { title, tables } = tablesFor("informe", null as never, null as never, [], {}, "all", 0.1, undefined, [], 1, facts);
    if (title !== "Informe de resultados" || tables.length !== 5 || tablesFor("informe", null as never, null as never).tables.length !== 0) throw new Error("vista");
    if (!(VIEWS as readonly string[]).includes("informe") || !menuHrefs().includes("/resultados/informe")) throw new Error("falta la vista o el menú");
    const g = MENU.find((e) => "group" in e && e.group === "Resultados") as { items: { href: string }[] };
    if (g.items.map((i) => i.href).join() !== "/resultados/dotacion,/resultados/reparto,/resultados/informe,/resultados/agente") throw new Error(g.items.map((i) => i.href).join());
    if (JSON.stringify(moduleOfPath("/resultados/informe")) !== '["resultados","cargos","actividades"]') throw new Error("permisos");
    if (SCENARIO_ES.base !== "base" || SCENARIO_ES.high_season !== "temporada alta") throw new Error("escenarios");
    const f: ReportFacts = facts; if (JSON.stringify(f).includes("employee")) throw new Error("no debe haber datos de colaboradores");
  });
}
main().then(summary);
