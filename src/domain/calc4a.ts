/**
 * Hoja 4a del Excel (cálculo de tiempos por actividad): columnas calculadas, sus encabezados exactos y la comparación con los valores
 * que la propia hoja de Google calculó. Funciones puras.
 */
import type { ActivityRow } from "./summary";

/**
 * Columna «Factor a semana» (AK) de la hoja 4a del libro y su fórmula (D-89). El libro original busca el período en la tabla de conversión (Día = días laborales
 * por semana). La aplicación, desde D-88, cuenta las actividades «por día» de cada colaborador en los días que trabaja la persona (horas semanales del cargo ÷
 * jornada laboral diaria, promedio ponderado por ocupantes, sin pasar de los días laborales). Esta fórmula hace lo mismo en el libro; si la jornada diaria
 * (Parametros!C16) está vacía o el cargo no tiene horas y ocupantes, da lo mismo que la fórmula original. La app la mantiene en las filas 7 a 406.
 */
export const FACTOR_COL = "AK", FACTOR_FIRST_ROW = 7, FACTOR_LAST_ROW = 406, DAILY_HOURS_CELL = "C16";
export function factorFormula(r: number): string {
  const h = (c: string) => `'2_Caracterizacion'!$${c}$7:$${c}$206`;
  const cond = `(${h("A")}=B${r})*(${h("B")}=D${r})*(${h("C")}=E${r})*(${h("E")}=F${r})*ISNUMBER(${h("K")})*(${h("K")}>0)`;
  const heads = `SUMPRODUCT(${cond},${h("F")})`, hours = `SUMPRODUCT(${cond},${h("F")},${h("K")})`;
  const daily = `Parametros!$${DAILY_HOURS_CELL[0]}$${DAILY_HOURS_CELL.slice(1)}`;
  return `=IF(AI${r}<>"OK","",IF(AND(L${r}="Día",J${r}="Por colaborador",ISNUMBER(${daily}),N(${daily})>0,${heads}>0),MIN(Parametros!$C$5,${hours}/${heads}/${daily}),VLOOKUP(L${r},TblPeriodo,2,FALSE())))`;
}
/** Para comparar la fórmula escrita con la que devuelve Google (que puede cambiar espacios, mayúsculas o comillas de los nombres de hoja). */
const canon = (f: string) => f.replace(/[\s']/g, "").replace(/;/g, ",").toUpperCase();
export const sameFormula = (a: unknown, b: string) => typeof a === "string" && canon(a) === canon(b);
/**
 * Las hojas de Google escriben y leen las fórmulas con el separador de argumentos de su idioma: «;» si el idioma usa coma decimal (es_ES, es_CO, de_DE…) y «,»
 * en los demás. Esta función pasa una fórmula escrita con comas al separador de la hoja (las comas dentro de textos entre comillas no se tocan).
 */
export function localizeFormula(f: string, sep: "," | ";"): string {
  if (sep === ",") return f;
  let inText = false, out = "";
  for (const ch of f) { if (ch === '"') inText = !inText; out += ch === "," && !inText ? ";" : ch; }
  return out;
}

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
