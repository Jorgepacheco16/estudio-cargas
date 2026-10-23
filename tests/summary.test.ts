import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { analyze, readPosition } from "../src/domain/summary";
import { buildDashboard } from "../src/domain/dashboard";
import { toCsv, toXlsx } from "../src/lib/export";
import { tablesFor, VIEWS } from "../src/lib/tables";
import type { ActivityInput, Params, StaffingInput } from "../src/domain/engine";
import { check, summary } from "./helpers";

const TH = { high: 1, low: 0.5 };
const close = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));

async function main() {
  for (const f of ["v1_base", "v2_alta", "v3_max"]) {
    const fx = JSON.parse(readFileSync(`tests/fixtures/${f}.json`, "utf8"));
    const a = analyze(fx.positions as StaffingInput[], fx.activities as ActivityInput[], fx.params as Params, TH, "all");
    await check(`${f}: consolidación por cargo coincide con la hoja 4b del Excel`, () => {
      for (const p of fx.expectedPositions) {
        const got = a.positions.find((x) => x.dataKind === p.dataKind && x.area === p.area && x.site === p.site && x.position === p.position);
        if (!got) throw new Error(`falta ${p.position}`);
        if (!close(got.occupants, p.occupants) || !close(got.capacity, p.capacity) || !close(got.hours, p.hours) || !close(got.pct, p.pct)) throw new Error(`${p.position} difiere del Excel`);
      }
    });
  }

  await check("Lectura de cargo: textos idénticos a la fórmula de la hoja 4b", () => {
    const base = { activities: 3, complete: 3, hours: 10, capacity: 10 };
    const eq = (p: Parameters<typeof readPosition>[0], t: string) => { const r = readPosition(p, TH).reading; if (r !== t) throw new Error(`'${r}' ≠ '${t}'`); };
    eq({ ...base, pct: 1.2 }, "ALERTA: carga superior a la capacidad. Revise datos, solapamientos, horas extra y distribución");
    eq({ ...base, pct: 0.3 }, "VALIDAR: carga baja. Verifique que el inventario esté completo; no implica personal sobrante");
    eq({ ...base, pct: 0.8 }, "Dentro del rango");
    eq({ ...base, capacity: 0, pct: null }, "Falta registrar cantidad y jornada (hoja 2)");
    eq({ ...base, hours: 0, pct: null }, "Hay actividades pero ninguna con datos completos");
    eq({ activities: 0, complete: 0, hours: 0, capacity: 0, pct: null }, "Sin información registrada");
    eq({ ...base, complete: 2, pct: 0.8 }, "Dentro del rango · Hay actividades con datos incompletos");
  });

  const fx = JSON.parse(readFileSync("tests/fixtures/v1_base.json", "utf8"));
  const a = analyze(fx.positions, fx.activities, fx.params, TH, "demo");

  await check("El modo REAL no cuenta filas DEMO", () => {
    const r = analyze(fx.positions, fx.activities, fx.params, TH, "real");
    if (r.kpis.activities !== 0 || r.positions.length !== 0) throw new Error("hay filas demo en modo real");
  });

  await check("CSV: usa ';', coma decimal y neutraliza fórmulas inyectadas", () => {
    const csv = toCsv({ name: "t", columns: [{ key: "a", header: "A" }, { key: "n", header: "N" }], rows: [{ a: "=HYPERLINK(\"http://x\")", n: 1.5 }, { a: "+cmd", n: null }, { a: "dice \"hola\"; adiós", n: 2 }] });
    const lines = csv.split("\r\n");
    if (!csv.startsWith("﻿")) throw new Error("falta BOM");
    if (!lines[1].startsWith("\"'=HYPERLINK") || !lines[1].endsWith(";1,5")) throw new Error(`línea 1: ${lines[1]}`);
    if (!lines[2].startsWith("'+cmd")) throw new Error(`línea 2: ${lines[2]}`);
    if (lines[3] !== "\"dice \"\"hola\"\"; adiós\";2") throw new Error(`línea 3: ${lines[3]}`);
  });

  await check("XLSX: el archivo se relee y conserva filas, números y textos como texto", async () => {
    const t = { name: "Datos", columns: [{ key: "a", header: "Texto" }, { key: "n", header: "Número", fmt: "0.00" }], rows: [{ a: "=1+1", n: 3.14159 }, { a: "ok", n: null }] };
    const buf = await toXlsx([t], "prueba");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Datos")!;
    const c = ws.getCell("A2").value;
    if (typeof c !== "string" || c !== "=1+1") throw new Error(`la fórmula se interpretó: ${JSON.stringify(c)}`);
    if (ws.getCell("B2").value !== 3.14159 || ws.getCell("B3").value !== null) throw new Error("números alterados");
    if (ws.rowCount !== 3) throw new Error(`filas ${ws.rowCount}`);
  });

  const dash = buildDashboard({ mode: "demo", analysis: a, params: fx.params, thresholds: TH, areaNames: ["Cajas", "Carnes - Operaciones", "Domicilios"], assumptionsValidated: false, hourlyCost: null, meta: [], meas: [], suit: [], risks: [], opps: [], plans: [] });

  await check("Tablero: 12 indicadores, una línea por área del estudio y conclusiones con los textos del Excel", () => {
    if (dash.areas.length !== 3 || dash.areas.find((r) => r.area === "Domicilios")!.reading !== "Sin información registrada") throw new Error("áreas");
    if (!dash.conclusions[0].startsWith("COBERTURA: ") || !dash.conclusions.some((c) => c.startsWith("SUPUESTOS: ")) || !dash.conclusions.some((c) => c.startsWith("MODO: se están mostrando datos DEMO"))) throw new Error(dash.conclusions.join(" | "));
    if (tablesFor("tablero", a, dash).tables[0].rows.length !== 12) throw new Error("indicadores ≠ 12");
  });

  await check("Área = Σ horas totales de sus actividades (incluye la parte del cargo secundario no registrado, como el Excel)", () => {
    const staff: StaffingInput[] = [{ dataKind: "real", area: "A", site: "S", position: "P", headcount: 1, weeklyHours: 40 }];
    const act: ActivityInput = { code: "X", dataKind: "real", area: "A", site: "S", position: "P", employeeCode: null, calcMode: "per_event", scope: "position_total", executions: 1, period: "week", unitsPerExecution: null, timeAvgMin: 60, timeMinMin: null, timeMaxMin: null, seasonHigh: null, seasonLow: null, simultaneous: null, loadShare: 0.5, secondaryPosition: "Q", planning: "planned", waitMin: null, waitOccupies: null, travelMin: null, reworkPct: null, reworkMin: null };
    const r = analyze(staff, [act], { workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct: 0, scenario: "base" }, TH, "real");
    if (Math.abs(r.areas[0].hours - 1) > 1e-9) throw new Error(`área ${r.areas[0].hours}`);
    const q = r.positions.find((p) => p.position === "Q");
    if (!q || Math.abs(q.hours - 0.5) > 1e-9 || q.reading !== "Falta registrar cantidad y jornada (hoja 2)") throw new Error(`cargo secundario: ${JSON.stringify(q)}`);
  });

  await check("Todas las vistas exportan: encabezados presentes y filas = pantalla", async () => {
    for (const v of VIEWS) {
      const { title, tables } = tablesFor(v, a, dash);
      const buf = await toXlsx(tables, title);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
      for (const t of tables) {
        const ws = wb.getWorksheet(t.name.slice(0, 31));
        if (!ws) throw new Error(`${v}: falta hoja ${t.name}`);
        if (ws.rowCount !== t.rows.length + 1) throw new Error(`${v}/${t.name}: ${ws.rowCount - 1} filas ≠ ${t.rows.length}`);
      }
    }
    const act = tablesFor("actividades", a, dash).tables[0].rows.length, cargos = tablesFor("cargos", a, dash).tables[0].rows.length;
    if (act !== a.activities.length || cargos !== a.positions.length) throw new Error("exportable ≠ pantalla");
  });
}
main().then(summary);
