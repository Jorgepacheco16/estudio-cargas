import { readFileSync } from "node:fs";
import { analyze } from "../src/domain/summary";
import { PRESETS, drillRows, type LevelKey } from "../src/domain/drill";
import { SITE_DISPERSION_LIMIT, compareSites, comparablePositions, readSites } from "../src/domain/sites";
import { drillConfig } from "../src/domain/contracts";
import { tablesFor } from "../src/lib/tables";
import { buildDashboard } from "../src/domain/dashboard";
import type { ActivityInput, StaffingInput } from "../src/domain/engine";
import { CALC_4A, calcValue, compare4a } from "../src/domain/calc4a";
import { occupantsOf } from "../src/domain/engine";
import { check, summary } from "./helpers";

/** Drill-down (§15.2) y comparador de sedes (hoja 2b) sobre los datos de la prueba dorada v1 (resultados idénticos al Excel). */
const TH = { high: 1, low: 0.5 };
const fx = JSON.parse(readFileSync("tests/fixtures/v1_base.json", "utf8"));
const a = analyze(fx.positions as StaffingInput[], fx.activities as ActivityInput[], fx.params, TH, "demo");
const close = (x: number | null | undefined, y: number) => x != null && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));

async function main() {
  await check("Las configuraciones predefinidas cumplen el contrato drillConfig y recorren Estudio → Área → Cargo → Actividad", () => {
    for (const c of Object.values(PRESETS)) { drillConfig.parse(c); if (c.levels.map((l) => l.key).join(">") !== "study>area>position>activity") throw new Error(c.id); }
    if (drillConfig.safeParse({ ...PRESETS["carga-por-area"], extra: 1 }).success) throw new Error("aceptó campos desconocidos");
  });

  await check("Nivel Estudio: una fila por área con horas, capacidad y % idénticos a la hoja 4b, y enlace al nivel Área", () => {
    const rows = drillRows(a, PRESETS["carga-por-area"], "study", {});
    if (rows.length === 0) throw new Error("sin filas");
    for (const r of rows) {
      const ar = a.areas.find((x) => x.area === r.label)!;
      if (!close(r.metrics.hours, ar.hours) || !close(r.metrics.capacity, ar.capacity) || (r.metrics.pct ?? null) !== (ar.pct ?? null)) throw new Error(`${r.label} difiere de 4b`);
      if (r.next?.level !== "area" || r.next.filters.area !== r.label) throw new Error("enlace al siguiente nivel");
    }
    const total = rows.reduce((s, r) => s + (r.metrics.hours ?? 0), 0);
    if (!close(total, a.kpis.hours)) throw new Error(`la suma de áreas (${total}) ≠ total (${a.kpis.hours})`);
  });

  await check("Bajar de nivel conserva el filtro heredado y los totales cuadran: Σ actividades de un cargo = horas del cargo en la hoja 4b (incluida su parte como cargo secundario)", () => {
    const area = drillRows(a, PRESETS["carga-por-area"], "study", {})[0];
    const positions = drillRows(a, PRESETS["carga-por-area"], "area", area.next!.filters);
    if (positions.some((p) => p.next?.filters.area !== area.label)) throw new Error("perdió el filtro de área");
    for (const p of positions) {
      const acts = drillRows(a, PRESETS["carga-por-area"], "position", p.next!.filters);
      const own = acts.reduce((s, x) => s + (x.metrics.hours ?? 0), 0);
      const row = a.positions.find((x) => x.area === p.next!.filters.area && x.site === p.next!.filters.site && x.position === p.next!.filters.position)!;
      if (!close(own, row.hours)) throw new Error(`${p.label}: Σ actividades ${own} ≠ horas del cargo ${row.hours} (hoja 4b)`);
    }
  });

  await check("Nivel Actividad: una sola fila con el código elegido y sin siguiente nivel; actividades incompletas no suman horas", () => {
    const some = a.activities[0];
    const rows = drillRows(a, PRESETS["carga-por-area"], "activity", { area: some.area, site: some.site, position: some.position, code: some.code } as never);
    if (rows.length !== 1 || rows[0].label !== some.code || rows[0].next !== null) throw new Error(JSON.stringify(rows));
    const incomplete = a.activities.find((x) => !x.complete);
    if (incomplete) {
      const r = drillRows(a, PRESETS["carga-por-area"], "activity", { code: incomplete.code } as never)[0];
      if (r.metrics.hours !== null) throw new Error("una actividad incompleta mostró horas");
    }
  });

  await check("Filtros: «solo sobrecarga», «solo carga baja» y «solo incompletos» devuelven únicamente filas de ese tipo", () => {
    for (const [alert, test] of [["overload", (l?: string) => l === "overload"], ["lowLoad", (l?: string) => l === "low"]] as const) {
      const rows = drillRows(a, PRESETS["carga-por-area"], "area", { alertOnly: alert });
      if (rows.some((r) => !test(r.level))) throw new Error(`${alert}: hay filas ajenas`);
    }
    const inc = drillRows(a, PRESETS["calidad-de-datos"], "position", {});
    if (inc.some((r) => r.status === "OK")) throw new Error("«calidad» mostró actividades completas");
  });

  await check("Modo REAL: un análisis sin datos reales no produce filas (el drill-down respeta el modo del análisis)", () => {
    const real = analyze(fx.positions as StaffingInput[], fx.activities as ActivityInput[], fx.params, TH, "real");
    for (const l of ["study", "area", "position", "activity"] as const) if (drillRows(real, PRESETS["carga-por-area"], l, {}).length !== 0) throw new Error(`mostró filas DEMO en modo real (${l})`);
  });

  await check("Comparador de sedes: textos idénticos a la fórmula F25 de la hoja 2b y dispersión = (máx − mín) ÷ promedio", () => {
    if (!readSites(0, null).startsWith("Sin datos para el cargo y el modo seleccionados")) throw new Error("sin datos");
    if (readSites(1, null) !== "El cargo está registrado en una sola sede: no hay base de comparación.") throw new Error("una sede");
    if (!readSites(2, SITE_DISPERSION_LIMIT + 0.01).startsWith("Diferencia relevante entre sedes")) throw new Error("diferencia");
    if (readSites(2, SITE_DISPERSION_LIMIT) !== "La carga por ocupante es similar entre sedes.") throw new Error("el límite exacto (30 %) no cuenta como diferencia relevante");
  });

  const staff: StaffingInput[] = [
    { dataKind: "real", area: "Cajas", site: "Norte", position: "Cajero", headcount: 2, weeklyHours: 42 },
    { dataKind: "real", area: "Cajas", site: "Sur", position: "Cajero", headcount: 4, weeklyHours: 42 },
    { dataKind: "real", area: "Cajas", site: "Centro", position: "Cajero", headcount: 2, weeklyHours: 42 },
    { dataKind: "real", area: "Cajas", site: "Solo", position: "Supervisor", headcount: 1, weeklyHours: 42 },
  ];
  const mk = (code: string, site: string, mins: number): ActivityInput => ({ code, dataKind: "real", area: "Cajas", site, position: "Cajero", employeeCode: null, calcMode: "per_event", scope: "position_total", executions: 1, period: "week", unitsPerExecution: null, timeAvgMin: mins, timeMinMin: null, timeMaxMin: null, seasonHigh: null, seasonLow: null, simultaneous: null, loadShare: null, secondaryPosition: null, planning: "planned", waitMin: null, waitOccupies: null, travelMin: null, reworkPct: null, reworkMin: null });
  const acts = [mk("N-1", "Norte", 600), mk("S-1", "Sur", 1200), mk("C-1", "Centro", 600)]; // horas por ocupante: 10/2=5, 20/4=5, 10/2=5 → similar
  const prm = { workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct: 0.1, scenario: "base" as const };
  await check("Comparador de sedes: cálculo por sede (ocupantes, jornada, horas por ocupante) y lecturas con datos controlados", () => {
    const similar = analyze(staff, acts, prm, TH, "real");
    const c = compareSites(similar, "Cajas", "Cajero", "real", 0.1);
    if (c.rows.length !== 3 || c.rows.some((r) => !close(r.perOccupant, 5) || !close(r.weeklyHours, 42))) throw new Error(JSON.stringify(c.rows));
    if (c.dispersion !== 0 || c.reading !== "La carga por ocupante es similar entre sedes.") throw new Error(`${c.dispersion} ${c.reading}`);
    const uneven = analyze(staff, [mk("N-1", "Norte", 600), mk("S-1", "Sur", 3000), mk("C-1", "Centro", 600)], prm, TH, "real"); // Sur: 50/4 = 12,5 h por ocupante
    const u = compareSites(uneven, "Cajas", "Cajero", "real", 0.1);
    if (!close(u.average, (5 + 12.5 + 5) / 3) || !close(u.dispersion, (12.5 - 5) / ((5 + 12.5 + 5) / 3)) || !u.reading.startsWith("Diferencia relevante")) throw new Error(JSON.stringify(u));
    const one = compareSites(similar, "Cajas", "Supervisor", "real", 0.1);
    if (one.reading !== "El cargo está registrado en una sola sede: no hay base de comparación.") throw new Error(one.reading);
    if (compareSites(similar, "Cajas", "Inexistente", "real", 0.1).rows.length !== 0) throw new Error("cargo inexistente");
    if (comparablePositions(similar, "real")[0].sites !== 3) throw new Error("el selector debe listar primero el cargo con más sedes");
    const und = compareSites(similar, "Cajas", "Cajero", "real", 0.1, new Map([["real|cajas|sur|cajero", 2]]));
    if (und.rows.find((r) => r.site === "Sur")?.undocumented !== 2 || und.rows.find((r) => r.site === "Norte")?.undocumented !== 0) throw new Error("no documentadas");
  });

  await check("Hoja 4a en pantalla: 19 columnas con los encabezados del libro; la comparación detecta diferencias y actividades ausentes", () => {
    if (CALC_4A.length !== 19 || new Set(CALC_4A.map((c) => c.col)).size !== 19) throw new Error("columnas");
    const occ = (row: (typeof a.activities)[number]) => occupantsOf(fx.positions as StaffingInput[], (fx.activities as ActivityInput[]).find((x) => x.code === row.code)!);
    // La «hoja de Google» simulada se arma con los mismos valores del motor: debe coincidir al 100 %.
    const sheet = new Map(a.activities.map((x) => [x.code.toLowerCase(), { status: x.status, v: Object.fromEntries(CALC_4A.map((c) => [c.col, calcValue(x, c.key, occ(x))])) as Record<string, number | null> }]));
    const ok = compare4a(a.activities, occ, sheet);
    if (ok.same !== a.activities.length || ok.diffs.length || ok.missingInSheet.length) throw new Error(JSON.stringify(ok));
    // Se altera un valor, se vacía una actividad y se quita otra: la comparación debe señalar exactamente eso.
    const complete = a.activities.filter((x) => x.complete);
    const first = sheet.get(complete[0].code.toLowerCase())!; first.v.AY = (first.v.AY ?? 0) + 0.5;
    sheet.delete(complete[1].code.toLowerCase());
    const bad = compare4a(a.activities, occ, sheet);
    if (bad.diffs.length !== 1 || bad.diffs[0].code !== complete[0].code || !bad.diffs[0].fields.includes("Horas/sem TOTALES de la actividad en la sede") || bad.missingInSheet.join() !== complete[1].code) throw new Error(JSON.stringify(bad));
  });

  await check("Exportables: el drill-down y el comparador exportan lo mismo que muestran", () => {
    const d = buildDashboard({ mode: "demo", analysis: a, params: fx.params, thresholds: TH, areaNames: [], assumptionsValidated: false, hourlyCost: null, meta: [], meas: [], suit: [], risks: [], opps: [], plans: [] });
    const shown = drillRows(a, PRESETS["carga-por-area"], "study", {}).length;
    const t = tablesFor("drill", a, d, [], { config: "carga-por-area", level: "study" }, "demo", 0.1).tables[0];
    if (t.rows.length !== shown) throw new Error(`${t.rows.length} ≠ ${shown}`);
    const sedes = tablesFor("sedes", analyze(staff, acts, prm, TH, "real"), d, [], { area: "Cajas", position: "Cajero" }, "real", 0.1).tables[0];
    if (sedes.rows.length !== 4) throw new Error(`filas de sedes ${sedes.rows.length}`); // 3 sedes + la fila de dispersión
  });
}
main().then(summary);
