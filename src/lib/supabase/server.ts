import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { VIEWAS_COOKIE, verifyViewAs } from "@/lib/viewas";
import { viewAsTarget } from "@/server/viewas-target";
import { memo, sessionKeyOf } from "@/lib/request-cache";

export const authConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Cliente de Supabase Auth en el servidor (solo clave pública). La sesión vive en cookies httpOnly. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* en componentes de servidor las cookies son de solo lectura; el proxy las renueva */ } },
    },
  });
}

export interface SessionUser { id: string; email: string | null; /** tiene clave propia (identidad de correo); quien entra solo con Google no */ emailLogin?: boolean; /** D-91: true cuando el Super usuario está viendo la aplicación como otra persona (solo lectura). */ viewAs?: boolean }

/** Clave de la sesión de esta petición (ver request-cache.ts): cambia si cambian las cookies de Supabase, así que ingresar o salir nunca reutiliza una respuesta vieja. */
const sessionKey = async () => sessionKeyOf((await cookies()).getAll());

/** Se valida contra Supabase Auth UNA vez por petición y sesión, aunque el diseño general y la página lo pidan. */
const realUserFor = memo(async (session: string): Promise<SessionUser | null> => {
  void session; // solo distingue entradas del caché; la validación lee las cookies de la petición
  const { data } = await (await createClient()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null, emailLogin: !!data.user.identities?.some((i) => i.provider === "email") } : null;
});

/** Sesión real (validada contra Supabase Auth), sin «ver como». */
export async function getRealUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  return realUserFor(await sessionKey());
}

/** ¿La sesión real tiene una clave propia (identidad de correo)? Quien entra solo con Google no la tiene. Sale de la misma validación de sesión: no consulta de nuevo. */
export async function hasPasswordLogin(): Promise<boolean> {
  return (await getRealUser())?.emailLogin ?? false;
}

/** Usuario autenticado o null. Si el Super usuario activó «ver como», devuelve a esa persona (todo lo demás la trata como tal; la base de datos solo deja leer). */
export async function getUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return userFor(sessionKeyOf(store.getAll()), store.get(VIEWAS_COOKIE)?.value ?? "");
}

/** La clave incluye la cookie de «ver como»: entrar o salir de esa vista cambia la clave y se recalcula. */
const userFor = memo(async (session: string, viewAsToken: string): Promise<SessionUser | null> => {
  void session; // solo distingue entradas del caché
  const real = await getRealUser();
  if (!real) return null;
  const v = verifyViewAs(viewAsToken || undefined, real.id);
  if (!v || v.targetId === real.id) return real;
  const target = await viewAsTarget(v.adminId, v.targetId);
  return target ? { id: v.targetId, email: target.email, viewAs: true } : real;
});
