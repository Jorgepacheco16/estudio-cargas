/** Hojas de Google Sheets que se sincronizan y utilidades de columnas. Los contratos del evento y del mapeo están en contracts.ts; la firma, en server/webhook.ts. */

export type SyncTarget = "activities" | "5" | "6" | "7" | "8" | "10";
export interface SyncedSheet { sheetName: string; headerRow: number; firstDataRow: number; keyColumn: string; target: SyncTarget }

/** Clave natural en la columna B (código), datos desde la fila 7. Las hojas 2 y 9 tienen clave compuesta (área/sede/cargo) y quedan fuera de esta versión (D-37); 4a, 4b y 11 son calculadas y la guía no lleva datos. */
export const SYNCED_SHEETS: SyncedSheet[] = [
  { sheetName: "3_Actividades", headerRow: 6, firstDataRow: 7, keyColumn: "B", target: "activities" },
  { sheetName: "5_Medibilidad", headerRow: 6, firstDataRow: 7, keyColumn: "B", target: "5" },
  { sheetName: "6_Pertinencia", headerRow: 6, firstDataRow: 7, keyColumn: "B", target: "6" },
  { sheetName: "7_Riesgos", headerRow: 6, firstDataRow: 7, keyColumn: "B", target: "7" },
  { sheetName: "8_Oportunidades", headerRow: 6, firstDataRow: 7, keyColumn: "B", target: "8" },
  { sheetName: "10_Plan_accion", headerRow: 6, firstDataRow: 7, keyColumn: "B", target: "10" },
];
export const syncedSheet = (name: string) => SYNCED_SHEETS.find((s) => s.sheetName === name);

export const colToIndex = (col: string) => col.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const indexToCol = (n: number) => { let s = ""; for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/** Encabezados de las dos columnas internas que la app agrega al final de cada hoja vinculada (id y versión de la fila). */
export const INTERNAL_HEADERS = { id: "__app_id", version: "__app_version" } as const;
