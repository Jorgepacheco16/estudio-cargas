"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { canEdit, canRead, requireRead, NO_EDIT } from "@/lib/access";
import { ENTRY_MODULE } from "@/domain/access";
import { activeStudyId } from "@/data/source";
import { rateLimit } from "@/lib/ratelimit";
import { basePath } from "@/lib/entry-routes";
import { BULK_MAX_BYTES, bulkEnabled, parseUpload, type ParsedUpload } from "@/server/entry/bulk-file";
import { runBulk, type BulkReport } from "@/server/entry/bulk";
import { entryDef } from "@/server/entry/defs";
import { scheduleMirror } from "@/server/entry/service";

export interface BulkState { stage: "idle" | "preview" | "error"; message?: string; report?: BulkReport; payload?: string }

const parsedSchema = z.object({
  rows: z.array(z.object({ rowNo: z.number().int(), cells: z.record(z.string(), z.string()), operation: z.string(), shiftsText: z.string(), error: z.string().optional() }).strict()).max(400),
  shifts: z.array(z.object({ rowNo: z.number().int(), kind: z.string(), area: z.string(), site: z.string(), position: z.string(), name: z.string(), start: z.string(), end: z.string(), breakMin: z.string(), days: z.string(), type: z.string().default("") }).strict()).max(300),
  fileErrors: z.array(z.string()).max(0),
}).strict();

/**
 * Carga masiva (D-72). «preview»: lee el archivo y lo REVISA sin guardar nada. «apply»: vuelve a validar el contenido revisado (nunca se confía en lo
 * que viaja desde el navegador) y lo guarda todo o nada. Tras guardar, programa el espejo hacia la hoja de Google (una sola vez por hoja).
 */
export async function bulkAction(_prev: BulkState, fd: FormData): Promise<BulkState> {
  const user = await getUser();
  if (!user) redirect("/login");
  const hoja = String(fd.get("hoja") ?? "");
  if (!bulkEnabled(hoja)) return { stage: "error", message: "Esta sección no tiene carga masiva." };
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  if (!canEdit(study, ENTRY_MODULE[hoja])) return { stage: "error", message: NO_EDIT(ENTRY_MODULE[hoja]) };
  if (!rateLimit(`bulk:${user!.id}`, 12, 60_000).ok) return { stage: "error", message: "Espere un momento antes de intentarlo de nuevo." };
  const def = entryDef(hoja)!;
  const intent = String(fd.get("intent") ?? "preview");

  let parsed: ParsedUpload;
  if (intent === "apply") {
    const payload = String(fd.get("payload") ?? "");
    let obj: unknown = null;
    try { obj = payload.length > 3_500_000 ? null : JSON.parse(payload); } catch { obj = null; }
    const ok = parsedSchema.safeParse(obj);
    if (!ok.success) return { stage: "error", message: "No se pudo recuperar la revisión del archivo. Suba el archivo y revíselo de nuevo." };
    parsed = ok.data;
  } else {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { stage: "error", message: "Elija el archivo de Excel (.xlsx) que descargó de la plantilla." };
    if (file.size > BULK_MAX_BYTES) return { stage: "error", message: "El archivo supera 1,5 MB." };
    parsed = await parseUpload(def, Buffer.from(await file.arrayBuffer()));
  }

  let report: BulkReport;
  try { report = await runBulk(getDb(), user!.id, study!.id, hoja, parsed, { apply: intent === "apply", allowUpdate: fd.get("allowUpdate") === "on" }); }
  catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    return { stage: "error", message: code === "42501" ? "No tiene permiso para modificar este estudio." : "No se pudo revisar la carga. Intente de nuevo; si persiste, revise el archivo." };
  }
  if (report.committed) {
    for (const h of report.mirror) scheduleMirror(getDb(), user!.id, study!.id, h);
    const c = report.counts, t = report.shiftCounts;
    const turnos = hoja === "2" && (t.create + t.update + t.unchanged) > 0 ? ` Turnos: ${t.create} nuevos, ${t.update} actualizados.` : "";
    redirect(`${basePath(hoja)}?ok=${encodeURIComponent(`Carga masiva aplicada: ${c.create} nuevos, ${c.update} actualizados, ${c.unchanged} sin cambios.${turnos} Se envía a la hoja de Google.`)}`);
  }
  return { stage: "preview", report, payload: report.fileErrors.length ? undefined : JSON.stringify(parsed) };
}
