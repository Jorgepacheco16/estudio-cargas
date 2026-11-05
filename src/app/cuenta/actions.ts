"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { headers } from "next/headers";
import { authConfigured, createClient, getRealUser, getUser } from "@/lib/supabase/server";
import { validatePasswordChange } from "@/lib/password-change";
import { isBlocked, recordFailure } from "@/lib/ratelimit";
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

/**
 * Cambiar mi clave. Se pide la clave actual y se verifica contra Supabase Auth antes de cambiarla, para que una sesión abierta y olvidada no baste.
 * Solo cuenta la sesión REAL (nunca «ver como») y los intentos fallidos usan el mismo límite que el ingreso.
 */
const PW_MAX_FAILURES = 8, PW_WINDOW_MS = 60_000;
const back = (kind: "ok" | "error", msg: string): never => redirect(`/cuenta?${kind}=${encodeURIComponent(msg)}`);

export async function changePasswordAction(fd: FormData) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user!.viewAs) back("error", "En «Ver como» no se puede cambiar la clave.");
  const real = await getRealUser();
  if (!real?.email || !authConfigured()) back("error", "El cambio de clave no está disponible en este momento.");
  const [current, next, again] = ["actual", "nueva", "repetir"].map((k) => String(fd.get(k) ?? "").slice(0, 200));
  const invalid = validatePasswordChange(current, next, again);
  if (invalid) back("error", invalid);
  const key = `pwchange:${real!.id}:${(await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
  if (isBlocked(key, PW_MAX_FAILURES)) back("error", "Demasiados intentos. Espere un minuto.");
  const sb = await createClient();
  const check = await sb.auth.signInWithPassword({ email: real!.email!, password: current });
  if (check.error) { recordFailure(key, PW_WINDOW_MS); back("error", "La clave actual no es correcta."); }
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) back("error", /same|different/i.test(error.message) ? "La clave nueva debe ser distinta de la actual." : "No se pudo cambiar la clave. Pruebe con otra más larga o menos común.");
  back("ok", "Clave cambiada. Úsela la próxima vez que ingrese.");
}
