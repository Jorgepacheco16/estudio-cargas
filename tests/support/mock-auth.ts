/**
 * Servidor de autenticación SIMULADO (solo pruebas): imita lo mínimo de Supabase Auth que usa la aplicación (/auth/v1/user, signup, token y logout) para poder probar
 * en un navegador de verdad el ingreso por invitación, los permisos por rol y «ver como» sin tocar el Supabase real. Las cuentas se guardan en la tabla auth.users de la
 * base de pruebas (así las llaves foráneas de memberships se cumplen).
 *   tsx tests/support/mock-auth.ts   → escucha en MOCK_AUTH_PORT (54321 por defecto)
 */
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const PORT = Number(process.env.MOCK_AUTH_PORT ?? 54321);
const sql = postgres(process.env.DATABASE_URL_ADMIN ?? "postgres://postgres:pg_admin@127.0.0.1:5432/postgres", { max: 2, onnotice: () => {} });
interface User { id: string; email: string; password: string }
const users = new Map<string, User>();           // por correo
const byId = new Map<string, User>();
const access = new Map<string, string>();        // access_token → id
const refresh = new Map<string, string>();       // refresh_token → id
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const userJson = (u: User) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {}, identities: [{ id: u.id, provider: "email" }], created_at: new Date().toISOString() });
function session(u: User) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp })}.${randomBytes(16).toString("base64url")}`;
  const rt = randomBytes(24).toString("base64url");
  access.set(token, u.id); refresh.set(rt, u.id);
  return { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: rt, user: userJson(u) };
}
async function create(email: string, password: string): Promise<User> {
  const u = { id: randomUUID(), email: email.toLowerCase(), password };
  await sql`insert into auth.users (id) values (${u.id})`;
  users.set(u.email, u); byId.set(u.id, u);
  return u;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const body = await new Promise<Record<string, unknown>>((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } }); });
  const send = (code: number, obj?: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
  const path = url.pathname;
  if (path === "/auth/v1/user" && req.method === "GET") {
    const id = access.get(String(req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    return id ? send(200, userJson(byId.get(id)!)) : send(401, { code: 401, msg: "invalid JWT" });
  }
  if (path === "/auth/v1/signup" && req.method === "POST") {
    const email = String(body.email ?? "").toLowerCase();
    if (users.has(email)) return send(200, { ...userJson(users.get(email)!), identities: [] }); // como Supabase: una cuenta existente vuelve sin identidades
    return send(200, session(await create(email, String(body.password ?? ""))));
  }
  if (path === "/auth/v1/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const u = users.get(String(body.email ?? "").toLowerCase());
      return u && u.password === String(body.password ?? "") ? send(200, session(u)) : send(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
    }
    if (grant === "refresh_token") { const id = refresh.get(String(body.refresh_token ?? "")); return id ? send(200, session(byId.get(id)!)) : send(400, { error: "invalid_grant" }); }
  }
  if (path === "/auth/v1/logout") return send(204);
  if (path === "/__reset" && req.method === "POST") { users.clear(); byId.clear(); access.clear(); refresh.clear(); return send(200, { ok: true }); }
  if (path === "/__user" && req.method === "POST") { const u = await create(String(body.email), String(body.password ?? "Clave-de-prueba-1")); return send(200, { id: u.id, email: u.email }); }
  return send(404, { error: "no existe" });
});
server.listen(PORT, "127.0.0.1", () => console.log(`Autenticación simulada en http://127.0.0.1:${PORT}`));
