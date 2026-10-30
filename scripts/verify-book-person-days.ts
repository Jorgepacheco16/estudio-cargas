/**
 * Verifica (D-89) que la fórmula «Factor a semana» de la hoja 4a del libro calcula igual que el motor de la app con la regla de días por persona (D-88).
 * Toma una copia TEMPORAL del libro, le agrega casos SINTÉTICOS (cargos con 42 h, jornadas mezcladas, 56 h con tope, sin horas, alcance del cargo y otros
 * períodos), le pone la fórmula nueva y la jornada diaria, lo recalcula con LibreOffice (siempre recalcula al abrir) y compara, fila por fila, las columnas
 * «Ejecuciones por semana» y «Horas-persona totales» del libro con el motor. Corre dos veces: con jornada diaria de 7 h y con la casilla vacía (debe dar lo
 * mismo que el libro original). No guarda nada del libro; solo imprime conteos y los números de fila que no coinciden.
 * Uso: tsx scripts/verify-book-person-days.ts <libro.xlsx> <soffice.com>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { computeActivity, occupantsOf, personDaysOf, type ActivityInput, type Params, type StaffingInput } from "../src/domain/engine";
import { FACTOR_COL, FACTOR_FIRST_ROW, FACTOR_LAST_ROW, factorFormula } from "../src/domain/calc4a";
import { LABELS } from "../src/domain/labels";

const [book, soffice] = process.argv.slice(2);
if (!book || !soffice) throw new Error("Uso: tsx scripts/verify-book-person-days.ts <libro.xlsx> <soffice.com>");

/** Lee las celdas directamente del XML (ExcelJS descarta los resultados de fórmula iguales a 0). */
async function rawCells(file: string): Promise<(sheet: string, addr: string) => string | number | null> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const txt = async (p: string) => await zip.file(p)!.async("string");
  const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const wbx = await txt("xl/workbook.xml"), rels = await txt("xl/_rels/workbook.xml.rels");
  const target = new Map([...rels.matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"|<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)].map((m) => [m[1] ?? m[4], m[2] ?? m[3]]));
  const files = new Map([...wbx.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => [unesc(m[1]), `xl/${target.get(m[2])!.replace(/^\/?(xl\/)?/, "")}`]));
  const shared = zip.file("xl/sharedStrings.xml") ? [...(await txt("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""))) : [];
  const cache = new Map<string, Map<string, string | number | null>>();
  for (const sheet of files.keys()) {
    const xml = await txt(files.get(sheet)!); const cells = new Map<string, string | number | null>();
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = /t="([^"]+)"/.exec(m[2])?.[1], body = m[3] ?? ""; const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val: string | number | null = null;
      if (t === "s" && v !== undefined) val = shared[Number(v)]; else if (t === "str" && v !== undefined) val = unesc(v);
      else if (t === "inlineStr") val = unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "b") val = v === "1" ? 1 : 0; else if (t === "e") val = null; else if (v !== undefined && v !== "") val = Number(v);
      cells.set(m[1], val);
    }
    cache.set(sheet, cells);
  }
  return (sheet, addr) => cache.get(sheet)?.get(addr) ?? null;
}

type Case = { kind: string; area: string; site: string; position: string; rows: [headcount: number | null, hours: number | null][] };
const CASES: Case[] = [
  { kind: "DEMO", area: "Área sintética", site: "Sede S1", position: "Cargo 42 h", rows: [[10, 42]] },
  { kind: "DEMO", area: "Área sintética", site: "Sede S1", position: "Cargo mixto", rows: [[5, 42], [5, 36]] },
  { kind: "DEMO", area: "Área sintética", site: "Sede S1", position: "Cargo 56 h", rows: [[10, 56]] },
  { kind: "DEMO", area: "Área sintética", site: "Sede S1", position: "Cargo sin horas", rows: [[10, null]] },
  { kind: "DEMO", area: "Área sintética", site: "Sede S2", position: "Cargo 48 h", rows: [[4, 48]] },
  { kind: "DEMO", area: "Área sintética", site: "Sede S1", position: "Cargo sin ocupantes", rows: [[null, 42]] },
];
// Actividades sintéticas: [cargo, período, alcance, ejecuciones]
const ACTS: [number, string, string, number][] = [
  [0, "Día", "Por colaborador", 2], [0, "Semana", "Por colaborador", 12], [0, "Día", "Total del cargo en la sede", 2], [0, "Mes", "Por colaborador", 20],
  [1, "Día", "Por colaborador", 2], [2, "Día", "Por colaborador", 2], [3, "Día", "Por colaborador", 2], [4, "Día", "Por colaborador", 3], [5, "Día", "Por colaborador", 2],
];

async function run(dir: string, tag: string, daily: number | null) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(book);
  const p = wb.getWorksheet("Parametros")!, h2 = wb.getWorksheet("2_Caracterizacion")!, h3 = wb.getWorksheet("3_Actividades")!, w4 = wb.getWorksheet("4a_Calculo_tiempos")!;
  p.getCell("C5").value = 7; p.getCell("B16").value = "Jornada laboral diaria (horas)"; p.getCell("C16").value = daily;
  let r2 = 180;
  for (const c of CASES) for (const [n, hrs] of c.rows) { h2.getCell(`A${r2}`).value = c.kind; h2.getCell(`B${r2}`).value = c.area; h2.getCell(`C${r2}`).value = c.site; h2.getCell(`E${r2}`).value = c.position; h2.getCell(`F${r2}`).value = n; h2.getCell(`K${r2}`).value = hrs; r2++; }
  ACTS.forEach(([ci, period, scope, ex], i) => {
    const r = 390 + i, c = CASES[ci];
    h3.getCell(`A${r}`).value = c.kind; h3.getCell(`B${r}`).value = `SIN-${i + 1}`; h3.getCell(`D${r}`).value = c.area; h3.getCell(`E${r}`).value = c.site; h3.getCell(`F${r}`).value = c.position;
    h3.getCell(`H${r}`).value = `Actividad sintética ${i + 1}`; h3.getCell(`O${r}`).value = "Por evento"; h3.getCell(`P${r}`).value = ex; h3.getCell(`Q${r}`).value = period; h3.getCell(`R${r}`).value = scope; h3.getCell(`T${r}`).value = 30;
  });
  for (let r = FACTOR_FIRST_ROW; r <= FACTOR_LAST_ROW; r++) w4.getCell(`${FACTOR_COL}${r}`).value = { formula: factorFormula(r).slice(1) } as ExcelJS.CellFormulaValue;
  const src = join(dir, `${tag}.xlsx`); await wb.xlsx.writeFile(src);
  const dst = join(dir, `salida-${tag}`); mkdirSync(dst, { recursive: true });
  const profile = join(dir, "perfil"); mkdirSync(join(profile, "user"), { recursive: true });
  writeFileSync(join(profile, "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>`);
  execFileSync(soffice, [`-env:UserInstallation=file:///${profile.replace(/\\/g, "/")}`, "--headless", "--convert-to", "xlsx", "--outdir", dst, src], { stdio: "ignore", timeout: 300000 });
  const cell = await rawCells(join(dst, `${tag}.xlsx`));

  const num = (s: string, a: string) => { const v = cell(s, a); return typeof v === "number" ? v : null; };
  const str = (s: string, a: string) => { const v = cell(s, a); return typeof v === "string" && v.trim() !== "" ? v : null; };
  const lab = (list: keyof typeof LABELS, v: string | null) => (v === null ? null : (LABELS[list].map as Record<string, string>)[v] ?? null);
  const staff: StaffingInput[] = [];
  for (let r = 7; r <= 406; r++) { const pos = str("2_Caracterizacion", `E${r}`); if (!pos) continue; staff.push({ dataKind: (lab("L_TipoDato", str("2_Caracterizacion", `A${r}`)) ?? "real") as "real" | "demo", area: str("2_Caracterizacion", `B${r}`) ?? "", site: str("2_Caracterizacion", `C${r}`) ?? "", position: pos, headcount: num("2_Caracterizacion", `F${r}`), weeklyHours: num("2_Caracterizacion", `K${r}`) }); }
  const prm: Params = { workDaysPerWeek: num("Parametros", "C5") ?? 7, weeksPerMonth: num("Parametros", "C6") ?? 52 / 12, weeksPerYear: num("Parametros", "C7") ?? 52, reservePct: num("Parametros", "C8") ?? 0.1, scenario: (lab("L_Escenario", str("Parametros", "C12")) ?? "base") as Params["scenario"], dailyWorkHours: num("Parametros", "C16") };
  let compared = 0, applied = 0; const bad: string[] = [];
  for (let r = 7; r <= 406; r++) {
    const code = str("4a_Calculo_tiempos", `C${r}`); if (!code) continue;
    const S = (c: string) => str("3_Actividades", `${c}${r}`), N = (c: string) => num("3_Actividades", `${c}${r}`);
    const a: ActivityInput = {
      code, dataKind: (lab("L_TipoDato", S("A")) ?? "real") as "real" | "demo", area: S("D") ?? "", site: S("E") ?? "", position: S("F") ?? "", employeeCode: S("G"),
      calcMode: lab("L_Modalidad", S("O")) as ActivityInput["calcMode"], scope: lab("L_Alcance", S("R")) as ActivityInput["scope"], executions: N("P"), period: lab("L_Periodo", S("Q")) as ActivityInput["period"],
      unitsPerExecution: N("S"), timeAvgMin: N("T"), timeMinMin: N("U"), timeMaxMin: N("V"), seasonHigh: N("W"), seasonLow: N("X"), simultaneous: N("AA"), loadShare: N("AB"), secondaryPosition: S("AC"),
      planning: lab("L_Planificada", S("AD")) as ActivityInput["planning"], waitMin: N("AI"), waitOccupies: S("AJ") === null ? null : S("AJ") === "Sí", travelMin: N("AK"), reworkPct: N("AL"), reworkMin: N("AM"),
    };
    const res = computeActivity(a, prm, occupantsOf(staff, a), personDaysOf(staff, a, prm));
    const okBook = str("4a_Calculo_tiempos", `AI${r}`) === "OK";
    if (okBook !== (res.status === "OK")) { bad.push(`fila ${r}: estado libro=${okBook} (${str("4a_Calculo_tiempos", `AI${r}`)}) motor=${res.status}`); continue; }
    if (!okBook) continue;
    compared++;
    if (a.period === "day" && a.scope === "per_employee" && personDaysOf(staff, a, prm) !== undefined) applied++;
    const pairs: [string, number | null, number | undefined][] = [["Ejecuciones por semana", num("4a_Calculo_tiempos", `AL${r}`), res.execPerWeek], ["Horas por semana", num("4a_Calculo_tiempos", `AY${r}`), res.hTotal], ["Horas por mes", num("4a_Calculo_tiempos", `BI${r}`), res.hMonth]];
    for (const [name, book, eng] of pairs) if (book === null || eng === undefined || Math.abs(book - eng) > 1e-9 * Math.max(1, Math.abs(eng))) bad.push(`fila ${r} ${name}: libro=${book} motor=${eng}`);
  }
  console.log(`${tag}: jornada diaria=${daily ?? "(vacía)"} · filas comparadas=${compared} · filas con la regla de días por persona=${applied} · diferencias=${bad.length}`);
  for (const b of bad.slice(0, 15)) console.log("   ", b);
  return bad.length;
}

(async () => {
  const dir = mkdtempSync(join(tmpdir(), "verif-dias-"));
  const lo = execFileSync(soffice, ["--version"]).toString().trim();
  console.log(`Recalculado con ${lo}`);
  const fails = (await run(dir, "con-jornada-7", 7)) + (await run(dir, "sin-jornada", null));
  console.log(fails === 0 ? "\nRESULTADO: el libro y la app coinciden en todos los casos." : `\nRESULTADO: ${fails} diferencias.`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
