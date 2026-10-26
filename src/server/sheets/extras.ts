/**
 * Columnas informativas que la app agrega al FINAL de las hojas 2 y 3 de Google (D-67, D-69), sin mover ninguna columna del libro:
 *  · hoja 2 (Caracterización): «Turnos del cargo» y «Descripción de la operación» (una por cargo; se repite en cada fila de dotación del mismo cargo);
 *  · hoja 3 (Actividades): «Turnos en que se ejecuta».
 * Solo van de la app a la hoja (la app es la fuente, D-63): lo que se escriba a mano ahí se vuelve a sobrescribir. Se ubican por su encabezado; si no
 * existen se agregan. Las filas se reconocen por el vínculo oculto de la app (__app_id), así que esto corre DESPUÉS del espejo de la hoja.
 */
import { eq } from "drizzle-orm";
import { withRls, type Db } from "../../db/client";
import { positions } from "../../db/schema";
import { INTERNAL_HEADERS, indexToCol, colToIndex } from "../../domain/sheetmap";
import { shiftLinesByPositionId, shiftTextByActivityId } from "../shifts";
import type { Adapter } from "./adapters";
import type { CellValue, SheetGateway } from "./gateway";
import { q, type Conn } from "./internal";

export const EXTRA_HEADERS = { shifts: "Turnos del cargo", operation: "Descripción de la operación", activityShifts: "Turnos en que se ejecuta" } as const;

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const flat = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const same = (cur: unknown, want: string) => (blank(cur) || blank(want) ? blank(cur) && blank(want) : flat(cur) === flat(want));

interface ExtraCol { header: string; value: (rec: Record<string, unknown>) => string }

export const hasExtras = (a: Adapter) => a.sheet.target === "2" || a.sheet.target === "activities";

/**
 * Escribe (o refresca) las columnas informativas de una hoja. Devuelve cuántas celdas escribió. En vista previa (dryRun) no escribe nada.
 */
export async function mirrorExtras(db: Db, conn: Conn, gw: SheetGateway, a: Adapter, dryRun = false): Promise<number> {
  if (!hasExtras(a)) return 0;
  const s = a.sheet, name = s.sheetName;
  const data = await withRls(db, { sub: conn.actorId }, async (tx) => ({
    entries: await a.all(tx, conn.studyId),
    shiftLines: a.sheet.target === "2" ? await shiftLinesByPositionId(tx, conn.studyId) : new Map<string, string>(),
    operation: a.sheet.target === "2" ? new Map((await tx.select({ id: positions.id, t: positions.operationDescription }).from(positions).where(eq(positions.studyId, conn.studyId))).map((p) => [p.id, p.t ?? ""])) : new Map<string, string>(),
    activityShifts: a.sheet.target === "activities" ? await shiftTextByActivityId(tx, conn.studyId) : new Map<string, string>(),
  }));
  const defs: ExtraCol[] = a.sheet.target === "2"
    ? [
      { header: EXTRA_HEADERS.shifts, value: (rec) => data.shiftLines.get(String(rec.positionId)) ?? "" },
      { header: EXTRA_HEADERS.operation, value: (rec) => data.operation.get(String(rec.positionId)) ?? "" },
    ]
    : [{ header: EXTRA_HEADERS.activityShifts, value: (rec) => data.activityShifts.get(String(rec.id)) ?? "" }];

  // Una sola lectura (encabezado y filas) para no gastar la cuota de la API de Google (60 lecturas por minuto): de ahí salen las columnas por encabezado,
  // el vínculo de cada fila, las casillas de entrada y lo que ya hay en las columnas nuevas. Las columnas que falten se agregan al final (visibles) y se rotulan.
  const first = s.firstDataRow, last = s.lastDataRow;
  const n = await gw.columnCount(name);
  const grid = await gw.read(`${q(name)}!A${s.headerRow}:${indexToCol(n)}${last}`);
  const header = (grid[0] ?? []) as unknown[];
  const rowAt = (row: number) => (grid[row - s.headerRow] ?? []) as unknown[];
  const colOf = new Map<string, string>();
  const missing: ExtraCol[] = [];
  for (const d of defs) { const i = header.findIndex((h) => flat(h) === d.header); if (i >= 0) colOf.set(d.header, indexToCol(i + 1)); else missing.push(d); }
  if (missing.length) {
    if (dryRun) return 0;
    await gw.appendColumns(name, missing.length);
    const labels: { range: string; values: CellValue[][] }[] = [];
    missing.forEach((d, i) => { const col = indexToCol(n + 1 + i); colOf.set(d.header, col); labels.push({ range: `${q(name)}!${col}${s.headerRow}`, values: [[d.header]] }); });
    await gw.write(labels);
  }
  const idIdx = header.findIndex((h) => flat(h) === INTERNAL_HEADERS.id);
  if (idIdx < 0) return 0; // la hoja aún no tiene vínculo con la app (primera sincronización pendiente)
  const kindCol = a.spec.kind?.[0];
  const dataIdx = Object.values(a.spec).map(([col]) => col).filter((c) => c !== kindCol).map((c) => colToIndex(c) - 1);
  const cellOf = (row: number, col: string) => rowAt(row)[colToIndex(col) - 1];
  const byId = new Map(data.entries.map((e) => [e.rec.id, e.rec as Record<string, unknown>]));

  const updates: { range: string; values: CellValue[][] }[] = [];
  for (let row = first; row <= last; row++) {
    const id = flat(rowAt(row)[idIdx]);
    const hasData = dataIdx.some((i) => !blank(rowAt(row)[i]));
    const rec = id ? byId.get(id) : undefined;
    // Fila de otra persona (con datos pero sin vínculo): no se toca. Fila vacía o vinculada a un registro que ya no existe: se limpia.
    if (!id && hasData) continue;
    for (const d of defs) {
      const want = rec ? d.value(rec) : "";
      const now = cellOf(row, colOf.get(d.header)!);
      if (!same(now, want)) updates.push({ range: `${q(name)}!${colOf.get(d.header)}${row}`, values: [[want]] });
    }
  }
  if (!dryRun) for (let i = 0; i < updates.length; i += 400) await gw.write(updates.slice(i, i + 400));
  return dryRun ? 0 : updates.length;
}
