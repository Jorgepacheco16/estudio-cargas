"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { canEdit } from "@/lib/access";
import { activeStudyId } from "@/data/source";
import { decideProposal, runAgent } from "@/server/agent";
import { rateLimit } from "@/lib/ratelimit";
import { validateCoverage, type CoverageOutcome } from "@/server/coverage";
import { coveragePayload, coveragePdf, coverageXlsx } from "@/lib/coverage-export";

const back = (kind: "ok" | "error", msg: string): never => redirect(`/agente?${kind}=${encodeURIComponent(msg)}`);

async function ctx() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) back("error", "Cree o seleccione un estudio primero");
  return { user: user!, study: study! };
}

export async function runAgentAction() {
  const { user, study } = await ctx();
  if (!canEdit(study, "agente")) back("error", "Su rol es de solo lectura.");
  if (!rateLimit(`agent:${user.id}`, 3, 60_000).ok) back("error", "Espere un momento antes de volver a ejecutar el agente.");
  let msg = "";
  try {
    const r = await runAgent(getDb(), user.id, study.id);
    if (!r.ok) back("error", r.message);
    else msg = r.created === 0 ? (r.discarded ? `El agente respondió, pero ${r.discarded} propuesta(s) se descartaron por no cumplir el contrato (o su respuesta llegó incompleta). Vuelva a intentarlo.` : "El agente no encontró base suficiente para proponer cambios.") : `El agente dejó ${r.created} propuesta(s) pendiente(s) de su revisión${r.discarded ? ` (${r.discarded} descartada(s) por no cumplir el contrato)` : ""}.`;
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    back("error", "No se pudo ejecutar el agente.");
  }
  back("ok", msg);
}

/** Validación de cobertura de funciones de UN cargo. La usan el botón del detalle del cargo y el bloque del Agente de IA: es la misma función. */
export async function validateCoverageAction(positionId: string): Promise<CoverageOutcome> {
  const user = await getUser();
  if (!user) return { ok: false, code: "forbidden", message: "Su sesión terminó. Vuelva a ingresar." };
  const study = await activeStudyId(user.id);
  if (!study) return { ok: false, code: "not_found", message: "Cree o seleccione un estudio primero." };
  if (!canEdit(study, "agente")) return { ok: false, code: "forbidden", message: "Su rol es de solo lectura: no puede ejecutar el agente." };
  if (!z.string().uuid().safeParse(positionId).success) return { ok: false, code: "not_found", message: "Cargo inválido." };
  try { return await validateCoverage(getDb(), user.id, study.id, positionId); }
  catch { return { ok: false, code: "error", message: "No se pudo validar la cobertura. Puede reintentar." }; }
}

/** Genera el Excel o el PDF del resultado que la persona tiene en pantalla. No guarda nada: el archivo se arma al momento y se entrega para descargar. */
export type CoverageFile = { ok: true; filename: string; mime: string; base64: string } | { ok: false; message: string };
export async function exportCoverageAction(format: "xlsx" | "pdf", payload: unknown): Promise<CoverageFile> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Su sesión terminó. Vuelva a ingresar." };
  const p = coveragePayload.safeParse(payload);
  if (!p.success || (format !== "xlsx" && format !== "pdf")) return { ok: false, message: "No se pudo preparar el archivo. Vuelva a validar la cobertura e intente de nuevo." };
  try {
    const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const base = `cobertura-de-funciones_${stamp}`;
    if (format === "xlsx") return { ok: true, filename: `${base}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: (await coverageXlsx(p.data.cargo, p.data.result, stamp)).toString("base64") };
    return { ok: true, filename: `${base}.pdf`, mime: "application/pdf", base64: Buffer.from(await coveragePdf(p.data.cargo, p.data.result, stamp)).toString("base64") };
  } catch { return { ok: false, message: "No se pudo generar el archivo. Intente de nuevo." }; }
}

export async function decideAction(fd: FormData) {
  const { user, study } = await ctx();
  const id = z.string().uuid().safeParse(fd.get("id"));
  const approve = fd.get("decision") === "approve";
  if (!id.success) back("error", "Propuesta inválida");
  if (!canEdit(study, "agente")) back("error", "Su rol es de solo lectura.");
  let msg = "";
  try {
    const r = await decideProposal(getDb(), user.id, study.id, id.data!, approve);
    msg = r === "not_pending" ? "La propuesta ya fue revisada." : r === "rejected" ? "Propuesta rechazada." : r === "applied" ? "Propuesta aprobada y aplicada; quedó en la auditoría." : "Propuesta aprobada. No tiene cambio automático que aplicar (se registra para su seguimiento).";
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    back("error", code === "23514" || code === "23505" ? "El cambio propuesto no es válido o ya existe; no se aplicó." : code === "42501" ? "No tiene permiso para decidir." : "No se pudo aplicar la propuesta.");
  }
  back("ok", msg);
}
