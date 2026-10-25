/**
 * Espejo app → Google Sheets. La APP es la única fuente de datos de entrada (D-62): este módulo escribe en la hoja de Google TODAS las casillas de
 * entrada (las amarillas) de las hojas 2, 3, 5, 6, 7, 8, 9 y 10, más los supuestos y la lista de áreas de «Parametros». Nunca toca las columnas con
 * fórmula. Lo que alguien edite a mano en una casilla de entrada se vuelve a escribir con el valor de la app; las filas borradas en la app se limpian.
 * Las filas de la hoja que no existen en la app NO se borran: se cuentan como «sin vincular» para que una persona decida.
 */
import { eq } from "drizzle-orm";
import { withRls, type Db } from "../../db/client";
import { areas, studyParameters } from "../../db/schema";
import { looksLikeFormula } from "../../domain/cellguard";
import { SHEET_FIELDS } from "../../domain/sheetfields";
import { colToIndex, indexToCol } from "../../domain/sheetmap";
import { labelOf } from "../../domain/calculators";
import { MIRROR_ADAPTERS, cellsOf, lastInputCol, type Adapter } from "./adapters";
import type { CellValue, SheetGateway } from "./gateway";
import { ensureInternal, findInternal, q, type Conn } from "./internal";

export interface PushStats { sheet: string; appended: number; refreshed: number; cleared: number; unchanged: number; unlinked: number; formulaLike: number; diffs?: string[] }
export const PROTECTION_NOTE = "Datos desde la app (no editar aquí)";

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const text = (v: unknown) => (blank(v) ? null : String(v));

/** ¿Es la misma casilla? Vacíos iguales; números con tolerancia (2.5 = «2,50»); texto sin espacios sobrantes. */
export function sameCell(cur: unknown, want: unknown): boolean {
  if (blank(cur) || blank(want)) return blank(cur) && blank(want);
  const [a, b] = [typeof cur === "number" ? cur : Number(String(cur).replace(",", ".")), typeof want === "number" ? want : Number(String(want).replace(",", "."))];
  if (typeof cur !== "string" || typeof want !== "string") { if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)); }
  const flat = (x: unknown) => String(x).replace(/\s+/g, " ").trim(); // saltos de línea y espacios repetidos no son un cambio
  return flat(cur) === flat(want);
}

/** Campos que identifican una fila cuando la hoja aún no tiene vínculo con la app (primera vinculación). */
const KEY_FIELDS: Record<string, string[]> = { "2": ["kind", "area", "site", "position", "employeeCode"], "9": ["kind", "area", "position"] };
const keyOfCells = (a: Adapter, get: (col: string) => unknown): string => {
  const parts = (KEY_FIELDS[a.sheet.target] ?? ["code"]).map((f) => norm(get(a.spec[f][0])));
  return parts.every((p) => p === "") ? "" : parts.join("|");
};

/** Columnas de entrada de la hoja agrupadas en rangos contiguos (para protegerlas con aviso). */
export function inputRanges(a: Adapter): string[] {
  const cols = SHEET_FIELDS[a.sheet.target === "activities" ? "3" : a.sheet.target].columns.filter((c) => c.input).map((c) => colToIndex(c.col)).sort((x, y) => x - y);
  const out: string[] = []; let start = cols[0], prev = cols[0];
  for (const c of [...cols.slice(1), Infinity]) { if (c !== prev + 1) { out.push(`${indexToCol(start)}${a.sheet.firstDataRow}:${indexToCol(prev)}${a.sheet.lastDataRow}`); start = c; } prev = c; }
  return out;
}

async function mirrorSheet(db: Db, conn: Conn, gw: SheetGateway, a: Adapter, dryRun: boolean): Promise<PushStats> {
  const s = a.sheet, name = s.sheetName;
  const internal = dryRun ? await findInternal(gw, a) : await ensureInternal(gw, a);
  const app = await withRls(db, { sub: conn.actorId }, (tx) => a.all(tx, conn.studyId));
  const first = s.firstDataRow, last = s.lastDataRow;
  const block = await gw.read(`${q(name)}!A${first}:${indexToCol(lastInputCol(a))}${last}`);
  const links = internal ? await gw.read(`${q(name)}!${internal.idCol}${first}:${internal.verCol}${last}`) : [];
  const inputCols = Object.values(a.spec).map(([col]) => col);
  // La columna «Tipo de dato» viene prellenada con «REAL» en todas las filas del libro: no cuenta para saber si una fila está ocupada.
  const kindCol = a.spec.kind?.[0];
  const dataCols = inputCols.filter((c) => c !== kindCol);
  const st: PushStats = { sheet: name, appended: 0, refreshed: 0, cleared: 0, unchanged: 0, unlinked: 0, formulaLike: 0, diffs: [] };
  const rowOfId = new Map<string, number>(), rowOfKey = new Map<string, number>(), used = new Set<number>();
  const cellAt = (row: number, col: string) => (block[row - first] ?? [])[colToIndex(col) - 1];
  const linkAt = (row: number) => (links[row - first] ?? []) as unknown[];
  for (let row = first; row <= last; row++) {
    const id = text(linkAt(row)[0]);
    const has = id !== null || dataCols.some((c) => !blank(cellAt(row, c)));
    if (!has) continue;
    used.add(row);
    if (id) rowOfId.set(id, row); else { const k = keyOfCells(a, (c) => cellAt(row, c)); if (k) rowOfKey.set(k, row); }
  }
  const nextFree = () => { for (let row = first; row <= last; row++) if (!used.has(row)) { used.add(row); return row; } throw new Error(`La hoja «${name}» no tiene filas libres (máximo ${last - first + 1})`); };

  const updates: { range: string; values: CellValue[][] }[] = [];
  const claimed = new Set<number>();
  for (const it of app) {
    const want = cellsOf(a, it.rec, it.extras);
    let row = rowOfId.get(it.rec.id) ?? rowOfKey.get(keyOfCells(a, (c) => want[c]));
    const isNew = row === undefined;
    if (row === undefined) row = nextFree();
    claimed.add(row);
    let changed = isNew;
    for (const [col, v] of Object.entries(want)) {
      if (sameCell(cellAt(row, col), v)) continue;
      if (typeof v === "string" && looksLikeFormula(v)) st.formulaLike++;
      if (!isNew && (st.diffs?.length ?? 0) < 40) st.diffs?.push(`${col}${row}: «${String(cellAt(row, col) ?? "").slice(0, 40)}» → «${String(v ?? "").slice(0, 40)}»`);
      updates.push({ range: `${q(name)}!${col}${row}`, values: [[v]] }); changed = true;
    }
    if (internal) {
      const link = linkAt(row);
      if (text(link[0]) !== it.rec.id || Number(link[1]) !== it.rec.version) { updates.push({ range: `${q(name)}!${internal.idCol}${row}:${internal.verCol}${row}`, values: [[it.rec.id, it.rec.version]] }); changed = true; }
    }
    if (isNew) st.appended++; else if (changed) st.refreshed++; else st.unchanged++;
  }
  // Filas vinculadas cuyo registro ya no existe en la app (borrado): se limpian sus casillas de entrada.
  const appIds = new Set(app.map((x) => x.rec.id));
  for (const [id, row] of rowOfId) {
    if (appIds.has(id)) continue;
    for (const col of dataCols) if (!blank(cellAt(row, col))) updates.push({ range: `${q(name)}!${col}${row}`, values: [[""]] });
    if (internal) updates.push({ range: `${q(name)}!${internal.idCol}${row}:${internal.verCol}${row}`, values: [["", ""]] });
    st.cleared++;
  }
  for (const row of rowOfKey.values()) if (!claimed.has(row)) st.unlinked++;
  if (!dryRun) for (let i = 0; i < updates.length; i += 400) await gw.write(updates.slice(i, i + 400));
  return st;
}

/** Supuestos del estudio y lista de áreas → hoja «Parametros». Solo las casillas de entrada (C5, C7–C13, C19–C23 y la lista E5…). */
export async function mirrorParameters(db: Db, conn: Conn, gw: SheetGateway, dryRun = false): Promise<PushStats> {
  const { p, ars } = await withRls(db, { sub: conn.actorId }, async (tx) => ({
    p: (await tx.select().from(studyParameters).where(eq(studyParameters.studyId, conn.studyId)))[0],
    ars: (await tx.select({ name: areas.name }).from(areas).where(eq(areas.studyId, conn.studyId)).orderBy(areas.sortOrder)).map((x) => x.name),
  }));
  const cells: Record<string, CellValue> = {
    C5: Number(p.workDaysPerWeek), C7: p.weeksPerYear, C8: Number(p.reservePct), C9: Number(p.overloadThreshold), C10: Number(p.lowLoadThreshold),
    C11: p.hourlyCostCop === null ? "" : Number(p.hourlyCostCop), C12: labelOf("L_Escenario", p.scenario) ?? "Base", C13: p.assumptionsValidated ? "Sí" : "No",
    C19: p.weightImpact, C20: p.weightEase, C21: p.weightEffort, C22: p.weightCost, C23: p.weightRisk,
  };
  const cur = await gw.read("'Parametros'!C5:C23");
  const st: PushStats = { sheet: "Parametros", appended: 0, refreshed: 0, cleared: 0, unchanged: 0, unlinked: 0, formulaLike: 0 };
  const updates: { range: string; values: CellValue[][] }[] = [];
  for (const [addr, v] of Object.entries(cells)) { const row = Number(addr.slice(1)); if (sameCell((cur[row - 5] ?? [])[0], v)) st.unchanged++; else { updates.push({ range: `'Parametros'!${addr}`, values: [[v]] }); st.refreshed++; } }
  const list = await gw.read("'Parametros'!E5:E40");
  const want = [...ars, ...Array(Math.max(0, 36 - ars.length)).fill("")].slice(0, 36);
  const diff = want.some((v, i) => !sameCell((list[i] ?? [])[0], v));
  if (diff) { updates.push({ range: "'Parametros'!E5:E40", values: want.map((v) => [v]) }); st.refreshed += ars.length; }
  if (!dryRun && updates.length) await gw.write(updates);
  return st;
}

/** Espeja todo: supuestos, áreas y las 8 hojas de captura. En vista previa (dryRun) solo cuenta, sin escribir. */
export async function pushAll(db: Db, conn: Conn, gw: SheetGateway, dryRun = false): Promise<PushStats[]> {
  const out: PushStats[] = [await mirrorParameters(db, conn, gw, dryRun)];
  for (const a of MIRROR_ADAPTERS) out.push(await mirrorSheet(db, conn, gw, a, dryRun));
  if (!dryRun) {
    for (const a of MIRROR_ADAPTERS) await gw.protect(a.sheet.sheetName, inputRanges(a), PROTECTION_NOTE);
  }
  return out;
}

/** Tras guardar o borrar un registro de una hoja: actualiza solo esa hoja en Google (más los supuestos si se pide). */
export async function pushSheet(db: Db, conn: Conn, gw: SheetGateway, adapter: Adapter): Promise<PushStats> {
  return mirrorSheet(db, conn, gw, adapter, false);
}
