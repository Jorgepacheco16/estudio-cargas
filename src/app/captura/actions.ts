"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { deleteRow, parseForm, saveRow, sheetById } from "@/server/capture";

const go = (hoja: string, kind: "ok" | "error", msg: string): never => redirect(`/captura?hoja=${encodeURIComponent(hoja)}&${kind}=${encodeURIComponent(msg)}`);

/** Mensaje seguro para la pantalla (sin detalles internos de la base). */
function safeMessage(e: unknown): string {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42501") return "No tiene permiso para modificar este estudio (rol de solo lectura).";
  if (code === "23505") return "Ya existe un registro con esa clave en el estudio.";
  if (code === "23514") return "Un valor está fuera del rango permitido (revise fechas y escalas).";
  if (code === "23503") return "La referencia indicada no existe en este estudio.";
  return "No se pudo guardar. Intente de nuevo.";
}

async function context(hoja: string) {
  const user = await getUser();
  if (!user) redirect("/login");
  const def = sheetById(hoja);
  if (!def) redirect("/captura");
  const study = await activeStudyId(user!.id);
  if (!study) go(hoja, "error", "Cree o seleccione un estudio primero");
  return { user: user!, def: def!, study: study! };
}

export async function saveCaptureAction(fd: FormData) {
  const hoja = String(fd.get("hoja") ?? "");
  const { user, def, study } = await context(hoja);
  const parsed = parseForm(def, Object.fromEntries(fd));
  if (parsed.errors.length) go(hoja, "error", parsed.errors[0]);
  const v = z.coerce.number().int().min(1).safeParse(fd.get("version") || undefined);
  let result: Awaited<ReturnType<typeof saveRow>>;
  try { result = await saveRow(getDb(), user.id, study.id, def, parsed.values, v.success ? v.data : null); }
  catch (e) { return go(hoja, "error", safeMessage(e)); }
  if (result === "conflict") go(hoja, "error", "Conflicto (409): otra persona modificó este registro. Recargue y vuelva a intentar.");
  if (result === "exists") go(hoja, "error", "Ya existe un registro con esa clave: ábralo desde la tabla con «Editar».");
  go(hoja, "ok", result === "created" ? "Registro creado." : "Registro actualizado; los resultados se recalcularon.");
}

export async function deleteCaptureAction(fd: FormData) {
  const hoja = String(fd.get("hoja") ?? "");
  const { user, def, study } = await context(hoja);
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) go(hoja, "error", "Registro inválido");
  let done = false;
  try { done = await deleteRow(getDb(), user.id, study.id, def, id.data!); } catch (e) { return go(hoja, "error", safeMessage(e)); }
  go(hoja, done ? "ok" : "error", done ? "Registro eliminado." : "No se pudo eliminar (permiso o ya no existe).");
}
