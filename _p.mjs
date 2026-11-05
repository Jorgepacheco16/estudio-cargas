import { readFileSync, writeFileSync } from "node:fs";
const edit = (p, fn) => { let s = readFileSync(p, "utf8").replace(/\r\n/g, "\n"); s = fn(s); writeFileSync(p, s); };
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error("no encontrado: " + a.slice(0, 70)); return s.replace(a, () => b); };

// 1) sesión: una sola validación por petición
edit("src/lib/supabase/server.ts", (s) => {
  s = rep(s, 'import { viewAsTarget } from "@/server/viewas-target";', 'import { viewAsTarget } from "@/server/viewas-target";\nimport { memo, sessionKeyOf } from "@/lib/request-cache";');
  s = rep(s, `/** Sesión real (validada contra Supabase Auth), sin «ver como». */
export async function getRealUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const { data } = await (await createClient()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}`, `/** Clave de la sesión de esta petición (ver request-cache.ts): cambia si cambian las cookies de Supabase, así que ingresar o salir nunca reutiliza una respuesta vieja. */
const sessionKey = async () => sessionKeyOf((await cookies()).getAll());

/** Se valida contra Supabase Auth UNA vez por petición y sesión, aunque el diseño general y la página lo pidan. */
const realUserFor = memo(async (_session: string): Promise<SessionUser | null> => {
  const { data } = await (await createClient()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
});

/** Sesión real (validada contra Supabase Auth), sin «ver como». */
export async function getRealUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  return realUserFor(await sessionKey());
}`);
  s = rep(s, `export async function getUser(): Promise<SessionUser | null> {
  const real = await getRealUser();
  if (!real) return null;
  const token = (await cookies()).get(VIEWAS_COOKIE)?.value;
  const v = verifyViewAs(token, real.id);
  if (!v || v.targetId === real.id) return real;
  const target = await viewAsTarget(v.adminId, v.targetId);
  return target ? { id: v.targetId, email: target.email, viewAs: true } : real;
}`, `export async function getUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return userFor(sessionKeyOf(store.getAll()), store.get(VIEWAS_COOKIE)?.value ?? "");
}

/** La clave incluye la cookie de «ver como»: entrar o salir de esa vista cambia la clave y se recalcula. */
const userFor = memo(async (_session: string, viewAsToken: string): Promise<SessionUser | null> => {
  const real = await getRealUser();
  if (!real) return null;
  const v = verifyViewAs(viewAsToken || undefined, real.id);
  if (!v || v.targetId === real.id) return real;
  const target = await viewAsTarget(v.adminId, v.targetId);
  return target ? { id: v.targetId, email: target.email, viewAs: true } : real;
});`);
  return s;
});

// 2) estudio activo y permisos: una consulta por petición mientras nada cambie
edit("src/data/source.ts", (s) => {
  s = rep(s, 'import { cache } from "react";\n', "");
  s = rep(s, 'import { loadDashboard } from "@/server/dashboard-data";', 'import { loadDashboard } from "@/server/dashboard-data";\nimport { memo, requestEpoch } from "@/lib/request-cache";');
  s = rep(s, "const accessFor = cache((userId: string, studyId: string) => getMyAccess(getDb(), userId, studyId));",
`/** Estudios y permisos de la persona: una consulta por petición. El último parámetro es el contador de cambios de la petición (request-cache.ts): si algo se modificó, se consulta de nuevo. */
const studiesFor = memo((userId: string, _epoch: number) => listStudies(getDb(), userId));
const accessFor = memo((userId: string, studyId: string, _epoch: number) => getMyAccess(getDb(), userId, studyId));`);
  s = rep(s, "  const list = await listStudies(getDb(), userId);\n", "  const epoch = requestEpoch();\n  const list = await studiesFor(userId, epoch);\n");
  s = rep(s, "access: await accessFor(userId, s.id) };", "access: await accessFor(userId, s.id, epoch) };");
  return s;
});

// 3) quien modifica estudios, roles o personas avisa que la petición cambió algo
edit("src/server/access.ts", (s) => {
  for (const f of ["saveRole", "deleteRole", "setMyDisplayName", "updateMember", "removeMember", "redeemInvitation"]) {
    const re = new RegExp(`(export async function ${f}\([^\n]*\{\n)`);
    if (!re.test(s)) throw new Error("no encontrada " + f);
    s = s.replace(re, (m) => m + "  bumpRequestEpoch();\n");
  }
  s = rep(s, 'import { createHash', 'import { bumpRequestEpoch } from "@/lib/request-cache";\nimport { createHash');
  return s;
});
edit("src/server/studies.ts", (s) => {
  const re = /(export async function createStudy\([^\n]*\{\n)/;
  if (!re.test(s)) throw new Error("no encontrada createStudy");
  s = s.replace(re, (m) => m + "  bumpRequestEpoch();\n");
  const first = s.indexOf("\nimport ");
  s = s.slice(0, first + 1) + 'import { bumpRequestEpoch } from "@/lib/request-cache";\n' + s.slice(first + 1);
  return s;
});
