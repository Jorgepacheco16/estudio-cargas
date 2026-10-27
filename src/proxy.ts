import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { GUEST_COOKIE, verifyGuest } from "@/lib/guest";

/**
 * 1) Política de seguridad de contenido (CSP) con un código aleatorio (nonce) por petición: los scripts solo se ejecutan si traen ese código,
 *    sin 'unsafe-inline'. Next.js lee el nonce de la cabecera de la petición y lo pone en sus propios scripts.
 * 2) Renueva la sesión de Supabase en cada petición.
 * 3) Puerta de entrada (D-76): sin sesión de usuario ni cookie de invitado, ninguna pantalla interna se puede ver; se lleva a /ingreso (o 401 en la API).
 *    Siguen públicas la página de ingreso, el regreso de Google y las rutas que se autentican solas (webhook firmado y tareas programadas con CRON_SECRET).
 */
const PUBLIC_PATHS = ["/ingreso", "/login", "/auth/callback", "/api/sheets/webhook", "/api/sheets/reconcile", "/api/history/snapshot"];
const isPublic = (p: string) => PUBLIC_PATHS.some((x) => p === x || p.startsWith(`${x}/`));
function csp(nonce: string): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'", // los atributos style="…" de React no admiten nonce; los elementos <style> sí lo exigen
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`.trim(),
    `form-action 'self' ${supabase} https://accounts.google.com`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  headers.set("x-pathname", request.nextUrl.pathname); // el diseño general lo usa para mostrar la página de ingreso sin encabezado ni menú
  const guest = verifyGuest(request.cookies.get(GUEST_COOKIE)?.value);
  const gate = (authed: boolean): NextResponse | null => {
    const path = request.nextUrl.pathname;
    if (authed || guest || isPublic(path)) return null;
    if (path.startsWith("/api/")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Inicie sesión para continuar." } }, { status: 401 });
    return NextResponse.redirect(new URL("/ingreso", request.url));
  };
  const finish = (r: NextResponse) => { r.headers.set("content-security-policy", policy); return r; };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { const g = gate(false); return finish(g ?? NextResponse.next({ request: { headers } })); }
  let response = NextResponse.next({ request: { headers } });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers } });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const blocked = gate(!!data.user);
  return finish(blocked ?? response);
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
