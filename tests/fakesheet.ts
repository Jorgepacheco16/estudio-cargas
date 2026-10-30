import type { CellValue, SheetGateway } from "../src/server/sheets/gateway";
import { colToIndex, indexToCol } from "../src/domain/sheetmap";

/**
 * Hoja de cálculo en memoria que cumple la interfaz de Google (lectura UNFORMATTED, escritura RAW, columnas que se agregan).
 * Sustituye SOLO a la API de Google; la base de datos de las pruebas de sincronización es PostgreSQL real.
 * La prueba contra Google real está en scripts/test-sheets-live.ts.
 */
export class FakeSheet implements SheetGateway {
  grids = new Map<string, unknown[][]>();
  cols = new Map<string, number>();
  hidden = new Map<string, number>();
  writes = 0;
  constructor(tabs: Record<string, number>) { for (const [n, c] of Object.entries(tabs)) { this.grids.set(n, []); this.cols.set(n, c); } }

  private parse(range: string) {
    const m = range.match(/^'?(.+?)'?!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) throw new Error(`rango inválido ${range}`);
    return { sheet: m[1], c1: colToIndex(m[2]), r1: Number(m[3]), c2: m[4] ? colToIndex(m[4]) : colToIndex(m[2]), r2: m[5] ? Number(m[5]) : Number(m[3]) };
  }
  cell(sheet: string, col: string, row: number): unknown { return this.grids.get(sheet)?.[row - 1]?.[colToIndex(col) - 1] ?? null; }
  set(sheet: string, col: string, row: number, v: unknown) {
    const g = this.grids.get(sheet)!; while (g.length < row) g.push([]);
    const r = g[row - 1]; while (r.length < colToIndex(col)) r.push(null); r[colToIndex(col) - 1] = v;
  }
  setRow(sheet: string, row: number, cells: Record<string, unknown>) { for (const [c, v] of Object.entries(cells)) this.set(sheet, c, row, v); }

  async read(range: string): Promise<unknown[][]> {
    const { sheet, c1, r1, c2, r2 } = this.parse(range);
    const g = this.grids.get(sheet); if (!g) throw new Error(`no existe ${sheet}`);
    const out: unknown[][] = [];
    for (let r = r1; r <= Math.min(r2, g.length); r++) {
      const row = (g[r - 1] ?? []).slice(c1 - 1, c2).map((v) => (v === undefined || v === null ? "" : v));
      while (row.length && row[row.length - 1] === "") row.pop(); // la API recorta celdas vacías al final
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop(); // y filas vacías al final
    return out;
  }
  async write(updates: { range: string; values: CellValue[][] }[]) {
    for (const u of updates) {
      const { sheet, c1, r1 } = this.parse(u.range);
      u.values.forEach((row, i) => row.forEach((v, j) => this.set(sheet, indexToCol(c1 + j), r1 + i, v))); // RAW: se guarda tal cual, nunca como fórmula
      this.writes++;
    }
  }
  /** Las fórmulas se guardan como texto que empieza por «=» (esta hoja no las calcula). */
  async readFormulas(range: string) { return this.read(range); }
  formulaWrites = 0;
  async writeFormulas(updates: { range: string; values: string[][] }[]) {
    for (const u of updates) {
      const { sheet, c1, r1 } = this.parse(u.range);
      u.values.forEach((row, i) => row.forEach((v, j) => this.set(sheet, indexToCol(c1 + j), r1 + i, v)));
      this.formulaWrites++;
    }
  }
  async columnCount(sheetName: string) { return this.cols.get(sheetName)!; }
  async appendHiddenColumns(sheetName: string, count: number) { this.cols.set(sheetName, this.cols.get(sheetName)! + count); this.hidden.set(sheetName, (this.hidden.get(sheetName) ?? 0) + count); }
  async appendColumns(sheetName: string, count: number) { this.cols.set(sheetName, this.cols.get(sheetName)! + count); }
  async title() { return "hoja de prueba"; }
  protections = new Map<string, string[]>();
  async protect(sheetName: string, ranges: string[]) { this.protections.set(sheetName, ranges); }
}
