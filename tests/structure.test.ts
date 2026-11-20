/** «Estructura de la tienda» (D-113): el formato sale vacío, con exactamente las columnas pedidas, y la sección se gobierna con Cargos y dotación. */
import ExcelJS from "exceljs";
import { buildStructureTemplate } from "../src/server/structure-file";
import { EMPLOYEE_COLUMNS, SHEET_EMPLOYEES, SHEET_STRUCTURE, STRUCTURE_COLUMNS } from "../src/domain/structure-format";
import { moduleOfPath } from "../src/domain/access";
import { menuHrefs } from "../src/lib/nav";

let fails = 0;
async function check(name: string, fn: () => void | Promise<void>) { try { await fn(); console.log("  ok  " + name); } catch (e) { fails++; console.log("FALLA " + name + ": " + (e as Error).message); } }

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildStructureTemplate()) as unknown as ArrayBuffer);
  await check("El formato trae las hojas Estructura, Empleados e Instrucciones", () => {
    const names = wb.worksheets.map((w) => w.name);
    if (names.join() !== [SHEET_STRUCTURE, SHEET_EMPLOYEES, "Instrucciones"].join()) throw new Error(names.join());
  });
  await check("Los encabezados son exactamente los pedidos, en orden y sin columnas de más", () => {
    const h = (n: string, k: number) => Array.from({ length: k }, (_, i) => String(wb.getWorksheet(n)!.getCell(1, i + 1).value));
    if (h(SHEET_STRUCTURE, STRUCTURE_COLUMNS.length).join("|") !== STRUCTURE_COLUMNS.map((c) => c.header).join("|")) throw new Error("Estructura");
    if (wb.getWorksheet(SHEET_STRUCTURE)!.getCell(1, STRUCTURE_COLUMNS.length + 1).value) throw new Error("hay una columna de más");
    if (h(SHEET_EMPLOYEES, EMPLOYEE_COLUMNS.length).join("|") !== EMPLOYEE_COLUMNS.map((c) => c.header).join("|")) throw new Error("Empleados");
  });
  await check("Sale vacío: ninguna fila de datos trae valores", () => {
    for (const n of [SHEET_STRUCTURE, SHEET_EMPLOYEES]) {
      const ws = wb.getWorksheet(n)!;
      for (let r = 2; r <= Math.min(ws.rowCount, 50); r++) ws.getRow(r).eachCell((c) => { if (c.value !== null && c.value !== "") throw new Error(`${n} fila ${r} trae «${c.value}»`); });
    }
  });
  await check("Las columnas Sí/No y Fijo/Variable llevan lista desplegable", () => {
    const ws = wb.getWorksheet(SHEET_STRUCTURE)!;
    STRUCTURE_COLUMNS.forEach((c, i) => { const v = ws.getCell(2, i + 1).dataValidation; if ((c.control !== "text") !== (v?.type === "list")) throw new Error(c.header); });
  });
  await check("La sección está en el menú y la gobierna Cargos y dotación", () => {
    if (!menuHrefs().includes("/estructura")) throw new Error("falta en el menú");
    if (moduleOfPath("/estructura") !== "cargos") throw new Error("módulo");
  });
  if (fails) { console.log(`\n${fails} falla(s)`); process.exit(1); }
  console.log("\nestructura: todo en verde");
})();
