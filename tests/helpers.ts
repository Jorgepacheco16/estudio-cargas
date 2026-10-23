export const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? "postgres://postgres:pg_admin@localhost:5432/studydb";
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
