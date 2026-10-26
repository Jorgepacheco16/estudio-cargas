"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { basePath } from "@/lib/entry-routes";
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
  try { res = await saveShift(getDb(), user.id, study.id, positionId, shiftId, { name: str(fd, "name"), start: str(fd, "start"), end: str(fd, "end"), breakMin: str(fd, "breakMin") }); }
  catch { redirect(`${to}?error=${encodeURIComponent("No se pudo guardar el turno. Intente de nuevo.")}#turnos`); }
  if (!res.ok) redirect(`${to}?error=${encodeURIComponent(res.errors.join(" "))}#turnos`);
  redirect(`${to}?ok=${encodeURIComponent(res.notices.join(" ") || "Turno guardado.")}#turnos`);
}

export async function deleteShiftAction(fd: FormData) {
  const { user, study } = await session();
  const to = back(fd);
  const shiftId = str(fd, "shiftId");
  if (!UUID.test(shiftId)) redirect("/cargos");
  let r;
  try { r = await deleteShift(getDb(), user.id, study.id, shiftId, fd.get("confirm") === "on"); }
  catch { redirect(`${to}?error=${encodeURIComponent("No se pudo eliminar el turno. Intente de nuevo.")}#turnos`); }
  if ("needsConfirm" in r) redirect(`${to}?error=${encodeURIComponent(`El turno lo usan ${r.needsConfirm} actividad(es). Marque «Confirmo» para quitarlo también de ellas y vuelva a eliminar.`)}#turnos`);
  if (!r.ok) redirect(`${to}?error=${encodeURIComponent(r.error)}#turnos`);
  redirect(`${to}?ok=${encodeURIComponent(r.removedFrom ? `Turno eliminado y quitado de ${r.removedFrom} actividad(es).` : "Turno eliminado.")}#turnos`);
}
