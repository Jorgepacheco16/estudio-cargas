/**
 * Fuente de datos de las vistas. Hoy: datos de demostración (ficticios, los mismos de la prueba dorada).
 * Cuando exista autenticación (F3), esta función pasa a leer PostgreSQL con withRls() sin cambiar las vistas.
 */
import demo from "./demo.json";
import { analyze, type Analysis, type Mode, type Thresholds } from "@/domain/summary";
import type { ActivityInput, Params, StaffingInput } from "@/domain/engine";

export const THRESHOLDS: Thresholds = { high: 1, low: 0.5 }; // hoja Parametros: C9 = 100 %, C10 = 50 %
export const SOURCE_LABEL = "Datos de demostración (ficticios)";

export function parseMode(v: string | string[] | undefined): Mode {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "real" || s === "all" ? s : "demo";
}

export function loadAnalysis(mode: Mode): { analysis: Analysis; params: Params } {
  const params = demo.params as Params;
  const analysis = analyze(demo.positions as StaffingInput[], demo.activities as ActivityInput[], params, THRESHOLDS, mode);
  return { analysis, params };
}
