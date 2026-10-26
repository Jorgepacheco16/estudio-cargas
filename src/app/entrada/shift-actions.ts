"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { basePath } from "@/lib/entry-routes";
import { saveOperation } from "@/server/operation";
import { deleteShift, saveShift } from "@/server/shifts";

/** Turnos de un cargo (D-67): agregar, editar y eliminar desde el editor del cargo. Vuelven a esa misma pantalla con el resultado. */
async function session() {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  if (study!.role === "viewer") redirect("/estudio?error=" + encodeURIComponent("Su rol es de solo lectura: no puede modificar este estudio."));
  return { user: user!, study: study! };
}
const UUID = /^[0-9a-f-]{36}$/i;
const back = (fd: FormData) => {
  const entry = String(fd.get("entryId") ?? "");
  if (!UUID.test(entry)) redirect("/cargos");
  return `${basePath("2")}/${entry}`;
};
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function saveShiftAction(fd: FormData) {
  const { user, study } = await session();
  const to = back(fd);
  const positionId = str(fd, "positionId"), shiftId = str(fd, "shiftId") || undefined;
  if (!UUID.test(positionId) || (shiftId && !UUID.test(shiftId))) redirect("/cargos");
  let res;
  try { res = await saveShift(getDb(), user.id, study.id, positionId, shiftId, { name: str(fd, "name"), start: str(fd, "start"), end: str(fd, "end"), breakMin: str(fd, "breakMin"), days: fd.getAll("days").map(String) }); }
  catch { redirect(`${to}?error=${encodeURIComponent("No se pudo guardar el turno. Intente de nuevo.")}&from=turnos#turnos`); }
  if (!res.ok) redirect(`${to}?error=${encodeURIComponent(res.errors.join(" "))}&from=turnos#turnos`);
  redirect(`${to}?ok=${encodeURIComponent(res.notices.join(" ") || "Turno guardado.")}&from=turnos#turnos`);
}

/** Descripción de la operación del cargo (D-69). */
export async function saveOperationAction(fd: FormData) {
  const { user, study } = await session();
  const to = back(fd);
  const positionId = str(fd, "positionId");
  if (!UUID.test(positionId)) redirect("/cargos");
  let r;
  try { r = await saveOperation(getDb(), user.id, study.id, positionId, str(fd, "operation")); }
  catch { redirect(`${to}?error=${encodeURIComponent("No se pudo guardar la descripción. Intente de nuevo.")}&from=operacion#operacion`); }
  if (!r.ok) redirect(`${to}?error=${encodeURIComponent(r.error)}&from=operacion#operacion`);
  redirect(`${to}?ok=${encodeURIComponent(r.changed ? "Descripción de la operación guardada." : "Sin cambios.")}&from=operacion#operacion`);
}

export async function deleteShiftAction(fd: FormData) {
  const { user, study } = await session();
  const to = back(fd);
  const shiftId = str(fd, "shiftId");
  if (!UUID.test(shiftId)) redirect("/cargos");
  let r;
  try { r = await deleteShift(getDb(), user.id, study.id, shiftId, fd.get("confirm") === "on"); }
  catch { redirect(`${to}?error=${encodeURIComponent("No se pudo eliminar el turno. Intente de nuevo.")}&from=turnos#turnos`); }
  if ("needsConfirm" in r) redirect(`${to}?error=${encodeURIComponent(`El turno lo usan ${r.needsConfirm} actividad(es). Marque «Confirmo» para quitarlo también de ellas y vuelva a eliminar.`)}&from=turnos#turnos`);
  if (!r.ok) redirect(`${to}?error=${encodeURIComponent(r.error)}&from=turnos#turnos`);
  redirect(`${to}?ok=${encodeURIComponent(r.removedFrom ? `Turno eliminado y quitado de ${r.removedFrom} actividad(es).` : "Turno eliminado.")}&from=turnos#turnos`);
}
