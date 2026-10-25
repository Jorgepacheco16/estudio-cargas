/**
 * Genera src/domain/sheetfields.ts: el catálogo de columnas de cada hoja de captura del libro de referencia (letra, encabezado, ayuda, grupo y si es
 * de ENTRADA o una fórmula). Solo toma texto de plantilla (encabezados y ayudas), nunca datos del estudio.
 * Uso: tsx scripts/gen-sheetfields.ts <libro.xlsx>
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

const SHEETS: [string, string][] = [["2", "2_Caracterizacion"], ["3", "3_Actividades"], ["5", "5_Medibilidad"], ["6", "6_Pertinencia"], ["7", "7_Riesgos"], ["8", "8_Oportunidades"], ["9", "9_Rediseno"], ["10", "10_Plan_accion"]];
const txt = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") { const o = v as Record<string, unknown>; if ("richText" in o) return (o.richText as { text: string }[]).map((x) => x.text).join(""); if ("result" in o) return String(o.result ?? ""); return ""; }
  return String(v);
};
const isF = (v: unknown) => typeof v === "object" && v !== null && ("formula" in (v as object) || "sharedFormula" in (v as object));

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Uso: tsx scripts/gen-sheetfields.ts <libro.xlsx>");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const out: Record<string, unknown> = {};
  for (const [id, name] of SHEETS) {
    const ws = wb.getWorksheet(name)!;
    const columns: { col: string; header: string; hint: string; group: string; input: boolean }[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const header = txt(ws.getCell(6, c).value).trim();
      if (!header) continue;
      columns.push({ col: ws.getColumn(c).letter, header, hint: txt(ws.getCell(5, c).value).trim(), group: txt(ws.getCell(4, c).value).trim(), input: !isF(ws.getCell(7, c).value) });
    }
    out[id] = { sheetName: name, title: txt(ws.getCell("A1").value).trim(), note: txt(ws.getCell("A2").value).trim(), columns };
  }
  const body = `/**\n * GENERADO por scripts/gen-sheetfields.ts a partir del libro de referencia. No editar a mano.\n * Catálogo de columnas de las hojas de captura: letra, encabezado, ayuda, grupo y si es casilla de ENTRADA (amarilla) o fórmula (gris).\n */\nexport interface SheetColumn { col: string; header: string; hint: string; group: string; input: boolean }\nexport interface SheetCatalog { sheetName: string; title: string; note: string; columns: SheetColumn[] }\nexport const SHEET_FIELDS: Record<string, SheetCatalog> = ${JSON.stringify(out, null, 1)};\n`;
  writeFileSync("src/domain/sheetfields.ts", body);
  for (const [id] of SHEETS) { const cols = (out[id] as { columns: { input: boolean }[] }).columns; console.log(`hoja ${id}: ${cols.filter((c) => c.input).length} de entrada, ${cols.filter((c) => !c.input).length} calculadas`); }
}
main().catch((e) => { console.error(e); process.exit(1); });
