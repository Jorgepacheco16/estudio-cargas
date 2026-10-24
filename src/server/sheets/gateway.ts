/** Acceso a una hoja de Google. La interfaz permite probar la lógica de sincronización contra una hoja simulada además de la real. */
import { pushCells, readRange, sheetsClient } from "../sheets";

export type CellValue = string | number | boolean | null;
export interface SheetGateway {
  read(range: string): Promise<unknown[][]>;
  /** Escribe como RAW: un texto que empiece por = + - @ queda como texto, nunca como fórmula. */
  write(updates: { range: string; values: CellValue[][] }[]): Promise<void>;
  /** Cantidad de columnas de la cuadrícula de una pestaña. */
  columnCount(sheetName: string): Promise<number>;
  /** Agrega columnas al final de la pestaña y las oculta. */
  appendHiddenColumns(sheetName: string, count: number): Promise<void>;
  title(): Promise<string>;
}

export function googleGateway(spreadsheetId: string): SheetGateway {
  const meta = async (sheetName: string) => {
    const r = await sheetsClient().spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties)" });
    const s = r.data.sheets?.find((x) => x.properties?.title === sheetName)?.properties;
    if (!s || s.sheetId === undefined || s.sheetId === null) throw new Error(`La hoja '${sheetName}' no existe en el archivo`);
    return { sheetId: s.sheetId, cols: s.gridProperties?.columnCount ?? 26 };
  };
  return {
    read: (range) => readRange(spreadsheetId, range),
    async write(updates) { if (updates.length) await pushCells(spreadsheetId, updates); },
    async columnCount(sheetName) { return (await meta(sheetName)).cols; },
    async appendHiddenColumns(sheetName, count) {
      const { sheetId, cols } = await meta(sheetName);
      await sheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { appendDimension: { sheetId, dimension: "COLUMNS", length: count } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: cols, endIndex: cols + count }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
      ] } });
    },
    async title() { const r = await sheetsClient().spreadsheets.get({ spreadsheetId, fields: "properties.title" }); return r.data.properties?.title ?? ""; },
  };
}
