/** Orden guardado de las tareas del Reparto semanal (D-104). Una preferencia de esa vista: solo códigos de actividad en orden; no toca ninguna sección ni el estudio. Siempre con RLS. */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withRls, type Db, type Tx } from "../db/client";
import { scheduleOrders } from "../db/schema";
import { orderKey, type SavedOrder, type WeekKind } from "../domain/schedule";

/** Tope de órdenes guardados por estudio: evita que la tabla crezca sin control. */
export const MAX_ORDERS_PER_STUDY = 5000;

const code = z.string().trim().min(1).max(60).refine((s) => !/[\u0000-\u001f]/.test(s), "código inválido");
export const dayOrderInput = z.object({
  positionKey: z.string().min(1).max(400),
  week: z.enum(["common", "periodic"]),
  person: z.number().int().min(1).max(200),
  /** Día de la semana: 0 = lunes … 6 = domingo. */
  weekday: z.number().int().min(0).max(6),
  /** Códigos en el orden elegido; vacío = volver al orden sugerido (se borra lo guardado). */
  codes: z.array(code).max(100).refine((c) => new Set(c).size === c.length, "códigos repetidos"),
});
export type DayOrderInput = z.infer<typeof dayOrderInput>;

/** Todos los órdenes guardados del estudio, por orderKey. */
export async function listOrdersTx(tx: Tx, studyId: string): Promise<Map<string, SavedOrder>> {
  const rows = await tx.select().from(scheduleOrders).where(eq(scheduleOrders.studyId, studyId));
  return new Map(rows.map((r) => [orderKey(r.positionKey, r.weekKind as WeekKind, r.person, r.day), { codes: r.codes, at: r.updatedAt.toISOString() }]));
}

export type SaveOrderResult = { ok: true; removed: boolean } | { ok: false; error: string };

/** Guarda (o, con la lista vacía, quita) el orden de un día. La base exige «Resultados» en Edición y deja a la persona como autora. */
export async function saveDayOrder(db: Db, sub: string, studyId: string, raw: unknown): Promise<SaveOrderResult> {
  const p = dayOrderInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "El orden no es válido." };
  const v = p.data;
  try {
    return await withRls(db, { sub }, async (tx): Promise<SaveOrderResult> => {
      const where = and(eq(scheduleOrders.studyId, studyId), eq(scheduleOrders.positionKey, v.positionKey), eq(scheduleOrders.weekKind, v.week), eq(scheduleOrders.person, v.person), eq(scheduleOrders.day, v.weekday));
      if (v.codes.length === 0) { await tx.delete(scheduleOrders).where(where); return { ok: true, removed: true }; }
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(scheduleOrders).where(eq(scheduleOrders.studyId, studyId));
      const [mine] = await tx.select({ id: scheduleOrders.id }).from(scheduleOrders).where(where);
      if (n >= MAX_ORDERS_PER_STUDY && !mine) return { ok: false, error: "Se alcanzó el máximo de órdenes guardados del estudio." }; // cambiar uno que ya existe siempre se puede
      const now = new Date();
      await tx.insert(scheduleOrders).values({ studyId, positionKey: v.positionKey, weekKind: v.week, person: v.person, day: v.weekday, codes: v.codes, updatedBy: sub, updatedAt: now })
        .onConflictDoUpdate({ target: [scheduleOrders.studyId, scheduleOrders.positionKey, scheduleOrders.weekKind, scheduleOrders.person, scheduleOrders.day], set: { codes: v.codes, updatedBy: sub, updatedAt: now } });
      return { ok: true, removed: false };
    });
  } catch {
    return { ok: false, error: "No se pudo guardar el orden. Verifique que su rol tenga Edición en Resultados." };
  }
}
