import { spawnSync } from "node:child_process";
import { check, summary } from "./helpers";

/** Hook PreToolUse (.claude/hooks/block-secrets.js): se ejecuta como lo hace Claude Code (JSON por la entrada estándar; salida 2 = bloquear). */
const run = (event: unknown, raw?: string) => spawnSync(process.execPath, [".claude/hooks/block-secrets.js"], { input: raw ?? JSON.stringify(event), encoding: "utf8" });
const write = (file_path: string, content: string) => ({ tool_name: "Write", tool_input: { file_path, content } });
const x = (n: number) => "a1B2c3D4e5".repeat(Math.ceil(n / 10)).slice(0, n);

async function main() {
  await check("Bloquea escribir un archivo .env (salida 2) y también .env.local y .env.production", () => {
    for (const f of [".env", ".env.local", "apps/web/.env.production", "C:\\proyecto\\.env.vercel"]) { const r = run(write(f, "A=1")); if (r.status !== 2 || !r.stderr.includes("Bloqueado")) throw new Error(`${f}: salida ${r.status}`); }
  });
  await check("Permite .env.example y código normal", () => {
    for (const [f, c] of [[".env.example", "SUPABASE_URL=\nANTHROPIC_API_KEY=\n"], ["src/a.ts", "export const sumar = (a: number, b: number) => a + b;\n"], ["docs/x.md", "Use la variable DATABASE_URL (sin valor).\n"]]) { const r = run(write(f, c)); if (r.status !== 0) throw new Error(`${f}: salida ${r.status} ${r.stderr}`); }
  });
  await check("Bloquea contenido con claves de los proveedores del proyecto (Anthropic, Supabase, Vercel, GitHub, JWT, llave privada)", () => {
    const casos: [string, string][] = [
      ["Anthropic", "sk-ant-" + x(40)], ["Supabase sbp", "sbp" + "_" + x(30)], ["Supabase secret", "sb_secret" + "_" + x(30)], ["Vercel", "vcp" + "_" + x(30)], ["GitHub", "ghp" + "_" + x(36)],
      ["JWT", "eyJ" + x(20) + ".eyJ" + x(20) + "." + x(20)], ["llave privada", "-----BEGIN PRIVATE" + " KEY-----\nMIIE"], ["conexión remota", "postgres://usuario:Clave123456@aws-1-sa-east-1.pooler.supabase.com:6543/postgres"],
    ];
    for (const [n, c] of casos) { const r = run(write("src/config.ts", `const k = "${c}";`)); if (r.status !== 2) throw new Error(`${n}: salida ${r.status}`); }
  });
  await check("Bloquea también las ediciones (Edit/new_string) y permite la cadena de conexión local de las pruebas", () => {
    if (run({ tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "x", new_string: "const t = '" + "sk-ant-" + x(40) + "'" } }).status !== 2) throw new Error("Edit con secreto");
    if (run(write("tests/helpers.ts", "const u = 'postgres://postgres:pg_admin@localhost:5432/studydb';")).status !== 0) throw new Error("bloqueó la conexión local de pruebas");
  });
  await check("Entrada ilegible: se bloquea por seguridad en lugar de dejar pasar", () => {
    const r = run(null, "{no es json"); if (r.status !== 2) throw new Error(`salida ${r.status}`);
  });
}
main().then(summary);
