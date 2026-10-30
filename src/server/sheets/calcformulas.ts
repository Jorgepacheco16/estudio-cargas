/**
 * Mantiene en el libro de Google la fórmula de «Factor a semana» (columna AK de la hoja 4a, filas 7 a 406) para que el libro calcule igual que la aplicación
 * (D-88, D-89). Es la única fórmula que la app escribe: es constante (sin texto de personas), se compara antes de escribir y no toca nada más. En vista previa
 * (dryRun) solo cuenta lo que cambiaría.
 */
import { FACTOR_COL, FACTOR_FIRST_ROW, FACTOR_LAST_ROW, factorFormula, sameFormula } from "../../domain/calc4a";
import type { SheetGateway } from "./gateway";
import { q } from "./internal";

export const CALC_SHEET = "4a_Calculo_tiempos";

/** Devuelve cuántas filas cambió (o cambiaría). Una fila cuya fórmula ya coincide no se vuelve a escribir. */
export async function ensureCalcFormulas(gw: SheetGateway, dryRun = false): Promise<number> {
  const range = `${q(CALC_SHEET)}!${FACTOR_COL}${FACTOR_FIRST_ROW}:${FACTOR_COL}${FACTOR_LAST_ROW}`;
  const errors = async () => (await gw.read(range)).flat().filter((v) => typeof v === "string" && v.startsWith("#")).length;
  const now = await gw.readFormulas(range);
  const want: string[][] = [];
  let changed = 0;
  for (let r = FACTOR_FIRST_ROW; r <= FACTOR_LAST_ROW; r++) {
    const f = factorFormula(r), cur = (now[r - FACTOR_FIRST_ROW] ?? [])[0];
    if (!sameFormula(cur, f)) changed++;
    want.push([f]);
  }
  if (changed && !dryRun) {
    // Red de seguridad: si Google no entiende la fórmula (aparecen errores nuevos), se devuelve la que había y se avisa; el libro nunca queda roto.
    const before = await errors();
    await gw.writeFormulas([{ range, values: want }]);
    if ((await errors()) > before) {
      await gw.writeFormulas([{ range, values: Array.from({ length: FACTOR_LAST_ROW - FACTOR_FIRST_ROW + 1 }, (_, i) => [String((now[i] ?? [])[0] ?? "")]) }], true);
      throw new Error("Google no aceptó la fórmula nueva; se dejó la que había.");
    }
  }
  return changed;
}
