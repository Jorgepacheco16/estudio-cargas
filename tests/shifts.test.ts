import { ALL_SHIFTS, activityShiftsText, describeShift, grossMinutes, netHours, normTime, parseShift, reconcileSelection } from "../src/domain/shifts";
import { check, summary } from "./helpers";

/** Turnos del cargo (D-67): validación, horas netas y selección de la actividad. Funciones puras. */
const ok = (i: Partial<Parameters<typeof parseShift>[0]>) => parseShift({ name: "Apertura", start: "5:30", end: "13:00", breakMin: "30", ...i });
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
