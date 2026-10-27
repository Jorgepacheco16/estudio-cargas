"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { GUEST_COOKIE, checkDemoLogin, guestConfigured, signGuest } from "@/lib/guest";
import { isBlocked, recordFailure } from "@/lib/ratelimit";
import { authConfigured, createClient } from "@/lib/supabase/server";

/** Acciones de la página de ingreso (D-76): Google, usuario y clave, e invitado (usuario y clave de la demostración). Solo los intentos FALLIDOS gastan el límite (8 por minuto y origen). */
const MAX_FAILURES = 8, WINDOW_MS = 60_000;
const clientIp = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
const text = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").slice(0, max);

export async function signInWithGoogle() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  if (!authConfigured()) redirect("/ingreso?error=no-disponible");
  const { data, error } = await (await createClient()).auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) redirect("/ingreso?error=oauth");
  redirect(data.url);
}

/** Usuario (correo) y clave de una cuenta de la aplicación. El mensaje de error es el mismo para un correo que no existe y para una clave errónea. */
export async function signInWithPassword(fd: FormData) {
  const key = `pw:${await clientIp()}`;
  if (isBlocked(key, MAX_FAILURES)) redirect("/ingreso?error=espere");
  const [email, password] = [text(fd, "email").trim(), text(fd, "password")];
  if (!email || !password) redirect("/ingreso?error=credenciales");
  if (!authConfigured()) redirect("/ingreso?error=no-disponible");
  const { error } = await (await createClient()).auth.signInWithPassword({ email, password });
  if (error) { recordFailure(key, WINDOW_MS); redirect("/ingreso?error=credenciales"); }
  redirect("/estudio");
}

/** Invitado: pide el usuario y la clave de la demostración; si coinciden entrega una cookie firmada de 12 horas. */
export async function guestSignIn(fd: FormData) {
  const key = `guest:${await clientIp()}`;
  if (isBlocked(key, MAX_FAILURES)) redirect("/ingreso?modo=invitado&error=espere");
  if (!guestConfigured()) redirect("/ingreso?modo=invitado&error=no-disponible");
  if (!checkDemoLogin(text(fd, "user"), text(fd, "password"))) { recordFailure(key, WINDOW_MS); redirect("/ingreso?modo=invitado&error=credenciales"); }
  const g = signGuest();
  (await cookies()).set(GUEST_COOKIE, g.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: g.maxAge });
  redirect("/");
}

export async function guestSignOut() {
  (await cookies()).delete(GUEST_COOKIE);
  redirect("/ingreso");
}
