"use server";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { canEdit } from "@/lib/access";
import { rateLimit } from "@/lib/ratelimit";
import { saveDayOrder, type DayOrderInput, type SaveOrderResult } from "@/server/schedule-order";

/** Guarda el orden de las tareas de una persona en un día del Reparto semanal (D-104). Solo con «Resultados» en Edición; la base lo vuelve a exigir. */
export async function saveDayOrderAction(input: DayOrderInput): Promise<SaveOrderResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Inicie sesión para guardar el orden." };
  const study = await activeStudyId(user.id);
  if (!study) return { ok: false, error: "Elija un estudio primero." };
  if (!canEdit(study, "resultados")) return { ok: false, error: "Su rol no permite guardar el orden: necesita Edición en Resultados." };
  if (!rateLimit(`order:${user.id}`, 60, 60_000).ok) return { ok: false, error: "Demasiados cambios seguidos. Espere un momento." };
  return saveDayOrder(getDb(), user.id, study.id, input);
}
