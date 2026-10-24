"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { rateLimit } from "@/lib/ratelimit";
import { addMeasurement, deleteMeasurement, explainDeviation, runDetection, setDeviationStatus, takeSnapshot } from "@/server/history";

const back = (vista: string, kind: "ok" | "error", msg: string): never => redirect(`/historia?vista=${vista}&${kind}=${encodeURIComponent(msg)}`);
const isRedirect = (e: unknown) => (e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");

async function ctx(vista: string) {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) back(vista, "error", "Cree o seleccione un estudio primero");
  if (study!.role === "viewer") back(vista, "error", "Su rol es de solo lectura.");
  return { user: user!, study: study! };
}
const safe = (e: unknown) => {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "42501" ? "No tiene permiso para modificar este estudio." : code === "23514" ? "Un valor está fuera del rango permitido." : code === "23503" ? "La referencia indicada no existe en este estudio." : "No se pudo completar la operación.";
};

export async function snapshotAction(fd: FormData) {
  const { user, study } = await ctx("linea");
  if (!rateLimit(`snap:${user.id}`, 5, 60_000).ok) back("linea", "error", "Espere un momento antes de tomar otra foto.");
  const label = z.string().trim().max(120).parse(String(fd.get("label") ?? "")) || `Foto manual ${new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}`;
  try { await takeSnapshot(getDb(), user.id, study.id, label); } catch (e) { if (isRedirect(e)) throw e; back("linea", "error", safe(e)); }
  back("linea", "ok", "Foto del tablero guardada.");
}

const toNum = (v: unknown) => { const s = String(v ?? "").trim().replace(/,/g, "."); return s === "" ? null : Number(s); };
const optNum = (label: string, min: number, max: number) => z.preprocess(toNum, z.number({ error: `${label}: escriba un número` }).min(min, `${label}: mínimo ${min}`).max(max, `${label}: máximo ${max}`).nullable());
const reqNum = (label: string, min: number, max: number) => z.preprocess(toNum, z.number({ error: `${label}: escriba un número` }).min(min, `${label}: mínimo ${min}`).max(max, `${label}: máximo ${max}`));const measureSchema = z.object({
  activityId: z.string().uuid("Elija una actividad"), observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  unitsProcessed: optNum("Unidades", 0, 1e9), personHours: reqNum("Horas-persona", 0.0001, 1e5),
  method: z.enum(["declared_by_employee", "declared_by_manager", "observed", "timed", "verifiable_source", "validated_estimate"]),
  observer: z.string().trim().max(120).optional().transform((v) => v || null),
});

export async function addMeasurementAction(fd: FormData) {
  const { user, study } = await ctx("productividad");
  const p = measureSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) back("productividad", "error", p.error.issues[0]?.message ?? "Datos inválidos");
  try { await addMeasurement(getDb(), user.id, study.id, { ...p.data!, observedAt: new Date(`${p.data!.observedAt}T12:00:00-05:00`), personHours: p.data!.personHours, unitsProcessed: p.data!.unitsProcessed, observer: p.data!.observer ?? null }); }
  catch (e) { if (isRedirect(e)) throw e; back("productividad", "error", safe(e)); }
  back("productividad", "ok", "Medición guardada.");
}

export async function deleteMeasurementAction(fd: FormData) {
  const { user, study } = await ctx("productividad");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("productividad", "error", "Medición inválida");
  try { await deleteMeasurement(getDb(), user.id, study.id, id.data!); } catch (e) { if (isRedirect(e)) throw e; back("productividad", "error", safe(e)); }
  back("productividad", "ok", "Medición eliminada.");
}

export async function detectAction() {
  const { user, study } = await ctx("desviaciones");
  if (!rateLimit(`detect:${user.id}`, 5, 60_000).ok) back("desviaciones", "error", "Espere un momento antes de volver a detectar.");
  let msg = "";
  try { const r = await runDetection(getDb(), user.id, study.id); msg = `Detección terminada: ${r.created} nueva(s), ${r.suppressed} ya conocida(s) o descartada(s).`; }
  catch (e) { if (isRedirect(e)) throw e; back("desviaciones", "error", safe(e)); }
  back("desviaciones", "ok", msg);
}

export async function deviationStatusAction(fd: FormData) {
  const { user, study } = await ctx("desviaciones");
  const id = z.string().uuid().safeParse(fd.get("id")), st = z.enum(["open", "acknowledged", "dismissed"]).safeParse(fd.get("status"));
  if (!id.success || !st.success) back("desviaciones", "error", "Solicitud inválida");
  try { await setDeviationStatus(getDb(), user.id, study.id, id.data!, st.data!); } catch (e) { if (isRedirect(e)) throw e; back("desviaciones", "error", safe(e)); }
  back("desviaciones", "ok", "Estado actualizado.");
}

export async function explainAction(fd: FormData) {
  const { user, study } = await ctx("desviaciones");
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) back("desviaciones", "error", "Desviación inválida");
  if (!rateLimit(`explain:${user.id}`, 5, 60_000).ok) back("desviaciones", "error", "Espere un momento antes de pedir otra explicación.");
  let r: Awaited<ReturnType<typeof explainDeviation>>;
  try { r = await explainDeviation(getDb(), user.id, study.id, id.data!); } catch (e) { if (isRedirect(e)) throw e; back("desviaciones", "error", safe(e)); return; }
  back("desviaciones", r.ok ? "ok" : "error", r.ok ? "Explicación guardada (redactada por el agente, con identificadores de cambio citados)." : r.message);
}
