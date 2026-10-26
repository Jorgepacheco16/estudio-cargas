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
  /** Agrega columnas VISIBLES al final de la pestaña (p. ej. «Turnos del cargo», D-67). */
  appendColumns(sheetName: string, count: number): Promise<void>;
  title(): Promise<string>;
  /** Marca como «protegidos con aviso» los rangos indicados (A1, sin el nombre de la pestaña): quien edite a mano ve la advertencia, pero no se bloquea. Reemplaza los protegidos antes por la app. */
  protect(sheetName: string, ranges: string[], description: string): Promise<void>;
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
    async appendColumns(sheetName, count) {
      const { sheetId } = await meta(sheetName);
      await sheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: count } }] } });
    },
    async appendHiddenColumns(sheetName, count) {
      const { sheetId, cols } = await meta(sheetName);
      await sheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { appendDimension: { sheetId, dimension: "COLUMNS", length: count } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: cols, endIndex: cols + count }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
      ] } });
    },
    async title() { const r = await sheetsClient().spreadsheets.get({ spreadsheetId, fields: "properties.title" }); return r.data.properties?.title ?? ""; },
    async protect(sheetName, ranges, description) {
      const r = await sheetsClient().spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties),protectedRanges(protectedRangeId,description))" });
      const s = r.data.sheets?.find((x) => x.properties?.title === sheetName);
      if (!s?.properties || s.properties.sheetId === undefined || s.properties.sheetId === null) throw new Error(`La hoja '${sheetName}' no existe en el archivo`);
      const sheetId = s.properties.sheetId;
      const grid = (a1: string) => {
        const m = a1.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)!;
        const idx = (c: string) => c.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        return { sheetId, startRowIndex: Number(m[2]) - 1, endRowIndex: Number(m[4]), startColumnIndex: idx(m[1]) - 1, endColumnIndex: idx(m[3]) };
      };
      const requests = [
        ...(s.protectedRanges ?? []).filter((p) => p.description?.startsWith(description)).map((p) => ({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId! } })),
        ...ranges.map((a1) => ({ addProtectedRange: { protectedRange: { range: grid(a1), description, warningOnly: true } } })),
      ];
      if (requests.length) await sheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    },
  };
}
