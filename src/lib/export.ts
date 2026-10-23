/** Exportación de tablas a CSV (Excel regional: ';' y coma decimal) y XLSX. Las celdas de texto nunca se interpretan como fórmulas. */
import ExcelJS from "exceljs";

export type Cell = string | number | null;
export interface Column { key: string; header: string; width?: number; fmt?: string }
export interface Table { name: string; columns: Column[]; rows: Record<string, Cell>[] }

/** Neutraliza inyección de fórmulas en CSV (=, +, -, @, tab, retorno) anteponiendo una comilla. */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const csvCell = (v: Cell): string => {
  if (v === null || v === undefined) return "";
  const t = typeof v === "number" ? String(v).replace(".", ",") : safeText(v);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function toCsv(t: Table): string {
  const head = t.columns.map((c) => csvCell(c.header)).join(";");
  const body = t.rows.map((r) => t.columns.map((c) => csvCell(r[c.key] ?? null)).join(";"));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}

export async function toXlsx(tables: Table[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio de Cargas"; wb.title = title; wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name.slice(0, 31));
    ws.columns = t.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, Math.min(48, c.header.length + 4)), style: c.fmt ? { numFmt: c.fmt } : {} }));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } }; h.alignment = { vertical: "middle", wrapText: true };
    h.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D3F94" } }; });
    h.height = 28; ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of t.rows) ws.addRow(t.columns.map((c) => r[c.key] ?? null));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
