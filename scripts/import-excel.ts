/**
 * Importa el libro de Excel a un estudio.
 *   npx tsx scripts/import-excel.ts --file <ruta.xlsx> --email <correo> [--study <id>] [--commit]
 * Sin --commit es una prueba: se ejecuta TODO (inserciones y verificaciones) en una transacción que se revierte.
 * Resuelve el usuario con la conexión de migraciones (herramienta de administración, nunca una ruta de usuario);
 * los datos se escriben con la conexión de la app y RLS, como el propio usuario.
 * El informe se guarda en .import-reports/ (ignorado por git: puede contener datos del estudio).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { parseWorkbook } from "../src/server/import/parse";
import { importWorkbook } from "../src/server/import/load";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const file = arg("file"), email = arg("email"), commit = process.argv.includes("--commit");
  const admin = process.env.DATABASE_URL_MIGRATIONS, app = process.env.DATABASE_URL;
  if (!file || !email || !admin || !app) throw new Error("Uso: --file <xlsx> --email <correo>; requiere DATABASE_URL y DATABASE_URL_MIGRATIONS en el entorno");

  const a = createDb(admin, 1), b = createDb(app, 2);
  try {
    const u = (await a.db.execute(sql`select id from auth.users where lower(email) = lower(${email}) limit 1`)) as unknown as { id: string }[];
    if (!u[0]) throw new Error("No hay un usuario con ese correo (debe haber iniciado sesión al menos una vez)");
    const sub = u[0].id;
    const studies = (await a.db.execute(sql`select s.id, s.name from public.studies s join public.memberships m on m.study_id = s.id where m.user_id = ${sub} and m.role in ('owner','editor','analyst') order by s.created_at desc`)) as unknown as { id: string; name: string }[];
    const studyId = arg("study") ?? studies[0]?.id;
    if (!studyId) throw new Error("El usuario no tiene un estudio donde escribir; créelo primero en la aplicación");
    const study = studies.find((s) => s.id === studyId);
    if (!study) throw new Error("El usuario no tiene permiso de escritura en ese estudio");

    const bytes = readFileSync(file);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const parsed = await parseWorkbook(bytes);
    const result = await importWorkbook(b.db, sub, studyId, parsed, { dryRun: !commit });

    mkdirSync(".import-reports", { recursive: true });
    const path = `.import-reports/import_${new Date().toISOString().replace(/[:.]/g, "-")}${commit ? "" : "_prueba"}.json`;
    writeFileSync(path, JSON.stringify({ file, sha256: sha, studyId, ...result }, null, 2));

    const sev = (s: string) => result.issues.filter((i) => i.severity === s).length;
    console.log(`Modo: ${commit ? "CONFIRMAR (commit)" : "PRUEBA (se revierte)"} · estudio '${study.name}'`);
    console.log(`sha256: ${sha}`);
    console.table(result.counts);
    console.log(`Hallazgos: ${sev("error")} errores · ${sev("warning")} advertencias · ${sev("info")} informativos`);
    console.log(`Conteo cuadra: ${result.verification.countsOk}`);
    const r = result.verification.recompute;
    console.log(`Recálculo vs hoja 4a: ${r.compared} valores comparados en ${r.activities} actividades · ${r.diffs.length} diferencias · no comparadas: ${r.notCompared.length}`);
    console.log(`Confirmado en la base: ${result.committed}`);
    console.log(`Informe: ${path}`);
    if (r.diffs.length) { console.log("Diferencias (primeras 10):"); console.table(r.diffs.slice(0, 10)); process.exitCode = 1; }
  } finally { await a.client.end(); await b.client.end(); }
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
