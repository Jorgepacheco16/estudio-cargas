/** Columnas internas que la app agrega al final de cada hoja de Google: identificador y versión de cada fila (ocultas). */
import { indexToCol, INTERNAL_HEADERS } from "../../domain/sheetmap";
import type { Adapter } from "./adapters";
import type { SheetGateway } from "./gateway";

export const q = (sheet: string) => `'${sheet}'`;
export interface Conn { id: string; studyId: string; actorId: string; spreadsheetId: string; mode: string }
export async function findInternal(gw: SheetGateway, a: Adapter): Promise<{ idCol: string; verCol: string } | null> {
  const s = a.sheet, n = await gw.columnCount(s.sheetName);
  const header = ((await gw.read(`${q(s.sheetName)}!A${s.headerRow}:${indexToCol(n)}${s.headerRow}`))[0] ?? []) as unknown[];
  const [i, v] = [header.indexOf(INTERNAL_HEADERS.id), header.indexOf(INTERNAL_HEADERS.version)];
  return i >= 0 && v >= 0 ? { idCol: indexToCol(i + 1), verCol: indexToCol(v + 1) } : null;
}
export async function ensureInternal(gw: SheetGateway, a: Adapter): Promise<{ idCol: string; verCol: string }> {
  const found = await findInternal(gw, a);
  if (found) return found;
  const s = a.sheet, n = await gw.columnCount(s.sheetName);
  await gw.appendHiddenColumns(s.sheetName, 2);
  const [idCol, verCol] = [indexToCol(n + 1), indexToCol(n + 2)];
  await gw.write([{ range: `${q(s.sheetName)}!${idCol}${s.headerRow}:${verCol}${s.headerRow}`, values: [[INTERNAL_HEADERS.id, INTERNAL_HEADERS.version]] }]);
  return { idCol, verCol };
}

