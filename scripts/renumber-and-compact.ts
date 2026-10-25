/**
 * Corrección puntual tras eliminar actividades: renumera los códigos SUP-### para que sean consecutivos (sin huecos) y cierra los huecos en las hojas
 * de Google (actividades y caracterización). Los registros dependientes (evaluaciones, oportunidades, plan, mediciones) se enlazan por identificador
 * interno, no por código, así que no se tocan; en la hoja se actualiza el código que muestran.
 *   npx tsx --env-file=.env.local scripts/renumber-and-compact.ts preview|apply
 */
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { adapterById } from "../src/server/sheets/adapters";
import { googleGateway } from "../src/server/sheets/gateway";
import { compactSheet, pushAll } from "../src/server/sheets/mirror";

const SPREADSHEET_ID = "1jPZcECUYT0r_MS2LCkPLlAWCyFIKD7bmXvVdjNfw5PM";
const PREFIX = "SUP-";

async function main() {
  const mode = process.argv[2];
  if (mode !== "preview" && mode !== "apply") throw new Error("Use «preview» o «apply»");
  const admin = createDb(process.env.DATABASE_URL_MIGRATIONS!, 1), app = createDb(process.env.DATABASE_URL!, 2);
  try {
    const [c] = (await admin.db.execute(sql`select id, study_id, actor_id from public.sheet_connections where spreadsheet_id = ${SPREADSHEET_ID}`)) as unknown as { id: string; study_id: string; actor_id: string }[];
    const rows = (await admin.db.execute(sql`select id, code from public.activities where study_id = ${c.study_id} order by code`)) as unknown as { id: string; code: string }[];
    if (rows.some((r) => !new RegExp(`^${PREFIX}\\d{3}$`).test(r.code))) throw new Error("Hay códigos que no siguen el formato SUP-###; no se renumera.");
    const plan = rows.map((r, i) => ({ ...r, to: `${PREFIX}${String(i + 1).padStart(3, "0")}` })).filter((r) => r.to !== r.code);
    console.log(plan.length ? `Renumeración: ${plan.map((p) => `${p.code.slice(4)}→${p.to.slice(4)}`).join(", ")}` : "Los códigos ya son consecutivos.");
    if (mode === "apply") {
      for (const p of plan) { // ascendente: el destino siempre es menor y ya está libre
        await admin.db.execute(sql`update public.activities set code = ${p.to} where id = ${p.id}`);
        await admin.db.execute(sql`insert into public.audit_log (study_id, actor_id, origin, action, entity, entity_id, diff) values (${c.study_id}, ${c.actor_id}, 'app', 'update', 'activity', ${p.id}, ${JSON.stringify({ code: { from: p.code, to: p.to } })}::jsonb)`);
      }
    }
    const conn = { id: c.id, studyId: c.study_id, actorId: c.actor_id, spreadsheetId: SPREADSHEET_ID, mode: "push" as const };
    const gw = googleGateway(SPREADSHEET_ID);
    for (const id of ["3", "2"]) {
      const r = await compactSheet(app.db, conn, gw, adapterById(id)!, mode === "preview");
      console.log(`${r.sheet}: filas fuera de lugar ${r.gapsBefore}, filas a reescribir ${r.moved}, filas liberadas al final ${r.cleared}${mode === "preview" ? " (vista previa)" : ""}`);
    }
    if (mode === "apply") for (const s of await pushAll(app.db, conn, gw, true)) if (s.refreshed + s.appended + s.cleared + s.unlinked) console.log(`  pendiente tras el espejo: ${s.sheet} nuevas ${s.appended} · actualizadas ${s.refreshed} · limpiadas ${s.cleared} · sin vincular ${s.unlinked}`);
  } finally { await admin.client.end(); await app.client.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
