import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import postgres from "postgres";
import type { BrowserContext } from "@playwright/test";

/**
 * Usuario de prueba TEMPORAL en el Supabase de desarrollo (solo para pruebas locales; nunca en CI ni en producción):
 * se crea con la API de administración, inicia sesión con contraseña mediante el mismo cliente de la aplicación y sus cookies de sesión se
 * inyectan en el navegador. Al terminar se borran sus datos y el usuario.
 */
try { process.loadEnvFile(".env.local"); } catch { /* sin archivo: las variables ya deben estar definidas */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const e2eEnabled = process.env.E2E_SESSION === "1" && !!url && !!anon && !!service && !!process.env.DATABASE_URL_MIGRATIONS;

export interface TestUser { id: string; email: string; password: string }
const admin = (path: string, init: RequestInit = {}) => fetch(`${url}/auth/v1/admin/${path}`, { ...init, headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

export async function createTestUser(): Promise<TestUser> {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`, password = `Pw-${randomUUID()}`;
  const r = await admin("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!r.ok) throw new Error(`No se pudo crear el usuario de prueba (${r.status})`);
  return { id: ((await r.json()) as { id: string }).id, email, password };
}

export async function signInCookies(u: TestUser, context: BrowserContext, baseURL: string) {
  const jar: { name: string; value: string }[] = [];
  const sb = createServerClient(url, anon, { cookies: { getAll: () => [], setAll: (list) => { jar.push(...list.map(({ name, value }) => ({ name, value }))); } } });
  const { error } = await sb.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`Inicio de sesión de prueba falló: ${error.message}`);
  await context.addCookies(jar.map((c) => ({ name: c.name, value: c.value, url: baseURL, sameSite: "Lax" as const })));
}

/** Borra los estudios creados por el usuario de prueba (y por cascada todo lo suyo) y luego el usuario. */
export async function removeTestUser(u: TestUser) {
  const sql = postgres(process.env.DATABASE_URL_MIGRATIONS!, { max: 1, prepare: false });
  try { await sql`delete from public.studies where created_by = ${u.id}`; } finally { await sql.end(); }
  await admin(`users/${u.id}`, { method: "DELETE" });
}
