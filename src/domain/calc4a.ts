/**
 * Hoja 4a del Excel (cálculo de tiempos por actividad): columnas calculadas, sus encabezados exactos y la comparación con los valores
 * que la propia hoja de Google calculó. Funciones puras.
 */
import type { ActivityRow } from "./summary";

export interface CalcCol { key: keyof NonNullable<ActivityRow["result"]> | "occupants"; header: string; col: string; fmt: string }
/** Columnas calculadas de la hoja 4a que reproduce el motor (letra de columna y encabezado tal como están en el libro). */
export const CALC_4A: CalcCol[] = [
  { key: "execPerWeek", header: "Ejecuciones por semana", col: "AL", fmt: "#,##0.00" },
  { key: "hoursPerExec", header: "Horas-persona totales por ejecución", col: "AP", fmt: "#,##0.0000" },
  { key: "hsBase", header: "Horas/sem escenario base", col: "AQ", fmt: "#,##0.00" },
  { key: "hsHigh", header: "Horas/sem temporada alta", col: "AR", fmt: "#,##0.00" },
  { key: "hsLow", header: "Horas/sem temporada baja", col: "AS", fmt: "#,##0.00" },
  { key: "hsMin", header: "Horas/sem con tiempo mínimo", col: "AT", fmt: "#,##0.00" },
  { key: "hsMax", header: "Horas/sem con tiempo máximo", col: "AU", fmt: "#,##0.00" },
  { key: "hsSel", header: "Horas/sem del escenario seleccionado", col: "AV", fmt: "#,##0.00" },
  { key: "occupants", header: "Ocupantes del cargo (hoja 2)", col: "AW", fmt: "0" },
  { key: "mult", header: "Multiplicador por alcance", col: "AX", fmt: "#,##0.00" },
  { key: "hTotal", header: "Horas/sem TOTALES de la actividad en el centro de operaciones", col: "AY", fmt: "#,##0.00" },
  { key: "hPrimary", header: "Horas/sem al cargo responsable", col: "AZ", fmt: "#,##0.00" },
  { key: "hSecondary", header: "Horas/sem al cargo que asume el resto", col: "BA", fmt: "#,##0.00" },
  { key: "hUnplanned", header: "Horas/sem no planificadas", col: "BB", fmt: "#,##0.00" },
  { key: "hRework", header: "Horas/sem en reprocesos", col: "BE", fmt: "#,##0.00" },
  { key: "hWait", header: "Horas/sem de espera (tiempo transcurrido)", col: "BF", fmt: "#,##0.00" },
  { key: "hHighTotal", header: "Horas/sem totales temporada alta", col: "BG", fmt: "#,##0.00" },
  { key: "hLowTotal", header: "Horas/sem totales temporada baja", col: "BH", fmt: "#,##0.00" },
  { key: "hMonth", header: "Horas/mes equivalentes", col: "BI", fmt: "#,##0.00" },
];

/** Valor de una columna calculada para una actividad (null si la actividad está incompleta y la hoja deja la celda vacía). */
export function calcValue(a: ActivityRow, key: CalcCol["key"], occupants: number): number | null {
  if (key === "occupants") return occupants;
  const v = (a.result as unknown as Record<string, number | undefined>)[key as string];
  return typeof v === "number" ? v : null;
}

export interface Compare4a { compared: number; same: number; missingInSheet: string[]; diffs: { code: string; fields: string[] }[] }
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/**
 * Compara el motor con lo que calculó la hoja 4a de Google. `sheet` es el mapa código → { estado, valores por letra de columna }.
 * Una actividad incompleta debe quedar vacía en ambos lados; una completa, igual con tolerancia de 1e-9.
 */
export function compare4a(rows: ActivityRow[], occupantsOf: (a: ActivityRow) => number, sheet: Map<string, { status: string | null; v: Record<string, number | null> }>): Compare4a {
  const out: Compare4a = { compared: 0, same: 0, missingInSheet: [], diffs: [] };
  for (const a of rows) {
    const s = sheet.get(a.code.trim().toLowerCase());
    if (!s) { out.missingInSheet.push(a.code); continue; }
    out.compared++;
    const fields: string[] = [];
    if ((s.status ?? "") !== a.status) fields.push("Estado de captura");
    for (const c of CALC_4A) {
      const mine = calcValue(a, c.key, occupantsOf(a)), theirs = s.v[c.col] ?? null;
      if (mine === null && theirs === null) continue;
      if (mine === null || theirs === null || !close(mine, theirs)) fields.push(c.header);
    }
    if (fields.length) out.diffs.push({ code: a.code, fields }); else out.same++;
  }
  return out;
}
