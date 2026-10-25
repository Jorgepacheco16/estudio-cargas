/**
 * D-63: pone la conexión real en modo «la app alimenta la hoja» y espeja app → hoja de Google.
 *   npx tsx --env-file=.env.local scripts/mirror-real.ts preview   → cuenta lo que se escribiría (no escribe nada)
 *   npx tsx --env-file=.env.local scripts/mirror-real.ts apply     → cambia el modo a push y escribe en la hoja
 * Usa el actor de la conexión y withRls (nunca la llave de servicio); la conexión de migraciones solo ubica la fila de la conexión.
 */
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { googleGateway } from "../src/server/sheets/gateway";
import { pushAll } from "../src/server/sheets/mirror";

const SPREADSHEET_ID = "1jPZcECUYT0r_MS2LCkPLlAWCyFIKD7bmXvVdjNfw5PM";

async function main() {
  const mode = process.argv[2];
  if (mode !== "preview" && mode !== "apply") throw new Error("Use «preview» o «apply»");
  const admin = createDb(process.env.DATABASE_URL_MIGRATIONS!, 1);
  const app = createDb(process.env.DATABASE_URL!, 2);
  try {
    const rows = (await admin.db.execute(sql`select id, study_id, actor_id, mode from public.sheet_connections where spreadsheet_id = ${SPREADSHEET_ID}`)) as unknown as { id: string; study_id: string; actor_id: string; mode: string }[];
    if (rows.length !== 1) throw new Error(`Se esperaba 1 conexión y hay ${rows.length}`);
    const c = rows[0];
    console.log(`Conexión ${c.id.slice(0, 8)}… modo actual: ${c.mode}`);
    const conn = { id: c.id, studyId: c.study_id, actorId: c.actor_id, spreadsheetId: SPREADSHEET_ID, mode: "push" as const };
    const gw = googleGateway(SPREADSHEET_ID);
    const stats = await pushAll(app.db, conn, gw, mode === "preview");
    for (const s of stats) {
      console.log(`${s.sheet.padEnd(20)} nuevas ${s.appended} · actualizadas ${s.refreshed} · limpiadas ${s.cleared} · iguales ${s.unchanged} · sin vincular ${s.unlinked} · con forma de fórmula ${s.formulaLike}`);
      for (const d of s.diffs ?? []) console.log(`    ${d}`);
    }
    if (mode === "apply") {
      await admin.db.execute(sql`update public.sheet_connections set mode = 'push', status = 'idle', last_sync_at = now() where id = ${c.id}`);
      console.log("Modo cambiado a «La app alimenta la hoja» (push).");
    }
  } finally { await admin.client.end(); await app.client.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
