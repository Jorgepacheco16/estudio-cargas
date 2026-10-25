/** Lectura de la hoja 4a de Google Sheets (solo lectura) para compararla con el motor de la aplicaci?n. */
import { CALC_4A } from "../../domain/calc4a";
import { colToIndex } from "../../domain/sheetmap";
import type { SheetGateway } from "./gateway";

export async function read4a(gw: SheetGateway): Promise<Map<string, { status: string | null; v: Record<string, number | null> }>> {
  const first = colToIndex("C"), last = colToIndex("BJ");
  const rows = await gw.read(`'4a_Calculo_tiempos'!C7:BJ406`);
  const out = new Map<string, { status: string | null; v: Record<string, number | null> }>();
  for (const r of rows) {
    const code = String(r[colToIndex("C") - first] ?? "").trim();
    if (!code) continue;
    const status = r[colToIndex("AI") - first];
    const v: Record<string, number | null> = {};
    for (const c of CALC_4A) { const x = r[colToIndex(c.col) - first]; v[c.col] = typeof x === "number" ? x : null; }
    out.set(code.toLowerCase(), { status: status === undefined || status === "" ? null : String(status), v });
  }
  void last;
  return out;
}
