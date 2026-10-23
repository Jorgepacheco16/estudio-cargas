export const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? "postgres://postgres:pg_admin@localhost:5432/studydb";
/** Protección para pruebas destructivas (TRUNCATE de studies y auth.users): no se ejecutan contra una base alojada con datos reales. */
export function refuseHostedDb() {
  if (/supabase\.(com|co)/.test(URL_ADMIN) && process.env.ALLOW_DESTRUCTIVE_TESTS !== "yes") {
    console.error("Bloqueado: esta prueba borra todos los estudios y usuarios. No se ejecuta contra Supabase (use PostgreSQL local o el CI). Para forzarla en una base vacía: ALLOW_DESTRUCTIVE_TESTS=yes");
    process.exit(2);
  }
}
export const URL_APP = process.env.DATABASE_URL ?? "postgres://app_user:app_pw@localhost:5432/studydb";
let pass = 0, fail = 0;
export async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("  PASS ", name); } catch (e) { fail++; console.log("  FAIL ", name, "→", (e as Error).message); }
}
export const summary = () => { console.log(`\nResultado: ${pass} pruebas OK, ${fail} fallidas`); if (fail) process.exit(1); };
export async function rejects(p: Promise<unknown>, code: string) {
  try { await p; } catch (e: any) { const c = e?.code ?? e?.cause?.code; if (c === code) return; throw new Error(`se esperaba SQLSTATE ${code} y llegó ${c}: ${e.message}`); }
  throw new Error(`se esperaba error ${code} pero la operación tuvo éxito`);
}
