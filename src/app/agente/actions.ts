"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { decideProposal, runAgent } from "@/server/agent";
import { rateLimit } from "@/lib/ratelimit";

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
  if (study.role === "viewer") back("error", "Su rol es de solo lectura.");
  if (!rateLimit(`agent:${user.id}`, 3, 60_000).ok) back("error", "Espere un momento antes de volver a ejecutar el agente.");
  let msg = "";
  try {
    const r = await runAgent(getDb(), user.id, study.id);
    if (!r.ok) back("error", r.message);
    else msg = r.created === 0 ? "El agente no encontró base suficiente para proponer cambios." : `El agente dejó ${r.created} propuesta(s) pendiente(s) de su revisión${r.discarded ? ` (${r.discarded} descartada(s) por no cumplir el contrato)` : ""}.`;
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    back("error", "No se pudo ejecutar el agente.");
  }
  back("ok", msg);
}

export async function decideAction(fd: FormData) {
  const { user, study } = await ctx();
  const id = z.string().uuid().safeParse(fd.get("id"));
  const approve = fd.get("decision") === "approve";
  if (!id.success) back("error", "Propuesta inválida");
  if (study.role === "viewer") back("error", "Su rol es de solo lectura.");
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
