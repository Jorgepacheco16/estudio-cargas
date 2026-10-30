"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { canEdit } from "@/lib/access";
import { activeStudyId } from "@/data/source";
import { rateLimit } from "@/lib/ratelimit";
import { googleGateway } from "@/server/sheets/gateway";
import { NeedsConfirmation, connectSheet, listConnections, previewSync, syncNow } from "@/server/sheets/sync";
import { withRls } from "@/db/client";
import { syncEvents } from "@/db/schema";

const back = (kind: "ok" | "error", msg: string): never => redirect(`/integraciones?${kind}=${encodeURIComponent(msg)}`);
const isRedirect = (e: unknown) => (e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");

async function ctx() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) back("error", "Cree o seleccione un estudio primero");
  return { user: user!, study: study! };
}

/** Acepta la URL completa de la hoja o solo su identificador. */
const sheetId = (s: string) => s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1] ?? (/^[a-zA-Z0-9_-]{20,}$/.test(s.trim()) ? s.trim() : null);

export async function connectAction(fd: FormData) {
  const { user, study } = await ctx();
  if (!canEdit(study, "integraciones")) back("error", "Su rol no permite conectar ni sincronizar la hoja de Google.");
  const id = sheetId(String(fd.get("sheet") ?? ""));
  const mode = z.enum(["push", "pull", "bidirectional", "off"]).safeParse(fd.get("mode"));
  if (!id || !mode.success) back("error", "Indique la dirección de la hoja y el modo de sincronización.");
  try {
    await googleGateway(id!).title(); // comprueba que la cuenta de servicio tiene acceso
  } catch (e) {
    if (isRedirect(e)) throw e;
    back("error", "No se pudo abrir la hoja. Verifique que sea una hoja de Google (no un .xlsx) compartida como Editor con la cuenta de servicio.");
  }
  try { await connectSheet(getDb(), user.id, study.id, id!, mode.data!); }
  catch (e) { if (isRedirect(e)) throw e; back("error", "No se pudo guardar la conexión (¿esa hoja ya está conectada a otro estudio?)."); }
  back("ok", "Hoja conectada. Pulse «Sincronizar ahora» para vincular las filas.");
}

export async function syncAction(fd: FormData) {
  const confirm = fd.get("confirmAutofix") === "yes";
  const { user, study } = await ctx();
  if (!canEdit(study, "integraciones")) back("error", "Su rol no permite conectar ni sincronizar la hoja de Google.");
  if (!rateLimit(`sync:${user.id}`, 3, 60_000).ok) back("error", "Espere un momento antes de sincronizar de nuevo.");
  let msg = "";
  let connId: string | null = null;
  try {
    const conns = (await listConnections(getDb(), user.id, study.id)).filter((c) => c.mode !== "off");
    connId = conns[0]?.id ?? null;
    if (!conns.length) back("error", "No hay una hoja conectada.");
    let created = 0, updated = 0, linked = 0, conflict = 0, rejected = 0, appended = 0, refreshed = 0;
    for (const c of conns) {
      const r = await syncNow(getDb(), { id: c.id, studyId: c.studyId, actorId: c.actorId, spreadsheetId: c.spreadsheetId, mode: c.mode }, undefined, confirm);
      for (const s of r.pull) { created += s.counts.created; updated += s.counts.updated; linked += s.counts.linked; conflict += s.counts.conflict; rejected += s.counts.rejected; }
      for (const s of r.push) { appended += s.appended; refreshed += s.refreshed; }
    }
    msg = `Sincronizado. Hoja → app: ${created} nueva(s), ${updated} actualizada(s), ${linked} vinculada(s), ${conflict} en conflicto, ${rejected} rechazada(s). App → hoja: ${appended} agregada(s), ${refreshed} actualizada(s).`;
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (e instanceof NeedsConfirmation) back("error", `${e.message}. Marque «Confirmo aplicar las correcciones automáticas» y vuelva a sincronizar.`);
    // Deja el motivo en el historial de Integraciones (texto corto, sin datos del estudio) para poder diagnosticar el fallo.
    if (connId) await withRls(getDb(), { sub: user.id }, (tx) => tx.insert(syncEvents).values({ studyId: study.id, connectionId: connId!, direction: "app_to_sheet", originId: crypto.randomUUID(), sheetName: "*", payload: {}, status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300), processedAt: new Date() })).catch(() => undefined);
    back("error", "La sincronización falló. Intente de nuevo; si persiste, revise la conexión (el motivo quedó en el historial).");
  }
  back("ok", msg);
}

export async function previewAction() {
  const { user, study } = await ctx();
  if (!rateLimit(`preview:${user.id}`, 3, 60_000).ok) back("error", "Espere un momento antes de pedir otra vista previa.");
  let msg = "";
  try {
    const conns = (await listConnections(getDb(), user.id, study.id)).filter((c) => c.mode !== "off");
    if (!conns.length) back("error", "No hay una hoja conectada.");
    const tot = { created: 0, updated: 0, linked: 0, conflict: 0, rejected: 0, unchanged: 0, appended: 0, autofixes: 0 };
    for (const c of conns) {
      const r = await previewSync(getDb(), { id: c.id, studyId: c.studyId, actorId: c.actorId, spreadsheetId: c.spreadsheetId, mode: c.mode });
      for (const s of r.pull) { for (const k of ["created", "updated", "linked", "conflict", "rejected", "unchanged"] as const) tot[k] += s.counts[k]; tot.autofixes += s.autofixes; }
      for (const s of r.push) tot.appended += s.appended;
    }
    msg = `Vista previa (no se cambió nada)${tot.autofixes ? `, con ${tot.autofixes} corrección(es) automática(s) de listas` : ""}: hoja → app ${tot.created} nueva(s), ${tot.updated} con cambios, ${tot.linked} por vincular, ${tot.unchanged} sin cambios, ${tot.conflict} en conflicto, ${tot.rejected} rechazada(s); app → hoja ${tot.appended} por agregar.`;
  } catch (e) {
    if (isRedirect(e)) throw e;
    back("error", "No se pudo generar la vista previa. Revise la conexión con la hoja.");
  }
  back("ok", msg);
}