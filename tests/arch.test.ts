import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { check, summary } from "./helpers";

/**
 * Reglas de arquitectura que el brief exige imponer con código y no con texto (CLAUDE.md §4, brief §16.1 «El ORM salta RLS»):
 * ninguna consulta de usuario toca la base fuera de withRls(), y las llaves de administración no existen en el código de la aplicación.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
}
const files = walk("src").map((p) => ({ path: relative(".", p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
const outsideDb = files.filter((f) => !f.path.startsWith("src/db/"));

async function main() {
  await check(`El cliente SQL («postgres») solo se importa dentro de src/db/ (${files.length} archivos revisados)`, () => {
    const bad = outsideDb.filter((f) => /from\s+["']postgres["']|require\(["']postgres["']\)/.test(f.text)).map((f) => f.path);
    if (bad.length) throw new Error(`importan el cliente SQL: ${bad.join(", ")}`);
  });

  await check("La llave de servicio y la conexión de migraciones no se mencionan en el código de la aplicación", () => {
    const bad = files.filter((f) => /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL_MIGRATIONS|DATABASE_URL_ADMIN/.test(f.text)).map((f) => f.path);
    if (bad.length) throw new Error(`usan credenciales de administración: ${bad.join(", ")}`);
  });

  await check("Ninguna consulta se hace directamente sobre la conexión (db.select/insert/update/delete): todo va por withRls()", () => {
    const bad = outsideDb.filter((f) => /\bdb\.(select|insert|update|delete|transaction)\s*\(/.test(f.text)).map((f) => f.path);
    if (bad.length) throw new Error(`consultas directas sobre db: ${bad.join(", ")}`);
  });

  await check("Los únicos db.execute sin withRls() llaman a las funciones seguras sin sesión (conexión de hoja y objetivos de fotos), sin leer tablas", () => {
    const bad: string[] = [];
    for (const f of outsideDb) for (const m of f.text.matchAll(/\bdb\.execute\(sql`([^`]*)`/g)) if (!/from public\.(sheet_connection_lookup|sheet_connections_active|snapshot_targets)\(/.test(m[1])) bad.push(`${f.path}: ${m[1].slice(0, 80)}`);
    if (bad.length) throw new Error(bad.join("; "));
  });

  await check("El dominio es puro: src/domain no importa la base, el servidor ni el framework", () => {
    const bad = files.filter((f) => f.path.startsWith("src/domain/") && /from\s+["'](\.\.\/(db|server|data|app|lib)|next|react|postgres|drizzle-orm|@anthropic-ai\/sdk|@googleapis)/.test(f.text)).map((f) => f.path);
    if (bad.length) throw new Error(`dominio impuro: ${bad.join(", ")}`);
  });

  await check("Las rutas de la API y las acciones de servidor no devuelven detalles internos de la base (sin imprimir e.message ni stack al cliente)", () => {
    const bad = outsideDb.filter((f) => /\/(api|app)\//.test(f.path) && /(message:\s*(e|err|error)\.message|\.stack\b)/.test(f.text)).map((f) => f.path);
    if (bad.length) throw new Error(`posible filtración de errores internos: ${bad.join(", ")}`);
  });

  await check("Ningún archivo versionado de src/ contiene secretos (patrones del hook)", async () => {
    const { revisar } = await import("../.claude/hooks/block-secrets.js") as { revisar: (e: unknown) => string | null };
    const bad = files.map((f) => ({ f, r: revisar({ tool_input: { file_path: f.path, content: f.text } }) })).filter((x) => x.r).map((x) => `${x.f.path}: ${x.r}`);
    if (bad.length) throw new Error(bad.join("; "));
  });
}
main().then(summary);
