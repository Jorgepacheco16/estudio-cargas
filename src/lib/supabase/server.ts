import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { VIEWAS_COOKIE, verifyViewAs } from "@/lib/viewas";
import { viewAsTarget } from "@/server/viewas-target";

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

export interface SessionUser { id: string; email: string | null; /** D-91: true cuando el Super usuario está viendo la aplicación como otra persona (solo lectura). */ viewAs?: boolean }

/** Sesión real (validada contra Supabase Auth), sin «ver como». */
export async function getRealUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const { data } = await (await createClient()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}

/** Usuario autenticado o null. Si el Super usuario activó «ver como», devuelve a esa persona (todo lo demás la trata como tal; la base de datos solo deja leer). */
export async function getUser(): Promise<SessionUser | null> {
  const real = await getRealUser();
  if (!real) return null;
  const token = (await cookies()).get(VIEWAS_COOKIE)?.value;
  const v = verifyViewAs(token, real.id);
  if (!v || v.targetId === real.id) return real;
  const target = await viewAsTarget(v.adminId, v.targetId);
  return target ? { id: v.targetId, email: target.email, viewAs: true } : real;
}
