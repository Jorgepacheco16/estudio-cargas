/**
 * Prueba contra Google Sheets REAL (brief §12.7). La cuenta de servicio no puede crear archivos, así que se prueba sobre una hoja ya compartida
 * con ella (variable SHEET_ID o argumento), SIN tocar sus datos:
 *  1. primitivas de Google en una pestaña TEMPORAL que se borra al terminar (RAW contra fórmulas, columnas ocultas, lectura);
 *  2. vista previa (solo lectura) de la hoja contra un estudio, si se indica STUDY_EMAIL: cuenta qué haría la sincronización sin escribir nada.
 * Uso: tsx --env-file=.env.local scripts/test-sheets-live.ts <spreadsheetId> [correo del propietario del estudio]
 */
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { googleGateway } from "../src/server/sheets/gateway";
import { sheetsClient } from "../src/server/sheets";
import { previewSync, lookupConnection } from "../src/server/sheets/sync";
import { listStudies } from "../src/server/studies";
import { check, summary, URL_ADMIN, URL_APP } from "../tests/helpers";

async function main() {
  const [id, email] = process.argv.slice(2);
  if (!id) throw new Error("Indique el id de la hoja");
  const api = sheetsClient();
  const TMP = `_prueba_${Date.now()}`;
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: TMP, gridProperties: { rowCount: 20, columnCount: 5 } } } }] } });
  const tmpId = add.data.replies![0].addSheet!.properties!.sheetId!;
  try {
    const gw = googleGateway(id);
    await check("Google real: se escribe en RAW (una fórmula queda como texto) y se lee lo escrito", async () => {
      await gw.write([{ range: `'${TMP}'!A1:C1`, values: [["=HYPERLINK(\"http://x\")", "+cmd", 12.5]] }]);
      const g = await api.spreadsheets.get({ spreadsheetId: id, ranges: [`'${TMP}'!A1:C1`], includeGridData: true, fields: "sheets.data.rowData.values.userEnteredValue" });
      const v = g.data.sheets?.find((s) => (s.data?.[0]?.rowData?.length ?? 0) > 0)?.data?.[0]?.rowData?.[0]?.values ?? [];
      if (v[0]?.userEnteredValue?.formulaValue || v[0]?.userEnteredValue?.stringValue !== "=HYPERLINK(\"http://x\")") throw new Error(`fórmula interpretada: ${JSON.stringify(v[0])}`);
      if (v[1]?.userEnteredValue?.formulaValue) throw new Error("«+cmd» se interpretó como fórmula");
      const back = await gw.read(`'${TMP}'!A1:C1`);
      if (back[0]?.[2] !== 12.5) throw new Error(JSON.stringify(back));
    });
    await check("Google real: se agregan columnas al final y quedan ocultas", async () => {
      const before = await gw.columnCount(TMP);
      await gw.appendHiddenColumns(TMP, 2);
      if ((await gw.columnCount(TMP)) !== before + 2) throw new Error("no se agregaron columnas");
      const g = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties.title,data.columnMetadata)", includeGridData: true, ranges: [`'${TMP}'!F1:G1`] });
      const cols = g.data.sheets?.find((s) => s.properties?.title === TMP)?.data?.[0]?.columnMetadata ?? [];
      if (cols.length !== 2 || !cols.every((c) => c.hiddenByUser)) throw new Error(JSON.stringify(cols));
    });

    if (email) await check("Google real: la vista previa sobre su hoja y su estudio lee todo y NO escribe nada", async () => {
      const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
      try {
        const u = (await admin.db.execute(sql`select id from auth.users where email = ${email}`)) as unknown as { id: string }[];
        if (!u[0]) throw new Error("usuario no encontrado");
        const studies = await listStudies(app.db, u[0].id);
        if (!studies.length) throw new Error("el usuario no tiene estudios");
        const conn = { id: "preview", studyId: studies[0].id, actorId: u[0].id, spreadsheetId: id, mode: "bidirectional" };
        void lookupConnection;
        const before = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,gridProperties.columnCount)" });
        const pv = await previewSync(app.db, conn, gw);
        const after = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,gridProperties.columnCount)" });
        if (JSON.stringify(before.data.sheets) !== JSON.stringify(after.data.sheets)) throw new Error("la vista previa cambió la estructura de la hoja");
        for (const p of pv.pull) console.log(`   hoja → app · ${p.sheet}: ${Object.entries(p.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "sin filas"}`);
        for (const p of pv.push) console.log(`   app → hoja · ${p.sheet}: agregaría ${p.appended}, sin vincular ${p.unlinked}`);
      } finally { await admin.client.end(); await app.client.end(); }
    });
  } finally {
    await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ deleteSheet: { sheetId: tmpId } }] } });
    console.log("Pestaña temporal eliminada.");
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
