"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { authConfigured, createClient, getRealUser } from "@/lib/supabase/server";
import { isBlocked, recordFailure } from "@/lib/ratelimit";
import { NEXT_COOKIE } from "@/lib/invitation";
import { lookupInvitation, redeemInvitation, setMyDisplayName } from "@/server/access";

/**
 * Aceptar una invitación (D-91): la persona abre su enlace, crea su clave (o entra con Google o con su cuenta de siempre) y la base de datos comprueba que el correo de su
 * sesión es el invitado y que el enlace sirve y no venció. No se usa la llave de servicio de Supabase.
 */
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const MAX_FAILURES = 10, WINDOW_MS = 60_000;
const ip = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").slice(0, max);
const here = (token: string, kind?: "error" | "ok", msg?: string) => `/invitacion/${token}${kind ? `?${kind}=${encodeURIComponent(msg ?? "")}` : ""}`;

async function validInvitation(token: string) {
  if (!TOKEN.test(token)) redirect("/ingreso");
  const inv = await lookupInvitation(getDb(), token);
  if (!inv || !inv.valid) redirect(here(token));
  return inv!;
}

/** Con la sesión ya abierta, acepta la invitación y lleva a la aplicación. */
async function redeemNow(token: string, name = ""): Promise<never> {
  const user = await getRealUser();
  if (!user || !user.email) redirect(here(token, "error", "No se pudo abrir su sesión. Intente de nuevo."));
  const r = await redeemInvitation(getDb(), user!.id, user!.email!, token);
  if (!r.ok) redirect(here(token, "error", r.error));
  if (name.trim()) await setMyDisplayName(getDb(), user!.id, r.studyId, name.trim()).catch(() => undefined); // el nombre es opcional: un fallo aquí no impide entrar
  (await cookies()).set("estudio_id", r.studyId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  redirect("/?ok=" + encodeURIComponent("Bienvenido: su acceso ya está activo."));
}

/** La persona crea su clave con el correo de la invitación. */
export async function createAccountAction(fd: FormData) {
  const token = str(fd, "token", 100);
  const inv = await validInvitation(token);
  const [password, again] = [str(fd, "password", 72), str(fd, "again", 72)];
  if (password.length < 10) redirect(here(token, "error", "La clave debe tener al menos 10 caracteres."));
  if (password !== again) redirect(here(token, "error", "Las dos claves no coinciden."));
  if (!authConfigured()) redirect(here(token, "error", "El ingreso no está disponible en este momento."));
  const key = `inv:${await ip()}`;
  if (isBlocked(key, MAX_FAILURES)) redirect(here(token, "error", "Demasiados intentos. Espere un minuto."));
  const sb = await createClient();
  const { data, error } = await sb.auth.signUp({ email: inv.email, password });
  if (error) {
    recordFailure(key, WINDOW_MS);
    redirect(here(token, "error", /already|registered|exists/i.test(error.message) ? "Ese correo ya tiene una cuenta: use «Ya tengo cuenta» para entrar con su clave." : "No se pudo crear la cuenta. Verifique la clave e intente de nuevo."));
  }
  // Correo ya registrado: Supabase no avisa con un error sino con una cuenta sin identidades.
  if (data.user && (data.user.identities?.length ?? 0) === 0) redirect(here(token, "error", "Ese correo ya tiene una cuenta: use «Ya tengo cuenta» para entrar con su clave."));
  if (!data.session) redirect(here(token, "ok", "Le enviamos un correo para confirmar su cuenta. Confírmela y vuelva a abrir este enlace."));
  await redeemNow(token, str(fd, "nombre", 80));
}

/** Quien ya tiene cuenta (con clave) entra y acepta. */
export async function signInExistingAction(fd: FormData) {
  const token = str(fd, "token", 100);
  const inv = await validInvitation(token);
  const key = `inv:${await ip()}`;
  if (isBlocked(key, MAX_FAILURES)) redirect(here(token, "error", "Demasiados intentos. Espere un minuto."));
  const { error } = await (await createClient()).auth.signInWithPassword({ email: inv.email, password: str(fd, "password", 72) });
  if (error) { recordFailure(key, WINDOW_MS); redirect(here(token, "error", "Correo o clave incorrectos.")); }
  await redeemNow(token);
}

/** Entrar con Google: al volver, la página del enlace acepta la invitación si el correo de Google es el invitado. */
export async function googleInviteAction(fd: FormData) {
  const token = str(fd, "token", 100);
  await validInvitation(token);
  if (!authConfigured()) redirect(here(token, "error", "El ingreso no está disponible en este momento."));
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  (await cookies()).set(NEXT_COOKIE, `/invitacion/${token}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  const { data, error } = await (await createClient()).auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) redirect(here(token, "error", "No se pudo iniciar con Google."));
  redirect(data.url);
}

/** Con la sesión ya abierta (por ejemplo, volviendo de Google), acepta la invitación. */
export async function acceptAction(fd: FormData) {
  const token = str(fd, "token", 100);
  await validInvitation(token);
  await redeemNow(token);
}

/** Cierra la sesión actual para entrar con el correo invitado. */
export async function switchAccountAction(fd: FormData) {
  const token = str(fd, "token", 100);
  await (await createClient()).auth.signOut();
  redirect(here(TOKEN.test(token) ? token : ""));
}
