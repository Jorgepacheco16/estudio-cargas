import { FACTOR_COL, FACTOR_FIRST_ROW, FACTOR_LAST_ROW, factorFormula, sameFormula } from "../src/domain/calc4a";
import { CALC_SHEET, ensureCalcFormulas } from "../src/server/sheets/calcformulas";
import { FakeSheet } from "./fakesheet";
import { check, summary } from "./helpers";

/**
 * D-89 — la fórmula «Factor a semana» de la hoja 4a que la app mantiene en el libro. La equivalencia numérica con el motor se verifica con LibreOffice
 * (scripts/verify-book-person-days.ts); aquí se prueba la forma de la fórmula y que la app la escribe solo cuando hace falta.
 */
async function main() {
  await check("La fórmula de cada fila usa su propia fila, la jornada diaria de Parametros!C16 y vuelve a la tabla de períodos si falta algún dato", () => {
    const f = factorFormula(12);
    if (!f.startsWith("=IF(AI12<>\"OK\",\"\",") || !f.includes("L12=\"Día\"") || !f.includes("J12=\"Por colaborador\"") || !f.includes("Parametros!$C$16") || !f.includes("MIN(Parametros!$C$5,")) throw new Error(f);
    if (!f.endsWith("VLOOKUP(L12,TblPeriodo,2,FALSE())))")) throw new Error("debe terminar en la fórmula original del libro: " + f.slice(-60));
    if (f.includes("AI13") || f === factorFormula(13)) throw new Error("no debe mezclar filas");
  });

  await check("Al comparar con lo que devuelve Google se ignoran espacios, mayúsculas y comillas de los nombres de hoja", () => {
    const f = factorFormula(7);
    if (!sameFormula(f.replace(/'/g, "").toLowerCase().replace(/,/g, ", "), f)) throw new Error("debía ser equivalente");
    if (sameFormula(f.replace("MIN(", "MAX("), f) || sameFormula(undefined, f) || sameFormula("=VLOOKUP(L7,TblPeriodo,2,FALSE())", f)) throw new Error("no debía ser equivalente");
  });

  await check("La app escribe la fórmula en las 400 filas la primera vez, no vuelve a escribir si ya está y repara solo la fila alterada", async () => {
    const sheet = new FakeSheet({ [CALC_SHEET]: 63 }), writes = () => sheet.formulaWrites;
    for (let r = FACTOR_FIRST_ROW; r <= FACTOR_LAST_ROW; r++) sheet.set(CALC_SHEET, FACTOR_COL, r, `=IF(AI${r}<>"OK","",VLOOKUP(L${r},TblPeriodo,2,FALSE()))`); // fórmula original del libro
    const preview = await ensureCalcFormulas(sheet, true);
    if (preview !== 400 || writes() !== 0) throw new Error(`vista previa: ${preview}, escrituras ${writes()}`);
    if ((await ensureCalcFormulas(sheet)) !== 400 || writes() !== 1) throw new Error("primera vez");
    if (sheet.cell(CALC_SHEET, FACTOR_COL, 7) !== factorFormula(7) || sheet.cell(CALC_SHEET, FACTOR_COL, 406) !== factorFormula(406)) throw new Error("fórmula escrita");
    if ((await ensureCalcFormulas(sheet)) !== 0 || writes() !== 1) throw new Error("no debía volver a escribir");
    sheet.set(CALC_SHEET, FACTOR_COL, 100, "=1");
    if ((await ensureCalcFormulas(sheet)) !== 1 || sheet.cell(CALC_SHEET, FACTOR_COL, 100) !== factorFormula(100)) throw new Error("reparar una fila");
  });

  await check("Solo se toca la columna «Factor a semana»: el resto de la hoja 4a queda igual", async () => {
    const sheet = new FakeSheet({ [CALC_SHEET]: 63 });
    sheet.set(CALC_SHEET, "AL", 7, "=K7*AK7"); sheet.set(CALC_SHEET, "AJ", 7, "=IF(C7=\"\",\"\",1)");
    await ensureCalcFormulas(sheet);
    if (sheet.cell(CALC_SHEET, "AL", 7) !== "=K7*AK7" || sheet.cell(CALC_SHEET, "AJ", 7) !== "=IF(C7=\"\",\"\",1)") throw new Error("tocó otra columna");
  });
}
main().then(summary);
