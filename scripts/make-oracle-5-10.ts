/**
 * Genera el oráculo de las hojas 5 a 10 (brief §17): copia TEMPORAL del libro de referencia con casos límite SINTÉTICOS en las columnas de entrada,
 * recalculado por LibreOffice (siempre recalcula al abrir) y leído de vuelta. Solo se guardan entradas sintéticas y resultados: nada del libro del cliente.
 * Uso: tsx scripts/make-oracle-5-10.ts <libro.xlsx> <soffice.com>   →   tests/fixtures/oracle_5_10.json
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { LABELS } from "../src/domain/labels";

const [book, soffice] = process.argv.slice(2);
if (!book || !soffice) throw new Error("Uso: tsx scripts/make-oracle-5-10.ts <libro.xlsx> <soffice.com>");

/**
 * Lee las celdas de un xlsx directamente del XML. ExcelJS descarta los resultados de fórmula iguales a 0 y aquí los ceros importan,
 * así que no se usa para leer lo que calculó LibreOffice.
 */
async function rawCells(file: string): Promise<(sheet: string, addr: string) => string | number | null> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const txt = async (p: string) => (await zip.file(p)!.async("string"));
  const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const wbx = await txt("xl/workbook.xml"), rels = await txt("xl/_rels/workbook.xml.rels");
  const target = new Map([...rels.matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"|<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)].map((m) => [m[1] ?? m[4], m[2] ?? m[3]]));
  const files = new Map([...wbx.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => [unesc(m[1]), `xl/${target.get(m[2])!.replace(/^\/?(xl\/)?/, "")}`]));
  const shared = zip.file("xl/sharedStrings.xml") ? [...(await txt("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""))) : [];
  const cache = new Map<string, Map<string, string | number | null>>();
  const load = async (sheet: string) => {
    const hit = cache.get(sheet); if (hit) return hit;
    const xml = await txt(files.get(sheet)!); const cells = new Map<string, string | number | null>();
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = /t="([^"]+)"/.exec(m[2])?.[1], body = m[3] ?? ""; const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val: string | number | null = null;
      if (t === "s" && v !== undefined) val = shared[Number(v)]; else if (t === "str" && v !== undefined) val = unesc(v); else if (t === "inlineStr") val = unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "b") val = v === "1" ? 1 : 0; else if (t === "e") val = null; else if (v !== undefined && v !== "") val = Number(v);
      cells.set(m[1], val);
    }
    cache.set(sheet, cells); return cells;
  };
  const sheets = [...files.keys()]; await Promise.all(sheets.map(load));
  return (sheet, addr) => cache.get(sheet)?.get(addr) ?? null;
}

/* Generador pseudoaleatorio con semilla: el fixture es reproducible. */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const labels = (list: keyof typeof LABELS) => Object.keys(LABELS[list].map);
type Cell = string | number | Date | null;
type Rec = Record<string, Cell>;
const R = rng(20261024);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
const maybe = <T,>(xs: readonly T[], pBlank = 0.15): T | null => (R() < pBlank ? null : pick(xs));
const scale = (): number | null => maybe([1, 2, 3, 4, 5], 0.2);

const SIPN = ["Sí", "Parcial", "No"], SINO = ["Sí", "No"], AMB = ["Alta", "Media", "Baja"];
const txt = (p = 0.5) => (R() < p ? "texto de prueba" : null);

const genMeas = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ B: `OR-${i + 1}`, G: maybe(SIPN), H: maybe(SINO), I: maybe(SIPN), J: maybe(SINO), K: maybe(AMB), L: maybe(AMB), M: maybe(SIPN), N: maybe(labels("L_Unidad"), 0.5), O: maybe(labels("L_Indicador"), 0.4), P: txt(0.4) }));
const genSuit = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ B: `OR-${i + 1}`, P: txt(0.5), Q: maybe(SIPN), R: maybe(["Sí", "Condicionada", "No"]), S: maybe(SINO), T: maybe(labels("L_Situacion"), 0.15), U: maybe(SINO), V: maybe(SINO) }));
const genRisk = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ B: `OR-${i + 1}`, H: scale(), I: scale(), J: scale(), K: scale(), L: scale(), M: scale(), Q: maybe([0, 1, 2, 3, 5, 10], 0.2) }));
const genOpp = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ B: `OP-${i + 1}`, D: maybe(labels("L_Hallazgo"), 0.12), G: txt(0.5), M: maybe([0, 0.5, 2, 3.25, 10], 0.25), Q: scale(), R: scale(), S: scale(), T: scale(), U: scale() }));
const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86400000);
const genPlan = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ B: `AC-${i + 1}`, K: maybe([0, 10, 40, 100], 0.2) === null ? null : day(pick([0, 10, 40, 100])), L: R() < 0.2 ? null : day(pick([-5, 0, 30, 60, 160, 400])), P: maybe([0, 10, 100, 2.5], 0.2), Q: maybe(labels("L_EstadoPlan"), 0.15), R: maybe([0, 5, 12, 100, 3.75], 0.3) }));

/* Casos deterministas en los límites de cada regla (se anteponen a los aleatorios). */
const base5 = { G: "Sí", H: "Sí", I: "Sí", J: "Sí", K: "Alta", L: "Baja", M: "Sí", N: null, O: null, P: null };
const edge5: Rec[] = [{ ...base5 }, { ...base5, G: "No", H: "No", I: "No", J: "No", K: "Baja", M: "No" }, { ...base5, I: "Parcial", J: "No", H: "No", K: "Media", M: "No" },
  { ...base5, G: "Sí", H: "No", I: "Sí", J: "Sí", K: "Baja", M: "Sí" }, { ...base5, G: "Parcial", H: "No", I: "Parcial", J: "No", K: "Media", M: "Parcial" }, { ...base5, M: null }, { ...base5, L: "Alta", O: "Tiempo de ciclo" }].map((r, i) => ({ B: `ED-${i + 1}`, ...r }));

type Batch = { params: { costoHora: number | null; semanasAnio: number; pesos: number[]; fechaCorte: string }; meas: Rec[]; suit: Rec[]; risk: Rec[]; opp: Rec[]; plan: Rec[]; redesign: Rec[] };
const batches: Batch[] = [
  { params: { costoHora: null, semanasAnio: 52, pesos: [3, 2, 1, 1, 1], fechaCorte: "2026-06-15" }, meas: [...Array.from({ length: 7 }, (_, i) => ({ B: `TIPO-${i + 1}`, G: null, H: null, I: null, J: null, K: null, L: null, M: null, N: null, O: null, P: null })), ...edge5, ...genMeas(383)], suit: genSuit(400), risk: genRisk(400), opp: genOpp(100), plan: genPlan(100), redesign: [] },
  { params: { costoHora: 12345.5, semanasAnio: 48, pesos: [5, 1, 2, 3, 4], fechaCorte: "2026-01-20" }, meas: genMeas(400), suit: genSuit(400), risk: genRisk(400), opp: genOpp(100), plan: genPlan(100), redesign: [] },
];

async function main() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(book);
  const dir = mkdtempSync(join(tmpdir(), "oracle-")); const out: unknown[] = [];

  /* 4b: pares (área, cargo) reales para la hoja 9, solo como referencia interna: sus nombres NO se guardan. */
  const w4 = wb.getWorksheet("4b_Cargas")!;
  const pairs: { area: string; pos: string }[] = [];
  for (let r = 36; r <= 235 && pairs.length < 6; r++) {
    const [a, p, k] = [w4.getCell(`A${r}`).value, w4.getCell(`C${r}`).value, w4.getCell(`D${r}`).value];
    const pl = (v: unknown) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v);
    if (typeof pl(a) === "string" && typeof pl(p) === "string" && pl(k) === "REAL" && pl(a) !== "") pairs.push({ area: pl(a) as string, pos: pl(p) as string });
  }
  const w3 = wb.getWorksheet("3_Actividades")!;
  const types = labels("L_TipoAct"); const realCodes: string[] = [];
  for (let r = 7; r < 7 + types.length; r++) { const c = w3.getCell(`B${r}`).value; if (typeof c === "string") { realCodes.push(c); w3.getCell(`AP${r}`).value = types[r - 7]; } }
  if (realCodes.length < types.length) throw new Error("Se necesitan al menos 7 actividades en la hoja 3 del libro de referencia para cubrir los tipos");

  for (const [bi, b] of batches.entries()) {
    const wp = wb.getWorksheet("Parametros")!;
    wp.getCell("C11").value = b.params.costoHora; wp.getCell("C7").value = b.params.semanasAnio;
    ["C19", "C20", "C21", "C22", "C23"].forEach((c, i) => { wp.getCell(c).value = b.params.pesos[i]; });
    wp.getCell("C14").value = new Date(`${b.params.fechaCorte}T00:00:00Z`); // fecha de corte fija (en el libro es HOY())

    const fill = (name: string, first: number, last: number, rows: Rec[], cols: string[]) => {
      const ws = wb.getWorksheet(name)!;
      for (let r = first; r <= last; r++) for (const c of cols) ws.getCell(`${c}${r}`).value = null;
      rows.forEach((row, i) => { for (const [c, v] of Object.entries(row)) ws.getCell(`${c}${first + i}`).value = v as ExcelJS.CellValue; });
    };
    const withCodes = (rows: Rec[]) => rows.map((r, i) => (i < types.length && bi === 0 ? r : r));
    fill("5_Medibilidad", 7, 406, withCodes(b.meas), ["B", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]);
    // Las 7 primeras filas del lote 1 usan un código REAL de la hoja 3 (cuyo tipo se fijó arriba) para comprobar el indicador sugerido; en el fixture queda el marcador TIPO-n.
    const sug = wb.getWorksheet("5_Medibilidad")!; const sugRows: Rec[] = [];
    if (bi === 0) types.forEach((t, i) => { sug.getCell(`B${7 + i}`).value = realCodes[i]; sugRows.push({ __row: 7 + i, __type: t }); });
    fill("6_Pertinencia", 7, 406, b.suit, ["B", "P", "Q", "R", "S", "T", "U", "V"]);
    fill("7_Riesgos", 7, 406, b.risk, ["B", "H", "I", "J", "K", "L", "M", "Q"]);
    fill("8_Oportunidades", 7, 106, b.opp, ["B", "D", "G", "M", "Q", "R", "S", "T", "U"]);
    fill("10_Plan_accion", 7, 106, b.plan, ["B", "K", "L", "P", "Q", "R"]);

    const hours = [null, 0, 3, 5.5, 40, 400];
    const red: Rec[] = [];
    for (let k = 0; k < 60; k++) { const p = k % 10 === 9 ? { area: "Área inventada", pos: "Cargo inventado" } : pairs[k % pairs.length]; red.push({ A: "REAL", B: p.area, C: p.pos, J: maybe(["Cargo B"], 0.4), T: maybe(hours), U: maybe(hours), V: maybe(hours), __pair: k % 10 === 9 ? -1 : k % pairs.length }); }
    b.redesign = red;
    const w9 = wb.getWorksheet("9_Rediseno")!;
    for (let r = 7; r <= 66; r++) for (const c of ["A", "B", "C", "J", "T", "U", "V"]) w9.getCell(`${c}${r}`).value = null;
    red.forEach((row, i) => { for (const [c, v] of Object.entries(row)) if (!c.startsWith("__")) w9.getCell(`${c}${7 + i}`).value = v as ExcelJS.CellValue; });

    const src = join(dir, `lote${bi}.xlsx`); await wb.xlsx.writeFile(src);
    const dst = join(dir, `salida${bi}`); mkdirSync(dst, { recursive: true });
    const profile = join(dir, "perfil"); mkdirSync(join(profile, "user"), { recursive: true });
    writeFileSync(join(profile, "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>`);
    execFileSync(soffice, [`-env:UserInstallation=file:///${profile.replace(/\\/g, "/")}`, "--headless", "--convert-to", "xlsx", "--outdir", dst, src], { stdio: "ignore", timeout: 300000 });

    const cell = await rawCells(join(dst, `lote${bi}.xlsx`));
    const val = (name: string, a: string) => cell(name, a);
    const grab = (name: string, first: number, rows: Rec[], outCols: string[]) => {
      return rows.map((row, i) => ({ in: Object.fromEntries(Object.entries(row).filter(([c]) => !c.startsWith("__")).map(([c, v]) => [c, v instanceof Date ? v.toISOString().slice(0, 10) : v])), out: Object.fromEntries(outCols.map((c) => [c, val(name, `${c}${first + i}`)])) }));
    };
    out.push({
      params: b.params,
      meas: grab("5_Medibilidad", 7, b.meas, ["Q", "R", "T"]),
      suggested: sugRows.map((s) => ({ type: s.__type, S: val("5_Medibilidad", `S${s.__row}`) })),
      suit: grab("6_Pertinencia", 7, b.suit, ["W", "X"]),
      risk: grab("7_Riesgos", 7, b.risk, ["T", "U", "V", "W"]),
      opp: grab("8_Oportunidades", 7, b.opp, ["N", "Z", "AA", "AB", "AC"]),
      plan: grab("10_Plan_accion", 7, b.plan, ["S", "T", "U", "V"]),
      redesign: grab("9_Rediseno", 7, b.redesign, ["Q", "R", "S", "W", "X", "Y"]).map((r, i) => ({ in: { J: r.in.J ?? null, T: r.in.T ?? null, U: r.in.U ?? null, V: r.in.V ?? null }, out: r.out, pair: (b.redesign[i] as Rec).__pair })),
    });
  }
  const lo = execFileSync(soffice, ["--version"]).toString().trim();
  writeFileSync("tests/fixtures/oracle_5_10.json", JSON.stringify({ generatedWith: lo, seed: 20261024, batches: out }));
  const size = readFileSync("tests/fixtures/oracle_5_10.json").length;
  console.log(`Fixture escrito (${(size / 1024).toFixed(0)} KB) con ${lo}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
