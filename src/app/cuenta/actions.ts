"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { setMyDisplayName } from "@/server/access";

/** Cada persona cambia SU nombre (D-93). */
export async function saveNameAction(fd: FormData) {
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user!.id);
  if (!study) redirect("/estudio");
  const r = await setMyDisplayName(getDb(), user!.id, study!.id, String(fd.get("nombre") ?? "").slice(0, 200));
  revalidatePath("/", "layout"); // el encabezado (nombre) está en el diseño general: debe volver a dibujarse
  redirect(`/cuenta?${r.ok ? "ok" : "error"}=${encodeURIComponent(r.ok ? "Nombre guardado." : r.error)}`);
}
