"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { basePath, PARAMETROS_PATH } from "@/lib/entry-routes";
import { ENTRY_IDS, entryDef, type EntryId } from "@/server/entry/defs";
import { deleteEntry, saveEntry, scheduleMirror } from "@/server/entry/service";
import { setActivityShifts } from "@/server/shifts";
import { SHEETS, parseForm, saveRow } from "@/server/capture";
import { areas as areaTable } from "@/db/schema";
import { withRls } from "@/db/client";
import { and, eq } from "drizzle-orm";

export interface FormState { errors: string[]; values: Record<string, string>; notices?: string[] }

async function session() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  if (study!.role === "viewer") redirect("/estudio?error=" + encodeURIComponent("Su rol es de solo lectura: no puede modificar este estudio."));
  return { user: user!, study: study! };
}
const sheetId = (v: unknown): EntryId => {
  const s = String(v ?? "");
  if (!(ENTRY_IDS as string[]).includes(s)) redirect("/");
  return s as EntryId;
};

/** Guarda (crea o edita) un registro de una hoja de captura. Con errores devuelve el formulario con lo escrito; si guarda, vuelve a la lista. */
export async function saveEntryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, study } = await session();
  const id = sheetId(fd.get("hoja"));
  const def = entryDef(id)!;
  const raw: Record<string, string> = {};
  for (const f of def.fields) raw[f.col] = String(fd.get(`c_${f.col}`) ?? "");
  const recId = String(fd.get("recId") ?? "") || undefined;
  const version = Number(fd.get("version") ?? "") || undefined;
  let res;
  try { res = await saveEntry(getDb(), user.id, study.id, id, raw, { recId, version }); }
  catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    return { errors: [code === "42501" ? "No tiene permiso para modificar este estudio." : "No se pudo guardar. Intente de nuevo."], values: raw };
  }
  if (!res.ok) return { errors: res.errors, values: raw };
  // D-67: turnos en que se ejecuta la actividad (solo si el formulario trajo el selector). Un fallo aquí no deshace la actividad ya guardada.
  if (id === "3" && fd.get("shiftsTouched") === "1") {
    try {
      const r = await setActivityShifts(getDb(), user.id, study.id, res.recId, { all: fd.get("allShifts") === "on", ids: fd.getAll("shift").map(String) });
      if (!r.ok) res.notices.push("La actividad se guardó, pero no sus turnos: " + r.errors.join(" "));
      else res.notices.push(...r.notices);
    } catch { res.notices.push("La actividad se guardó, pero no se pudieron guardar sus turnos. Ábrala y vuelva a elegirlos."); }
  }
  if (res.result !== "unchanged") scheduleMirror(getDb(), user.id, study.id, id);
  const msg = res.result === "created" ? "Registro creado" : res.result === "updated" ? "Registro actualizado" : "Sin cambios";
  redirect(`${basePath(id)}?ok=${encodeURIComponent(msg + (res.notices.length ? ". " + res.notices.join("; ") : "") + ". Se envía a la hoja de Google.")}`);
}

export async function deleteEntryAction(fd: FormData) {
  const { user, study } = await session();
  const id = sheetId(fd.get("hoja"));
  const recId = String(fd.get("recId") ?? "");
  const r = await deleteEntry(getDb(), user.id, study.id, id, recId);
  if (!r.ok) redirect(`${basePath(id)}?error=${encodeURIComponent(r.error)}`);
  scheduleMirror(getDb(), user.id, study.id, id);
  redirect(`${basePath(id)}?ok=${encodeURIComponent("Registro eliminado. Se limpia también en la hoja de Google.")}`);
}

/** Parámetros del estudio (hoja «Parametros»). */
export async function saveParamsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, study } = await session();
  const def = SHEETS[0];
  const raw: Record<string, string> = {};
  for (const f of def.fields) raw[f.key] = String(fd.get(f.key) ?? "");
  const { values, errors } = parseForm(def, raw);
  if (errors.length) return { errors, values: raw };
  const seen = Number(fd.get("version") ?? "");
  const r = await saveRow(getDb(), user.id, study.id, def, values, Number.isFinite(seen) ? seen : null).catch(() => "error" as const);
  if (r === "conflict") return { errors: ["Conflicto (409): otra persona modificó los parámetros. Recargue y repita el cambio."], values: raw };
  if (r === "error" || r === "exists") return { errors: ["No se pudo guardar. Intente de nuevo."], values: raw };
  scheduleMirror(getDb(), user.id, study.id, "params");
  redirect(`${PARAMETROS_PATH}?ok=${encodeURIComponent("Parámetros guardados. Se envían a la hoja de Google.")}`);
}

/** Lista de áreas del estudio (se espeja a «Parametros»!E5). */
export async function addAreaAction(fd: FormData) {
  const { user, study } = await session();
  const name = String(fd.get("name") ?? "").trim();
  if (!name || name.length > 120) redirect(PARAMETROS_PATH + "?error=" + encodeURIComponent("Escriba el nombre del área (máximo 120 caracteres)."));
  try {
    await withRls(getDb(), { sub: user.id }, async (tx) => {
      const ex = await tx.select({ n: areaTable.name, o: areaTable.sortOrder }).from(areaTable).where(eq(areaTable.studyId, study.id));
      if (ex.some((x) => x.n.trim().toLowerCase() === name.toLowerCase())) throw new Error("Esa área ya existe.");
      if (ex.length >= 36) throw new Error("La hoja admite máximo 36 áreas.");
      await tx.insert(areaTable).values({ studyId: study.id, name, sortOrder: Math.max(0, ...ex.map((x) => x.o ?? 0)) + 1 });
    });
  } catch (e) { redirect(PARAMETROS_PATH + "?error=" + encodeURIComponent(e instanceof Error && e.message.length < 100 ? e.message : "No se pudo agregar el área.")); }
  scheduleMirror(getDb(), user.id, study.id, "params");
  redirect(PARAMETROS_PATH + "?ok=" + encodeURIComponent("Área agregada."));
}

export async function removeAreaAction(fd: FormData) {
  const { user, study } = await session();
  const name = String(fd.get("name") ?? "");
  try {
    await withRls(getDb(), { sub: user.id }, async (tx) => { await tx.delete(areaTable).where(and(eq(areaTable.studyId, study.id), eq(areaTable.name, name))); });
  } catch { redirect(PARAMETROS_PATH + "?error=" + encodeURIComponent("No se puede quitar el área: hay datos que la usan.")); }
  scheduleMirror(getDb(), user.id, study.id, "params");
  redirect(PARAMETROS_PATH + "?ok=" + encodeURIComponent("Área eliminada."));
}
