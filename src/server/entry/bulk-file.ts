/**
 * Carga masiva (D-72): plantilla de Excel descargable y lectura del archivo diligenciado, para las secciones «Cargos y dotación» (hoja 2) y
 * «Actividades» (hoja 3). Aquí solo se arma y se lee el archivo; la validación y el guardado están en bulk.ts.
 *
 * Plantilla: «Datos» (una fila por registro, con los mismos campos y encabezados del formulario; los obligatorios llevan *), «Turnos» (solo hoja 2:
 * una fila por turno de un cargo), «Instrucciones» y «Listas» (opciones válidas; alimentan los desplegables de «Datos»). Las columnas con fórmula del
 * libro no están: la app las calcula. Las celdas de «Datos» y «Turnos» son de TEXTO para que Excel no reinterprete números, fechas ni horas.
 */
import ExcelJS from "exceljs";
import { LABELS } from "../../domain/labels";
import { ALL_SHIFTS } from "../../domain/shifts";
import { SYNCED_SHEETS } from "../../domain/sheetmap";
import { ENTRY_IDS, type EntryDef, type EntryId } from "./defs";

export type BulkSheet = EntryId;
export const BULK_SHEETS: BulkSheet[] = ENTRY_IDS;
/** Filas máximas por carga: la capacidad de la hoja de Google de cada sección (2: 200; 3, 5, 6 y 7: 400; 8 y 10: 100; 9: 60). */
const capacityOf = (id: BulkSheet) => { const s = SYNCED_SHEETS.find((x) => x.target === (id === "3" ? "activities" : id)); return s ? s.lastDataRow - s.firstDataRow + 1 : 100; };
export const BULK_MAX_ROWS = Object.fromEntries(ENTRY_IDS.map((id) => [id, capacityOf(id)])) as Record<BulkSheet, number>;
export const BULK_MAX_BYTES = 1_500_000;

export const OPERATION_HEADER = "Descripción de la operación";
export const ACTIVITY_SHIFTS_HEADER = "Turnos en que se ejecuta";
export const SHIFT_SHEET = "Turnos";
export const SHIFT_HEADERS = { kind: "Tipo de dato", area: "Área", site: "Centro de operaciones", position: "Cargo", name: "Nombre del turno", start: "Hora de inicio", end: "Hora de fin", breakMin: "Receso (minutos)", days: "Días", type: "Tipo de turno" } as const;

export interface ParsedRow { rowNo: number; cells: Record<string, string>; operation: string; shiftsText: string; error?: string }
export interface ParsedShift { rowNo: number; kind: string; area: string; site: string; position: string; name: string; start: string; end: string; breakMin: string; days: string; type: string }
export interface ParsedUpload { rows: ParsedRow[]; shifts: ParsedShift[]; fileErrors: string[] }

/** Texto sin tildes, en minúsculas y sin el asterisco de «obligatorio»: para reconocer los encabezados aunque se hayan tocado. */
const key = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const isBulkSheet = (id: string): id is BulkSheet => (ENTRY_IDS as string[]).includes(id);
export const bulkEnabled = (id: string) => isBulkSheet(id);

interface Lookups { areas: string[]; activities: string[] }
function optionsOf(f: EntryDef["fields"][number], lk: Lookups): string[] {
  if (f.control === "area") return lk.areas;
  if (f.control === "activity") return lk.activities;
  if (f.control === "yesno") return ["Sí", "No"];
  if (f.control === "select" && f.list) return Object.keys(LABELS[f.list].map);
  return [];
}

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF00529B" } }, alignment: { vertical: "middle", wrapText: true } } as const;

/** Arma la plantilla de una sección. `areas` y `activities` (códigos) son las del estudio y alimentan las listas desplegables. */
export async function buildTemplate(def: EntryDef, areas: string[], activities: string[] = []): Promise<Buffer> {
  const lk: Lookups = { areas, activities };
  if (!isBulkSheet(def.id)) throw new Error("Esta sección aún no tiene carga masiva");
  const max = BULK_MAX_ROWS[def.id];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio de actividades y cargas laborales";

  /* Listas (opciones válidas) */
  const lists = wb.addWorksheet("Listas");
  const listRef = new Map<string, string>(); // campo → rango de la lista
  const kinds: { header: string; options: string[] }[] = [];
  for (const f of def.fields) { const o = optionsOf(f, lk); if (o.length) kinds.push({ header: f.header, options: o }); }
  kinds.push({ header: "Días (ejemplos)", options: ["Todos", "L-S", "L-V", "L, X, V", "Domingo"] });
  kinds.forEach((k, i) => {
    lists.getColumn(i + 1).width = Math.min(48, Math.max(14, k.header.length + 2));
    lists.getCell(1, i + 1).value = k.header; Object.assign(lists.getCell(1, i + 1), { font: HEAD.font, fill: HEAD.fill });
    k.options.forEach((o, j) => { lists.getCell(j + 2, i + 1).value = o; });
  });
  const rangeOf = (header: string) => {
    const i = kinds.findIndex((k) => k.header === header);
    const col = lists.getColumn(i + 1).letter;
    return `Listas!$${col}$2:$${col}$${kinds[i].options.length + 1}`;
  };
  for (const f of def.fields) if (optionsOf(f, lk).length) listRef.set(f.col, rangeOf(f.header));

  /* Datos */
  const ws = wb.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = [...def.fields.map((f) => ({ header: `${f.header}${f.required ? " *" : ""}`, hint: f.hint, width: Math.min(42, Math.max(16, f.header.length + 4)), ref: listRef.get(f.col), area: f.control === "textarea" })),
    ...(def.id === "2" ? [{ header: OPERATION_HEADER, hint: "Texto libre: cómo se opera el cargo en la práctica (no escriba nombres de personas). Vacío = no cambia la descripción actual.", width: 50, ref: undefined, area: true }] : def.id === "3" ? [{ header: ACTIVITY_SHIFTS_HEADER, hint: `«${ALL_SHIFTS}» o los nombres de los turnos del cargo separados por punto y coma (p. ej. Apertura; Cierre). Deben existir ya en el cargo. Vacío = no cambia los turnos actuales.`, width: 36, ref: undefined, area: false }] : [])];
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width; col.numFmt = "@";
    const h = ws.getCell(1, i + 1); h.value = c.header; Object.assign(h, HEAD); h.note = c.hint || c.header;
    if (c.ref) for (let r = 2; r <= max + 1; r++) ws.getCell(r, i + 1).dataValidation = { type: "list", allowBlank: true, formulae: [c.ref], showErrorMessage: true, errorStyle: "warning", error: "Elija un valor de la lista." };
  });
  ws.getRow(1).height = 32;

  /* Turnos (solo cargos) */
  if (def.id === "2") {
    const ts = wb.addWorksheet(SHIFT_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
    const h = Object.values(SHIFT_HEADERS);
    h.forEach((t, i) => { const c = ts.getCell(1, i + 1); c.value = i >= 1 && i <= 4 ? `${t} *` : t; Object.assign(c, HEAD); ts.getColumn(i + 1).width = i === 4 ? 26 : 18; ts.getColumn(i + 1).numFmt = "@"; });
    ts.getCell(1, 6).note = "Formato HH:MM, por ejemplo 05:30";
    ts.getCell(1, 7).note = "Formato HH:MM, por ejemplo 13:00. Si es menor que la de inicio, el turno cruza la medianoche.";
    ts.getCell(1, 9).note = "Todos, L-S, L-V, «L, X, V» o Domingo (L M X J V S D). Vacío = todos los días.";
    ts.getCell(1, 10).note = "Fijo o Variable: tipo de turno del cargo. Si es Variable, las filas de este cargo son FRANJAS horarias en las que se distribuyen los turnos. Vacío = no cambia el tipo actual.";
    ts.getRow(1).height = 32;
    const areaRange = areas.length ? rangeOf(def.fields.find((f) => f.control === "area")!.header) : null;
    const kindField = def.fields.find((f) => f.field === "kind");
    for (let r = 2; r <= 301; r++) {
      if (areaRange) ts.getCell(r, 2).dataValidation = { type: "list", allowBlank: true, formulae: [areaRange], showErrorMessage: true, errorStyle: "warning", error: "Elija un área de la lista." };
      ts.getCell(r, 10).dataValidation = { type: "list", allowBlank: true, formulae: ['"Fijo,Variable"'], showErrorMessage: true, errorStyle: "warning", error: "Elija Fijo o Variable." };
      if (kindField) ts.getCell(r, 1).dataValidation = { type: "list", allowBlank: true, formulae: [rangeOf(kindField.header)], showErrorMessage: true, errorStyle: "warning", error: "Elija REAL o DEMO." };
    }
  }

  /* Instrucciones */
  const ins = wb.addWorksheet("Instrucciones");
  ins.getColumn(1).width = 38; ins.getColumn(2).width = 14; ins.getColumn(3).width = 70; ins.getColumn(4).width = 50;
  const lines: string[] = [
    `Plantilla de carga masiva · ${def.short}`,
    "1. Diligencie la hoja «Datos»: una fila por registro. Los campos con * son obligatorios. No cambie ni borre los encabezados.",
    def.id !== "2" && def.id !== "3" ? "2. Los códigos de actividad que cite la hoja deben existir ya en la aplicación; los demás valores se validan con las mismas reglas del formulario." : def.id === "2" ? "2. Los turnos de cada cargo van en la hoja «Turnos» (una fila por turno), con el mismo tipo de dato, área, sede y cargo de «Datos»." : "2. Los turnos de la actividad se escriben con el nombre exacto del turno del cargo («Todos los turnos» o varios separados por punto y coma).",
    "3. Suba el archivo en la sección: la aplicación lo revisa SIN guardar nada y le muestra qué se crearía, qué se actualizaría y qué errores hay.",
    "4. Todo o nada: si hay un solo error no se guarda nada; corrija el archivo y vuelva a subirlo. Si hay registros que ya existen, deberá marcar «Actualizar existentes» para continuar.",
    `5. Máximo ${max} filas por carga y 1,5 MB. Las columnas con fórmula del libro no aparecen: la aplicación las calcula.`,
    "6. No escriba nombres de personas en los textos libres. No se admiten fórmulas en las celdas.",
  ];
  lines.forEach((t, i) => { const c = ins.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 14 }; });
  const start = lines.length + 2;
  ["Campo", "Obligatorio", "Qué se registra", "Valores permitidos"].forEach((t, i) => { const c = ins.getCell(start, i + 1); c.value = t; Object.assign(c, HEAD); });
  def.fields.forEach((f, i) => {
    const o = optionsOf(f, lk);
    ins.getCell(start + 1 + i, 1).value = f.header; ins.getCell(start + 1 + i, 2).value = f.required ? "Sí" : "No";
    ins.getCell(start + 1 + i, 3).value = f.hint; ins.getCell(start + 1 + i, 4).value = o.length ? o.join(" · ") : f.control === "number" ? "Número" : f.control === "percent" ? "Porcentaje (p. ej. 50 % o 50)" : f.control === "date" ? "Fecha AAAA-MM-DD" : "Texto libre";
  });
  ins.eachRow((r) => r.eachCell((c) => { c.alignment = { vertical: "top", wrapText: true }; }));

  wb.views = [{ x: 0, y: 0, width: 20000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ───────── Lectura del archivo diligenciado ───────── */

type CellLike = ExcelJS.Cell;
/** Texto de una celda; null y «error» se informan aparte. Las fórmulas NO se admiten (se evita la inyección de fórmulas). */
function cellText(cell: CellLike, control: string | undefined): { text: string; problem?: string } {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return { text: "" };
  if (typeof v === "string") return { text: v.trim() };
  if (typeof v === "boolean") return { text: v ? "Sí" : "No" };
  if (typeof v === "number") {
    if (control === "percent" && String(cell.numFmt ?? "").includes("%")) return { text: `${Math.round(v * 10000) / 100}%` };
    return { text: String(v) };
  }
  if (v instanceof Date) return { text: v.toISOString().slice(0, 10) };
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; formula?: unknown; sharedFormula?: unknown; text?: string; error?: string };
    if (o.formula !== undefined || o.sharedFormula !== undefined) return { text: "", problem: "tiene una fórmula (no se admiten; escriba el valor)" };
    if (o.error) return { text: "", problem: `tiene un error de Excel (${o.error})` };
    if (o.richText) return { text: o.richText.map((t) => t.text).join("").trim() };
    if (typeof o.text === "string") return { text: o.text.trim() };
  }
  return { text: String(v).trim() };
}
/** Hora de una celda de «Turnos»: texto «5:30», número (fracción de día) o fecha. */
function timeText(cell: CellLike): { text: string; problem?: string } {
  const v = cell.value as unknown;
  if (typeof v === "number" && v >= 0 && v < 1) { const m = Math.round(v * 1440); return { text: `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }; }
  if (v instanceof Date) return { text: `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}` };
  return cellText(cell, undefined);
}

/** Lee el archivo diligenciado. No valida el contenido (eso lo hace bulk.ts); sí informa lo que impide leerlo. */
export async function parseUpload(def: EntryDef, data: Buffer | ArrayBuffer): Promise<ParsedUpload> {
  const out: ParsedUpload = { rows: [], shifts: [], fileErrors: [] };
  if (!isBulkSheet(def.id)) { out.fileErrors.push("Esta sección aún no tiene carga masiva."); return out; }
  const size = data instanceof ArrayBuffer ? data.byteLength : data.length;
  if (size === 0) { out.fileErrors.push("El archivo está vacío."); return out; }
  if (size > BULK_MAX_BYTES) { out.fileErrors.push("El archivo supera 1,5 MB."); return out; }
  const head = Buffer.from(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + 4)).subarray(0, 2).toString("latin1");
  if (head !== "PK") { out.fileErrors.push("El archivo no es un Excel (.xlsx). Descargue la plantilla, diligéncielo y súbalo en ese formato."); return out; }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(data as never); } catch { out.fileErrors.push("No se pudo leer el archivo. Verifique que sea un .xlsx válido, descargado de la plantilla."); return out; }
  const max = BULK_MAX_ROWS[def.id];

  /* Datos */
  const ws = wb.getWorksheet("Datos") ?? wb.worksheets[0];
  if (!ws) { out.fileErrors.push("El archivo no tiene hojas."); return out; }
  const byHeader = new Map(def.fields.map((f) => [key(f.header), f]));
  const extraKey = def.id === "2" ? key(OPERATION_HEADER) : def.id === "3" ? key(ACTIVITY_SHIFTS_HEADER) : "@@sin columna adicional@@";
  for (const f of def.fields) byHeader.set(key(f.libroHeader), f); // plantillas descargadas antes de llamarlo «Centro de operaciones»
  const colField = new Map<number, EntryDef["fields"][number] | "extra">();
  const seen = new Set<string>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, n) => {
    const k = key(cellText(c, undefined).text);
    if (k === extraKey) { colField.set(n, "extra"); seen.add(k); }
    else if (byHeader.has(k)) { const f = byHeader.get(k)!; colField.set(n, f); seen.add(f.field); }
  });
  for (const f of def.fields) if (f.required && !seen.has(f.field)) out.fileErrors.push(`Falta la columna obligatoria «${f.header}» en la hoja «${ws.name}». Use la plantilla sin cambiar los encabezados.`);
  if (out.fileErrors.length) return out;
  if (ws.rowCount > max + 50) { out.fileErrors.push(`La hoja «${ws.name}» tiene demasiadas filas (máximo ${max} registros por carga).`); return out; }

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, string> = {}; let extra = ""; let problem: string | undefined; let any = false;
    for (const [n, f] of colField) {
      const t = cellText(row.getCell(n), f === "extra" ? undefined : f.control);
      if (t.problem && !problem) problem = `${f === "extra" ? "Columna adicional" : f.header}: ${t.problem}`;
      if (t.text !== "") any = true;
      if (f === "extra") extra = t.text; else cells[f.col] = t.text;
    }
    if (!any && !problem) continue; // fila vacía
    out.rows.push({ rowNo: r, cells, operation: def.id === "2" ? extra : "", shiftsText: def.id === "3" ? extra : "", error: problem });
  }
  if (out.rows.length > max) { out.fileErrors.push(`El archivo trae ${out.rows.length} filas; el máximo por carga es ${max}.`); return out; }

  /* Turnos (solo cargos) */
  if (def.id === "2") {
    const ts = wb.getWorksheet(SHIFT_SHEET);
    if (ts) {
      const idx = new Map<string, number>();
      ts.getRow(1).eachCell({ includeEmpty: false }, (c, n) => idx.set(key(cellText(c, undefined).text), n));
      if (!idx.has(key(SHIFT_HEADERS.site)) && idx.has("sede")) idx.set(key(SHIFT_HEADERS.site), idx.get("sede")!); // plantillas anteriores
      const need = [SHIFT_HEADERS.area, SHIFT_HEADERS.site, SHIFT_HEADERS.position, SHIFT_HEADERS.name];
      const missing = need.filter((h) => !idx.has(key(h)));
      if (missing.length) { out.fileErrors.push(`En la hoja «${SHIFT_SHEET}» faltan las columnas: ${missing.join(", ")}.`); return out; }
      const get = (r: number, h: string, time = false) => { const n = idx.get(key(h)); if (!n) return ""; const t = time ? timeText(ts.getRow(r).getCell(n)) : cellText(ts.getRow(r).getCell(n), undefined); return t.problem ? `⚠${t.problem}` : t.text; };
      for (let r = 2; r <= Math.min(ts.rowCount, 1000); r++) {
        const s: ParsedShift = { rowNo: r, kind: get(r, SHIFT_HEADERS.kind), area: get(r, SHIFT_HEADERS.area), site: get(r, SHIFT_HEADERS.site), position: get(r, SHIFT_HEADERS.position), name: get(r, SHIFT_HEADERS.name), start: get(r, SHIFT_HEADERS.start, true), end: get(r, SHIFT_HEADERS.end, true), breakMin: get(r, SHIFT_HEADERS.breakMin), days: get(r, SHIFT_HEADERS.days), type: get(r, SHIFT_HEADERS.type) };
        if (Object.entries(s).some(([k, v]) => k !== "rowNo" && v !== "")) out.shifts.push(s);
      }
      if (out.shifts.length > 300) { out.fileErrors.push("La hoja «Turnos» trae más de 300 turnos; el máximo por carga es 300."); return out; }
    }
  }
  if (!out.rows.length && !out.shifts.length) out.fileErrors.push("El archivo no tiene filas para cargar (la plantilla está vacía).");
  return out;
}
