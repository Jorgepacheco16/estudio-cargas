import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

export interface SessionUser { id: string; email: string | null }

/** Usuario autenticado (validado contra Supabase Auth) o null. */
export async function getUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const { data } = await (await createClient()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}
