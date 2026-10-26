/**
 * Descripción de la operación de un cargo (D-69): texto libre e informativo sobre cómo se opera en la práctica (por ejemplo, cuántas cajas
 * se abren al inicio y al cierre y cómo se completa el resto según el pronóstico). No entra en ningún cálculo.
 */
import { and, eq } from "drizzle-orm";
import { withRls, type Db } from "../db/client";
import { auditLog, positions } from "../db/schema";
import { LONG_TEXT_MAX } from "../domain/limits";

export type OperationResult = { ok: true; changed: boolean } | { ok: false; error: string };
const clip = (s: string | null) => (s === null ? null : s.length > 200 ? `${s.slice(0, 200)}…` : s);

export async function getOperation(db: Db, sub: string, studyId: string, positionId: string): Promise<string> {
  return withRls(db, { sub }, async (tx) => {
    const [p] = await tx.select({ t: positions.operationDescription }).from(positions).where(and(eq(positions.id, positionId), eq(positions.studyId, studyId)));
    return p?.t ?? "";
  });
}

/** Guarda la descripción (vacía = sin descripción). Deja constancia en audit_log con origen «app». */
export async function saveOperation(db: Db, sub: string, studyId: string, positionId: string, raw: string): Promise<OperationResult> {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text.length > LONG_TEXT_MAX) return { ok: false, error: `La descripción admite máximo ${LONG_TEXT_MAX} caracteres (tiene ${text.length}).` };
  const next = text === "" ? null : text;
  return withRls(db, { sub }, async (tx) => {
    const [cur] = await tx.select({ t: positions.operationDescription }).from(positions).where(and(eq(positions.id, positionId), eq(positions.studyId, studyId)));
    if (!cur) return { ok: false as const, error: "El cargo ya no existe." };
    if ((cur.t ?? null) === next) return { ok: true as const, changed: false };
    await tx.update(positions).set({ operationDescription: next }).where(and(eq(positions.id, positionId), eq(positions.studyId, studyId)));
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "update", entity: "position_operation", entityId: positionId, diff: { operationDescription: { from: clip(cur.t ?? null), to: clip(next) } } });
    return { ok: true as const, changed: true };
  });
}
