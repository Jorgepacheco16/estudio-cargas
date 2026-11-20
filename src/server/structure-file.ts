/** Arma el formato vacío de «Estructura de la tienda» (D-113). No toca la base de datos ni lleva datos: solo encabezados, listas desplegables e instrucciones. */
import ExcelJS from "exceljs";
import { EMPLOYEE_COLUMNS, EMPLOYEE_ROWS, FIXED_VARIABLE, SALE_KIND, SHEET_EMPLOYEES, SHEET_STRUCTURE, STRUCTURE_COLUMNS, STRUCTURE_ROWS, YES_NO, type StructureColumn } from "../domain/structure-format";

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF00529B" } }, alignment: { vertical: "middle", wrapText: true } } as const;

function listOf(c: StructureColumn): string | null {
  if (c.control === "yesno") return `"${YES_NO.join(",")}"`;
  if (c.control === "sale") return `"${SALE_KIND.join(",")}"`;
  if (c.control === "fixvar") return `"${FIXED_VARIABLE.join(",")}"`;
  return null;
}

function addSheet(wb: ExcelJS.Workbook, name: string, cols: StructureColumn[], rows: number) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width; col.numFmt = "@"; // texto: Excel no reinterpreta «100 %» ni cifras
    const h = ws.getCell(1, i + 1); h.value = c.header; Object.assign(h, HEAD); h.note = c.hint;
    const list = listOf(c);
    if (list) for (let r = 2; r <= rows + 1; r++) ws.getCell(r, i + 1).dataValidation = { type: "list", allowBlank: true, formulae: [list], showErrorMessage: true, errorStyle: "warning", error: "Elija un valor de la lista." };
  });
  ws.getRow(1).height = 42;
  return ws;
}

export async function buildStructureTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio de actividades y cargas laborales";
  const st = addSheet(wb, SHEET_STRUCTURE, STRUCTURE_COLUMNS, STRUCTURE_ROWS);
  const emp = addSheet(wb, SHEET_EMPLOYEES, EMPLOYEE_COLUMNS, EMPLOYEE_ROWS);
  const letter = st.getColumn(STRUCTURE_COLUMNS.findIndex((c) => c.header === "Cargo") + 1).letter;
  for (let r = 2; r <= EMPLOYEE_ROWS + 1; r++) emp.getCell(r, 2).dataValidation = { type: "list", allowBlank: true, formulae: [`${SHEET_STRUCTURE}!$${letter}$2:$${letter}$${STRUCTURE_ROWS + 1}`], showErrorMessage: true, errorStyle: "warning", error: "Elija un cargo que esté en la hoja «Estructura»." };

  const ins = wb.addWorksheet("Instrucciones");
  ins.getColumn(1).width = 38; ins.getColumn(2).width = 110;
  ins.getCell(1, 1).value = "Estructura de la tienda · formato"; ins.getCell(1, 1).font = { bold: true, size: 14 };
  const lines = [
    "Diligencie «Estructura» (una fila por cargo en cada puesto físico o área) y «Empleados» (una fila por empleado). No cambie ni borre los encabezados.",
    "El formato sale vacío: la aplicación no escribe nada por usted.",
    "Pase el cursor por cada encabezado para ver qué se espera en la columna.",
  ];
  lines.forEach((t, i) => { ins.getCell(i + 3, 1).value = t; });
  const start = lines.length + 5;
  ["Columna", "Qué se registra"].forEach((t, i) => { const c = ins.getCell(start, i + 1); c.value = t; Object.assign(c, HEAD); });
  STRUCTURE_COLUMNS.forEach((c, i) => { ins.getCell(start + 1 + i, 1).value = c.header; ins.getCell(start + 1 + i, 2).value = c.hint; ins.getCell(start + 1 + i, 2).alignment = { wrapText: true, vertical: "top" }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
