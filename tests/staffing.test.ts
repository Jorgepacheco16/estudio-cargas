import { analyze } from "../src/domain/summary";
import { areasOf, needOf, needsOf, roundUpPeople, STATE_ES, summaryOf } from "../src/domain/staffing";
import { moduleOfPath } from "../src/domain/access";
import { GRUPO_RESULTADOS, MENU, menuHrefs } from "../src/lib/nav";
import { tablesFor, VIEWS } from "../src/lib/tables";
import type { ActivityInput, Params, StaffingInput } from "../src/domain/engine";
import { check, summary } from "./helpers";

/**
 * Dotación requerida (D-99): personas necesarias = horas de la semana ÷ (jornada × (1 − reserva)), redondeadas hacia arriba; brecha = necesarias − las que hay.
 * Las horas salen del motor real (computeActivity) a través de analyze, no de cifras puestas a mano.
 */
const TH = { high: 1, low: 0.5 };
const prm = (reservePct = 0.1): Params => ({ workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct, scenario: "base" });
const staff = (position: string, headcount: number | null, weeklyHours: number | null, area = "Cajas"): StaffingInput => ({ dataKind: "real", area, site: "CO1", position, headcount, weeklyHours });
/** Actividad semanal de `hours` horas por persona/ejecución: 1 ejecución por semana de `hours*60` minutos, del cargo completo (no por colaborador). */
const act = (code: string, position: string, hours: number | null, area = "Cajas"): ActivityInput => ({
  code, dataKind: "real", area, site: "CO1", position, employeeCode: null, calcMode: "per_event", scope: "position_total", executions: 1, period: "week", unitsPerExecution: null,
  timeAvgMin: hours === null ? null : hours * 60, timeMinMin: null, timeMaxMin: null, seasonHigh: null, seasonLow: null, simultaneous: null, loadShare: null, secondaryPosition: null, planning: null,
  waitMin: null, waitOccupies: null, travelMin: null, reworkPct: null, reworkMin: null,
});
const need = (st: StaffingInput[], ac: ActivityInput[], reserve = 0.1) => needsOf(analyze(st, ac, prm(reserve), TH, "all").positions);
const one = (st: StaffingInput[], ac: ActivityInput[], position: string, reserve = 0.1) => { const n = need(st, ac, reserve).find((x) => x.position === position); if (!n) throw new Error("no está " + position); return n; };

async function main() {
  await check("Faltan personas: 2 personas × 40 h con 10 % de reserva dan 36 h útiles cada una; 100 h de carga piden 3 y la brecha es +1", () => {
    const n = one([staff("Cajero", 2, 40)], [act("A1", "Cajero", 100)], "Cajero");
    if (n.hoursPerPerson !== 36 || Math.abs(n.exact! - 100 / 36) > 1e-9 || n.required !== 3 || n.gap !== 1 || n.state !== "short") throw new Error(JSON.stringify(n));
  });

  await check("Dotación ajustada cuando la carga es exactamente la capacidad (sin que un residuo decimal suba una persona)", () => {
    const n = one([staff("Cajero", 3, 40)], [act("A1", "Cajero", 108)], "Cajero");
    if (n.required !== 3 || n.gap !== 0 || n.state !== "balanced") throw new Error(JSON.stringify(n));
    if (roundUpPeople(3.0000000000001) !== 3 || roundUpPeople(3.00001) !== 4 || roundUpPeople(0.2) !== 1 || roundUpPeople(0) !== 0) throw new Error("redondeo hacia arriba");
  });

  await check("Posible excedente: la brecha es negativa y la lectura pide validar el inventario antes de decidir", () => {
    const n = one([staff("Cajero", 3, 40)], [act("A1", "Cajero", 20)], "Cajero");
    if (n.required !== 1 || n.gap !== -2 || n.state !== "surplus" || !/valide/.test(n.reading) || !/de más/.test(n.reading)) throw new Error(JSON.stringify(n));
  });

  await check("Sin datos no hay cifra: sin dotación, sin actividades o con actividades incompletas el cargo queda «Sin datos» y nunca se inventa un número", () => {
    const sinDotacion = one([], [act("A1", "Cajero", 10)], "Cajero");
    const sinActividades = one([staff("Cajero", 2, 40)], [], "Cajero");
    const incompleta = one([staff("Cajero", 2, 40)], [act("A1", "Cajero", null)], "Cajero");
    const sinJornada = one([staff("Cajero", 2, null)], [act("A1", "Cajero", 10)], "Cajero");
    for (const [nombre, n] of Object.entries({ sinDotacion, sinActividades, incompleta, sinJornada })) {
      if (n.state !== "nodata" || n.required !== null || n.gap !== null || n.exact !== null) throw new Error(nombre + ": " + JSON.stringify(n));
    }
    if (!/cantidad y jornada/.test(sinDotacion.reading) || !/cantidad y jornada/.test(sinJornada.reading) || !/Sin actividades/.test(sinActividades.reading) || !/ninguna con datos completos/.test(incompleta.reading)) throw new Error("lecturas");
  });

  await check("Un cargo con actividades incompletas da una cifra MÍNIMA y lo dice", () => {
    const n = one([staff("Cajero", 2, 40)], [act("A1", "Cajero", 100), act("A2", "Cajero", null)], "Cajero");
    if (!n.partial || n.required !== 3 || !/mínima/.test(n.reading)) throw new Error(JSON.stringify(n));
    if (one([staff("Cajero", 2, 40)], [act("A1", "Cajero", 100)], "Cajero").partial) throw new Error("completo no debía ser parcial");
  });

  await check("Las horas útiles por persona usan solo las filas de dotación con cantidad y jornada; los ocupantes cuentan todas", () => {
    const n = one([staff("Cajero", 2, 40), staff("Cajero", 1, null)], [act("A1", "Cajero", 72)], "Cajero");
    if (n.occupants !== 3 || n.hoursPerPerson !== 36 || n.required !== 2 || n.gap !== -1) throw new Error(JSON.stringify(n));
    // dos filas con jornadas distintas: promedio ponderado por personas (1 × 40 y 3 × 20 → (40 + 60) × 0,9 ÷ 4 = 22,5 h útiles)
    const m = one([staff("Auxiliar", 1, 40), staff("Auxiliar", 3, 20)], [act("A1", "Auxiliar", 45)], "Auxiliar");
    if (Math.abs(m.hoursPerPerson! - 22.5) > 1e-9 || m.required !== 2) throw new Error(JSON.stringify(m));
  });

  await check("Coherencia con Cargos y dotación: con jornada en todas las filas, necesarias exactas = personas × % de capacidad", () => {
    const a = analyze([staff("Cajero", 4, 44), staff("Cajero", 2, 36)], [act("A1", "Cajero", 150)], prm(0.15), TH, "all");
    const p = a.positions[0], n = needOf(p);
    if (p.pct === null || Math.abs(n.exact! - p.occupants * p.pct) > 1e-9) throw new Error(`${n.exact} ≠ ${p.occupants * p.pct!}`);
  });

  await check("La reserva de capacidad cambia las horas útiles: con 0 % de reserva se necesitan menos personas que con 20 %", () => {
    const st = [staff("Cajero", 2, 40)], ac = [act("A1", "Cajero", 76)];
    const sin = one(st, ac, "Cajero", 0), con = one(st, ac, "Cajero", 0.2);
    if (sin.required !== 2 || con.required !== 3 || sin.hoursPerPerson !== 40 || con.hoursPerPerson !== 32) throw new Error(JSON.stringify({ sin: sin.required, con: con.required }));
  });

  await check("Totales por área y generales: solo suman los cargos con cifra; los demás se cuentan aparte", () => {
    const ns = need(
      [staff("Cajero", 2, 40), staff("Auxiliar", 1, 40), staff("Jefe", 1, 40), staff("Chofer", 1, 40, "Logística")],
      [act("A1", "Cajero", 100), act("A2", "Auxiliar", 10), act("A3", "Chofer", 36, "Logística"), act("A4", "Jefe", null)],
    );
    const cajas = areasOf(ns).find((r) => r.area === "Cajas")!, log = areasOf(ns).find((r) => r.area === "Logística")!;
    if (cajas.occupants !== 3 || cajas.required !== 4 || cajas.gap !== 1 || cajas.withoutData !== 1 || cajas.positions !== 3) throw new Error(JSON.stringify(cajas));
    if (log.required !== 1 || log.gap !== 0 || log.withoutData !== 0) throw new Error(JSON.stringify(log));
    const t = summaryOf(ns);
    if (t.occupants !== 4 || t.required !== 5 || t.gap !== 1 || t.withoutData !== 1 || t.positions !== 4 || Math.abs(t.exact - (100 / 36 + 10 / 36 + 1)) > 1e-9) throw new Error(JSON.stringify(t));
  });

  await check("La exportación «dotacion» existe y trae una fila por cargo con las mismas cifras que la pantalla", () => {
    if (!(VIEWS as readonly string[]).includes("dotacion")) throw new Error("falta la vista en VIEWS");
    const a = analyze([staff("Cajero", 2, 40)], [act("A1", "Cajero", 100)], prm(), TH, "all");
    const { title, tables } = tablesFor("dotacion", a, null as never);
    const row = tables[0].rows[0] as Record<string, unknown>;
    if (title !== "Dotación requerida" || tables[0].rows.length !== 1 || row.required !== 3 || row.gap !== 1 || row.occupants !== 2 || row.state !== STATE_ES.short) throw new Error(JSON.stringify(row));
  });

  await check("«Resultados» es UN solo grupo del menú, justo antes de «Usuarios y roles», con «Dotación requerida» primero y el «Agente de IA» como subsección", () => {
    const idx = (f: (e: (typeof MENU)[number]) => boolean) => MENU.findIndex(f);
    const historia = idx((e) => "href" in e && e.href === "/integraciones"), usuarios = idx((e) => "href" in e && e.href === "/usuarios");
    const grupos = MENU.filter((e) => "group" in e && e.group === GRUPO_RESULTADOS);
    if (grupos.length !== 1) throw new Error("debe haber un solo grupo «Resultados»");
    const g = idx((e) => "group" in e && e.group === GRUPO_RESULTADOS);
    if (!(historia >= 0 && g === historia + 1 && usuarios === g + 1)) throw new Error(`orden del menú: integraciones ${historia}, resultados ${g}, usuarios ${usuarios}`);
    if (menuHrefs().includes("/agente")) throw new Error("el Agente de IA ya no es un enlace suelto del menú");
    const items = (grupos[0] as { items: { href: string; label: string }[] }).items;
    if (items[0].href !== "/resultados/dotacion" || items[0].label !== "Dotación requerida" || !items.some((i) => i.href === "/resultados/agente" && i.label === "Agente de IA")) throw new Error(JSON.stringify(items));
    if (menuHrefs().includes("/dotacion")) throw new Error("no debe quedar «Dotación requerida» suelta en el menú");
  });

  await check("«Dotación requerida» exige el permiso «Resultados» además de Cargos y Actividades; el Agente de IA, «Resultados» y su propio permiso", () => {
    if (JSON.stringify(moduleOfPath("/resultados/dotacion")) !== '["resultados","cargos","actividades"]') throw new Error(JSON.stringify(moduleOfPath("/resultados/dotacion")));
    if (JSON.stringify(moduleOfPath("/resultados/agente")) !== '["resultados","agente"]') throw new Error(JSON.stringify(moduleOfPath("/resultados/agente")));
  });
}
main().then(summary);
