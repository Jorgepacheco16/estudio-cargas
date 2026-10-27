import { ALL_SHIFTS, activityShiftsText, daysOf, describeDays, describeShift, maskFromDays, parseDaysText, grossMinutes, netHours, normTime, parseShift, reconcileSelection } from "../src/domain/shifts";
import { check, summary } from "./helpers";

/** Turnos del cargo (D-67): validación, horas netas y selección de la actividad. Funciones puras. */
const EVERY_DAY = ["0", "1", "2", "3", "4", "5", "6"];
const ok = (i: Partial<Parameters<typeof parseShift>[0]>) => parseShift({ name: "Apertura", start: "5:30", end: "13:00", breakMin: "30", days: EVERY_DAY, ...i });
const bad = (i: Partial<Parameters<typeof parseShift>[0]>) => { const r = ok(i); if (r.ok) throw new Error("debía rechazarse"); return r.errors.join(" | "); };

async function main() {
  await check("Horas: «5:30» se normaliza a 05:30 y valores fuera de rango se rechazan", () => {
    if (normTime("5:30") !== "05:30" || normTime("13:00") !== "13:00" || normTime("20:30:00") !== "20:30") throw new Error("normalización");
    for (const x of ["24:00", "12:60", "abc", "", "7"]) if (normTime(x) !== null) throw new Error(x);
  });

  await check("Turnos de los fiscales de piso: 7 horas netas cada uno (jornada de 42 h en 6 días)", () => {
    for (const [s, e] of [["05:30", "13:00"], ["09:00", "16:30"], ["13:00", "20:30"]]) {
      if (grossMinutes(s, e) !== 450 || netHours({ start: s, end: e, breakMin: 30 }) !== 7) throw new Error(`${s}-${e}`);
    }
    if (netHours({ start: null, end: null, breakMin: 30 }) !== null) throw new Error("sin horario no hay horas netas");
  });

  await check("Un turno que cruza la medianoche suma bien (22:00–06:00 = 8 h)", () => {
    if (grossMinutes("22:00", "06:00") !== 480) throw new Error(String(grossMinutes("22:00", "06:00")));
  });

  await check("parseShift: normaliza el nombre y acepta turnos sin horario ni receso", () => {
    const a = ok({ name: "  Turno   de  apertura " }); if (!a.ok || a.values.name !== "Turno de apertura" || a.values.start !== "05:30" || a.values.breakMin !== 30) throw new Error(JSON.stringify(a));
    const b = ok({ start: "", end: "", breakMin: "" }); if (!b.ok || b.values.start !== null || b.values.end !== null || b.values.breakMin !== null) throw new Error(JSON.stringify(b));
  });

  await check("parseShift rechaza: nombre vacío o reservado, horario incompleto o igual, receso inválido o mayor que el turno", () => {
    if (!bad({ name: " " }).includes("nombre")) throw new Error("vacío");
    if (!bad({ name: "todos los turnos" }).includes("reservada")) throw new Error("reservado");
    if (!bad({ end: "" }).includes("ambas")) throw new Error("incompleto");
    if (!bad({ start: "05:30", end: "5:30" }).includes("iguales")) throw new Error("iguales");
    for (const br of ["-5", "241", "10.5", "x"]) if (!bad({ breakMin: br }).includes("receso")) throw new Error(br);
    if (!bad({ start: "10:00", end: "10:20", breakMin: "30" }).includes("receso")) throw new Error("receso ≥ duración");
  });

  await check("Días del turno: los siete días = todos (null); L–S, solo domingo y días sueltos se describen y se recuperan de la máscara", () => {
    if (maskFromDays(EVERY_DAY) !== null || describeDays(null) !== "Todos los días") throw new Error("todos");
    const ls = maskFromDays(["0", "1", "2", "3", "4", "5"]); if (ls !== 63 || describeDays(ls) !== "L–S" || daysOf(ls).join() !== "0,1,2,3,4,5") throw new Error(String(ls));
    const d = maskFromDays(["6"]); if (d !== 64 || describeDays(d) !== "Domingo") throw new Error(String(d));
    const lxv = maskFromDays(["4", "0", "2", "2"]); if (describeDays(lxv) !== "L, X, V" || daysOf(lxv).join() !== "0,2,4") throw new Error(String(lxv));
    if (describeDays(maskFromDays(["5", "6"])) !== "S, D") throw new Error("dos días seguidos se listan");
  });

  await check("Días escritos como texto (carga masiva): todos, rangos, listas, nombres completos y valores no válidos", () => {
    const eq = (t: string, want: string | null) => { const r = parseDaysText(t); const got = r === null ? null : r.join(""); if (got !== want) throw new Error(`«${t}» → ${got} (se esperaba ${want})`); };
    for (const t of ["", "Todos", "todos los días", "L-D", "lunes a domingo"]) eq(t, "0123456");
    eq("L-S", "012345"); eq("l–s", "012345"); eq("Lunes a Viernes", "01234"); eq("L, X, V", "024"); eq("l;m;j", "013"); eq("Domingo", "6"); eq("sábado y domingo", "56"); eq("S-L", "056"); // da la vuelta a la semana: sábado, domingo y lunes
    for (const t of ["xyz", "L-Z", "L-M-X", "festivos"]) eq(t, null);
  });

  await check("parseShift exige al menos un día; los siete días quedan como «todos»; los días entran en la descripción solo si no son todos", () => {
    if (!bad({ days: [] }).includes("al menos un día")) throw new Error("sin días");
    const a = ok({}); if (!a.ok || a.values.days !== null) throw new Error("todos los días");
    const b = ok({ days: ["6"] }); if (!b.ok || b.values.days !== 64 || !describeShift(b.values).startsWith("Apertura · Domingo · 05:30")) throw new Error(JSON.stringify(b));
  });

  await check("Descripción y texto de la actividad: «Todos los turnos» o la lista ordenada", () => {
    const r = ok({}); if (!r.ok) throw new Error("válido");
    if (describeShift(r.values) !== "Apertura · 05:30–13:00 · receso 30 min · 7 h netas") throw new Error(describeShift(r.values));
    if (activityShiftsText(true, ["Cierre"]) !== ALL_SHIFTS) throw new Error("todos");
    if (activityShiftsText(false, ["Cierre", "Apertura"]) !== "Apertura, Cierre" || activityShiftsText(false, []) !== "") throw new Error("lista");
  });

  await check("Si la actividad cambia de cargo, los turnos que no son de ese cargo se descartan (sin duplicados)", () => {
    const r = reconcileSelection(["a", "b", "b", "z"], ["a", "c"]);
    if (r.kept.join() !== "a" || r.dropped.join() !== "b,z") throw new Error(JSON.stringify(r));
  });
}
main().then(summary);
