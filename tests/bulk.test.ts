import ExcelJS from "exceljs";
import { entryDef } from "../src/server/entry/defs";
import { ACTIVITY_SHIFTS_HEADER, BULK_MAX_BYTES, OPERATION_HEADER, SHIFT_HEADERS, SHIFT_SHEET, buildTemplate, parseUpload } from "../src/server/entry/bulk-file";
import { check, summary } from "./helpers";

/** Carga masiva (D-72): plantilla y lectura del archivo, sin base de datos. La validación y el guardado se prueban en bulk-db.test.ts. */
const AREAS = ["Cajas", "Domicilios"];
const load = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as never); return wb; };
const save = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());
const colOf = (ws: ExcelJS.Worksheet, header: string) => { let n = 0; ws.getRow(1).eachCell((c, i) => { if (String(c.value).replace(/ \*$/, "") === header) n = i; }); if (!n) throw new Error(`sin columna ${header}`); return n; };

async function main() {
  const d2 = entryDef("2")!, d3 = entryDef("3")!;

  await check("Plantilla de cargos: hojas Datos, Turnos, Instrucciones y Listas; obligatorios con *; sin columnas con fórmula; con desplegables", async () => {
    const wb = await load(await buildTemplate(d2, AREAS));
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ["Datos", SHIFT_SHEET, "Instrucciones", "Listas"]) if (!names.includes(n)) throw new Error(`falta la hoja ${n}: ${names}`);
    const ws = wb.getWorksheet("Datos")!;
    const headers: string[] = []; ws.getRow(1).eachCell((c) => headers.push(String(c.value)));
    for (const f of d2.fields) if (!headers.includes(`${f.header}${f.required ? " *" : ""}`)) throw new Error(`falta ${f.header}`);
    if (!headers.includes(OPERATION_HEADER)) throw new Error("falta la descripción de la operación");
    for (const c of d2.computed) if (headers.some((h) => h.startsWith(c.header))) throw new Error(`incluyó la columna calculada ${c.header}`);
    const area = d2.fields.find((f) => f.control === "area")!;
    const dv = ws.getCell(2, colOf(ws, area.header)).dataValidation;
    if (dv?.type !== "list") throw new Error("el área no tiene desplegable");
    const ts = wb.getWorksheet(SHIFT_SHEET)!; const th: string[] = []; ts.getRow(1).eachCell((c) => th.push(String(c.value)));
    if (!th.includes(`${SHIFT_HEADERS.name} *`) || !th.includes(SHIFT_HEADERS.days)) throw new Error(`encabezados de turnos: ${th}`);
    if (ws.getCell(2, 1).numFmt !== "@") throw new Error("las celdas deben ser de texto");
  });

  await check("Plantilla de actividades: trae la columna de turnos, y no la de la descripción de la operación", async () => {
    const wb = await load(await buildTemplate(d3, AREAS));
    const ws = wb.getWorksheet("Datos")!; const headers: string[] = []; ws.getRow(1).eachCell((c) => headers.push(String(c.value)));
    if (!headers.includes(ACTIVITY_SHIFTS_HEADER) || headers.includes(OPERATION_HEADER)) throw new Error(headers.join("|"));
    if (wb.getWorksheet(SHIFT_SHEET)) throw new Error("la plantilla de actividades no lleva la hoja de turnos");
  });

  await check("Leer un archivo diligenciado: campos por columna, filas vacías omitidas, turnos y descripción", async () => {
    const wb = await load(await buildTemplate(d2, AREAS));
    const ws = wb.getWorksheet("Datos")!;
    const c = (f: string) => colOf(ws, d2.fields.find((x) => x.field === f)!.header);
    ws.getCell(2, c("area")).value = "Cajas"; ws.getCell(2, c("site")).value = "Prado"; ws.getCell(2, c("position")).value = "Fiscal"; ws.getCell(2, c("headcount")).value = "4"; ws.getCell(2, c("weeklyHours")).value = "42";
    ws.getCell(2, colOf(ws, OPERATION_HEADER)).value = "Apertura con 5 cajas.";
    ws.getCell(5, c("area")).value = "Domicilios"; ws.getCell(5, c("site")).value = "Prado"; ws.getCell(5, c("position")).value = "Auxiliar"; // las filas 3 y 4 quedan vacías
    const ts = wb.getWorksheet(SHIFT_SHEET)!;
    const h = (n: string) => { let i = 0; ts.getRow(1).eachCell((cc, k) => { if (String(cc.value).replace(/ \*$/, "") === n) i = k; }); return i; };
    ts.getCell(2, h(SHIFT_HEADERS.area)).value = "Cajas"; ts.getCell(2, h(SHIFT_HEADERS.site)).value = "Prado"; ts.getCell(2, h(SHIFT_HEADERS.position)).value = "Fiscal"; ts.getCell(2, h(SHIFT_HEADERS.name)).value = "Apertura";
    ts.getCell(2, h(SHIFT_HEADERS.start)).value = 330 / 1440; ts.getCell(2, h(SHIFT_HEADERS.end)).value = "13:00"; ts.getCell(2, h(SHIFT_HEADERS.breakMin)).value = "30"; ts.getCell(2, h(SHIFT_HEADERS.days)).value = "L-S";
    const p = await parseUpload(d2, await save(wb));
    if (p.fileErrors.length) throw new Error(p.fileErrors.join());
    if (p.rows.length !== 2 || p.rows[0].rowNo !== 2 || p.rows[1].rowNo !== 5) throw new Error(JSON.stringify(p.rows.map((r) => r.rowNo)));
    const f = (field: string) => d2.fields.find((x) => x.field === field)!.col;
    if (p.rows[0].cells[f("area")] !== "Cajas" || p.rows[0].cells[f("headcount")] !== "4" || p.rows[0].operation !== "Apertura con 5 cajas.") throw new Error(JSON.stringify(p.rows[0]));
    if (p.shifts.length !== 1 || p.shifts[0].start !== "05:30" || p.shifts[0].end !== "13:00" || p.shifts[0].days !== "L-S" || p.shifts[0].name !== "Apertura") throw new Error(JSON.stringify(p.shifts));
  });

  await check("Una celda con fórmula se rechaza (no se admiten fórmulas), y la fila lo indica", async () => {
    const wb = await load(await buildTemplate(d3, AREAS));
    const ws = wb.getWorksheet("Datos")!;
    const code = colOf(ws, d3.fields.find((x) => x.field === "code")!.header), name = colOf(ws, d3.fields.find((x) => x.field === "name")!.header);
    ws.getCell(2, code).value = "A-1"; ws.getCell(2, name).value = { formula: "1+1", result: 2 } as never;
    const p = await parseUpload(d3, await save(wb));
    if (p.rows.length !== 1 || !p.rows[0].error?.includes("fórmula")) throw new Error(JSON.stringify(p.rows));
  });

  await check("Archivos no válidos: vacío, que no es Excel, demasiado grande, sin la columna obligatoria o sin filas", async () => {
    if (!(await parseUpload(d3, Buffer.alloc(0))).fileErrors[0].includes("vacío")) throw new Error("vacío");
    if (!(await parseUpload(d3, Buffer.from("a,b\n1,2\n"))).fileErrors[0].includes("no es un Excel")) throw new Error("csv");
    const big = Buffer.alloc(BULK_MAX_BYTES + 1, 0x50); if (!(await parseUpload(d3, big)).fileErrors[0].includes("1,5 MB")) throw new Error("grande");
    const empty = await parseUpload(d3, await buildTemplate(d3, AREAS)); if (!empty.fileErrors.join().includes("no tiene filas")) throw new Error(`plantilla vacía: ${empty.fileErrors}`);
    const wb = await load(await buildTemplate(d3, AREAS)); const ws = wb.getWorksheet("Datos")!;
    const codeCol = colOf(ws, d3.fields.find((x) => x.field === "code")!.header); ws.getCell(1, codeCol).value = "Otra cosa";
    const bad = await parseUpload(d3, await save(wb)); if (!bad.fileErrors.join().includes("Falta la columna obligatoria")) throw new Error(`encabezado: ${bad.fileErrors}`);
  });

  await check("Los encabezados se reconocen aunque cambien las mayúsculas, las tildes o el asterisco", async () => {
    const wb = await load(await buildTemplate(d3, AREAS)); const ws = wb.getWorksheet("Datos")!;
    const cc = colOf(ws, d3.fields.find((x) => x.field === "code")!.header);
    ws.getCell(1, cc).value = d3.fields.find((x) => x.field === "code")!.header.toUpperCase();
    ws.getCell(2, cc).value = "B-7"; ws.getCell(2, colOf(ws, d3.fields.find((x) => x.field === "name")!.header)).value = "Revisar";
    const p = await parseUpload(d3, await save(wb));
    if (p.fileErrors.length || p.rows[0].cells[d3.fields.find((x) => x.field === "code")!.col] !== "B-7") throw new Error(JSON.stringify(p));
  });
}
main().then(summary);
