/**
 * Prueba contra Google Sheets REAL: los 6 escenarios del brief (F8, §12.7) — edición, cambio desde la app, conflicto, evento repetido,
 * evento perdido y fórmula inyectada — más las primitivas de Google (RAW, columnas ocultas, lectura).
 *
 * La cuenta de servicio no puede crear archivos, así que se usa una hoja ya compartida con ella, SIN tocar sus datos: se crean pestañas TEMPORALES
 * con prefijo «_t_» (una por cada hoja sincronizada) que se borran al terminar, y un estudio temporal que se borra también.
 * Uso: tsx --env-file=.env.local scripts/test-sheets-live.ts <spreadsheetId> [correo del propietario del estudio real para la vista previa de solo lectura]
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy, listActivityVersions, listStudies, loadStudyData, updateActivityTime } from "../src/server/studies";
import { connectSheet, handleEvent, lookupConnection, previewSync, pushAll, reconcile } from "../src/server/sheets/sync";
import { googleGateway, type SheetGateway } from "../src/server/sheets/gateway";
import { sheetsClient } from "../src/server/sheets";
import type { SheetChangeEvent } from "../src/domain/contracts";
import { check, summary, URL_ADMIN, URL_APP } from "../tests/helpers";

const P = "_t_";
const TABS: Record<string, number> = { "3_Actividades": 51, "5_Medibilidad": 26, "6_Pertinencia": 26, "7_Riesgos": 26, "8_Oportunidades": 29, "10_Plan_accion": 26 };

/** Misma hoja de Google, pero cada pestaña lógica «3_Actividades» vive en la pestaña temporal «_t_3_Actividades». */
function prefixed(gw: SheetGateway): SheetGateway {
  const fix = (r: string) => r.replace(/^'([^']+)'!/, (_, n: string) => `'${P}${n}'!`);
  return {
    read: (r) => gw.read(fix(r)), readFormulas: (r) => gw.readFormulas(fix(r)), writeFormulas: (u) => gw.writeFormulas(u.map((x) => ({ ...x, range: fix(x.range) }))), write: (u) => gw.write(u.map((x) => ({ ...x, range: fix(x.range) }))),
    columnCount: (s) => gw.columnCount(P + s), appendHiddenColumns: (s, c) => gw.appendHiddenColumns(P + s, c), appendColumns: (s, c) => gw.appendColumns(P + s, c), title: () => gw.title(), protect: (s, r, d) => gw.protect(P + s, r, d),
  };
}

async function main() {
  const [id, email] = process.argv.slice(2);
  if (!id) throw new Error("Indique el id de la hoja");
  const api = sheetsClient();
  const real = googleGateway(id);
  const gw = prefixed(real);
  const created = await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: Object.entries(TABS).map(([n, c]) => ({ addSheet: { properties: { title: P + n, gridProperties: { rowCount: 80, columnCount: c } } } })) } });
  const tabIds = created.data.replies!.map((r) => r.addSheet!.properties!.sheetId!);
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID();
  await admin.db.execute(sql`insert into auth.users (id) values (${owner})`);
  let studyId = "";
  const fakeId = `live-${randomUUID()}`;
  const ev = (row: number, rows = 1, eventId = randomUUID()): SheetChangeEvent => ({ eventId, spreadsheetId: fakeId, sheetName: "3_Actividades", kind: "edit", range: { row, col: 1, rows, cols: 1 }, values: [], editedAt: new Date().toISOString() });
  const cell = async (a1: string) => ((await gw.read(a1))[0] ?? [])[0];
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba con Google real");
    await connectSheet(app.db, owner, studyId, fakeId, "bidirectional");
    const conn = (await lookupConnection(app.db, fakeId))!;
    const acts = async () => (await loadStudyData(app.db, owner, studyId)).acts;

    await check("Primitivas de Google: se escribe en RAW (una fórmula queda como texto) y se lee lo escrito", async () => {
      await real.write([{ range: `'${P}3_Actividades'!AA70:AC70`, values: [["=HYPERLINK(\"http://x\")", "+cmd", 12.5]] }]);
      const g = await api.spreadsheets.get({ spreadsheetId: id, ranges: [`'${P}3_Actividades'!AA70:AC70`], includeGridData: true, fields: "sheets.data.rowData.values.userEnteredValue" });
      const v = g.data.sheets?.find((s) => (s.data?.[0]?.rowData?.length ?? 0) > 0)?.data?.[0]?.rowData?.[0]?.values ?? [];
      if (v[0]?.userEnteredValue?.formulaValue || v[0]?.userEnteredValue?.stringValue !== "=HYPERLINK(\"http://x\")" || v[1]?.userEnteredValue?.formulaValue) throw new Error(`se interpretó como fórmula: ${JSON.stringify(v.slice(0, 2))}`);
      if ((await real.read(`'${P}3_Actividades'!AA70:AC70`))[0]?.[2] !== 12.5) throw new Error("lectura");
      await real.write([{ range: `'${P}3_Actividades'!AA70:AC70`, values: [["", "", ""]] }]);
    });

    await check("Escenario 1 · EDICIÓN en la hoja: una fila nueva se aplica, «dia» se corrige a «Día» y la hoja recibe id y versión en columnas ocultas", async () => {
      await gw.write([{ range: "'3_Actividades'!A7:T7", values: [["REAL", "L-1", "", "Cajas", "Sede Norte", "Cajero", "", "Arqueo", "", "", "", "", "", "", "Por evento", 4, "dia", "Por colaborador", "", 5]] }]);
      const r = await handleEvent(app.db, ev(7), gw);
      if (r.status !== "processed" || r.outcomes?.[0].result !== "created") throw new Error(JSON.stringify(r).slice(0, 200));
      const a = (await acts())[0];
      if (a.code !== "L-1" || a.timeAvgMin !== 5 || a.period !== "day") throw new Error(JSON.stringify(a));
      const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties.title,data.columnMetadata)", includeGridData: true, ranges: [`'${P}3_Actividades'!AZ1:BA1`] });
      const cols = meta.data.sheets?.find((s) => s.properties?.title === `${P}3_Actividades`)?.data?.[0]?.columnMetadata ?? [];
      if (cols.length !== 2 || !cols.every((c) => c.hiddenByUser)) throw new Error("las columnas internas no están ocultas");
      const link = (await gw.read("'3_Actividades'!AZ7:BA7"))[0] ?? [];
      if (!link[0] || link[1] !== 1) throw new Error(JSON.stringify(link));
    });

    await check("Escenario 4 · EVENTO REPETIDO: el mismo evento no se aplica dos veces", async () => {
      const e = ev(7);
      await gw.write([{ range: "'3_Actividades'!T7", values: [[6]] }]);
      if ((await handleEvent(app.db, e, gw)).status !== "processed") throw new Error("primer envío");
      await gw.write([{ range: "'3_Actividades'!T7", values: [[9]] }]); // cambio posterior que el reintento NO debe aplicar
      if ((await handleEvent(app.db, e, gw)).status !== "duplicate") throw new Error("no detectó el duplicado");
      if ((await acts())[0].timeAvgMin !== 6) throw new Error(`tiempo ${(await acts())[0].timeAvgMin}`);
    });

    await check("Escenario 2 · CAMBIO DESDE LA APP: la hoja recibe el valor nuevo y la versión (app → hoja)", async () => {
      const v = (await listActivityVersions(app.db, owner, studyId))[0];
      await updateActivityTime(app.db, owner, v.id, v.version, 11);
      const st = (await pushAll(app.db, conn, gw)).find((x) => x.sheet === "3_Actividades")!;
      if (st.refreshed !== 1) throw new Error(JSON.stringify(st));
      if (Number(await cell("'3_Actividades'!T7")) !== 11) throw new Error(`la hoja quedó en ${await cell("'3_Actividades'!T7")}`);
      if (Number(await cell("'3_Actividades'!BA7")) !== v.version + 1) throw new Error("versión en la hoja");
    });

    await check("Escenario 3 · CONFLICTO: una edición con la versión vieja no pisa a la app y la hoja recupera el valor vigente", async () => {
      const v = (await listActivityVersions(app.db, owner, studyId))[0];
      await updateActivityTime(app.db, owner, v.id, v.version, 20); // la app cambia primero y NO se empuja a la hoja
      await gw.write([{ range: "'3_Actividades'!T7", values: [[99]] }]); // la hoja edita con la versión anterior
      const r = await handleEvent(app.db, ev(7), gw);
      if (r.outcomes?.[0].result !== "conflict") throw new Error(String(r.outcomes?.[0].result));
      if ((await acts())[0].timeAvgMin !== 20) throw new Error("sobrescribió la app");
      if (Number(await cell("'3_Actividades'!T7")) !== 20) throw new Error(`la hoja quedó en ${await cell("'3_Actividades'!T7")}`);
    });

    await check("Escenario 5 · EVENTO PERDIDO: una edición sin evento se recupera con la reconciliación y repetirla no cambia nada", async () => {
      const cur = (await listActivityVersions(app.db, owner, studyId))[0];
      void cur;
      await gw.write([{ range: "'3_Actividades'!T7", values: [[13]] }]); // se edita la hoja y no llega ningún evento
      const first = await reconcile(app.db, conn, gw);
      const c3 = first.find((x) => x.sheet === "3_Actividades")!.counts;
      if (c3.updated !== 1) throw new Error(JSON.stringify(c3));
      if ((await acts())[0].timeAvgMin !== 13) throw new Error("no recuperó la edición");
      const second = (await reconcile(app.db, conn, gw)).find((x) => x.sheet === "3_Actividades")!.counts;
      if (second.updated + second.created !== 0) throw new Error(JSON.stringify(second));
    });

    await check("Escenario 6 · FÓRMULA INYECTADA: un nombre que empieza con «=» llega a la hoja como TEXTO, nunca como fórmula", async () => {
      const pos = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "Sede Norte", position: "Cajero", dataKind: "real", headcount: 1, weeklyHours: 42 });
      await addActivity(app.db, owner, studyId, { code: "APP-1", name: "=HYPERLINK(\"http://malo\")", positionId: pos, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 1, period: "week", unitsPerExecution: null, timeAvgMin: 3, planning: "planned" });
      const st = (await pushAll(app.db, conn, gw)).find((x) => x.sheet === "3_Actividades")!;
      if (st.appended !== 1 || st.formulaLike !== 1) throw new Error(JSON.stringify(st));
      const rows = await gw.read("'3_Actividades'!B7:B30");
      const r = rows.findIndex((x) => x[0] === "APP-1") + 7;
      const g = await api.spreadsheets.get({ spreadsheetId: id, ranges: [`'${P}3_Actividades'!H${r}`], includeGridData: true, fields: "sheets.data.rowData.values.userEnteredValue" });
      const v = g.data.sheets?.find((s) => (s.data?.[0]?.rowData?.length ?? 0) > 0)?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredValue;
      if (!v || v.formulaValue || v.stringValue !== "=HYPERLINK(\"http://malo\")") throw new Error(`se interpretó como fórmula: ${JSON.stringify(v)}`);
    });

    if (email) await check("Vista previa de SOLO LECTURA sobre su hoja real y su estudio real: lee todo y no cambia la estructura de la hoja", async () => {
      const u = (await admin.db.execute(sql`select id from auth.users where email = ${email}`)) as unknown as { id: string }[];
      const studies = await listStudies(app.db, u[0].id);
      const before = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,gridProperties.columnCount)" });
      const pv = await previewSync(app.db, { id: "preview", studyId: studies[0].id, actorId: u[0].id, spreadsheetId: id, mode: "bidirectional" }, real);
      const after = await api.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(title,gridProperties.columnCount)" });
      if (JSON.stringify(before.data.sheets) !== JSON.stringify(after.data.sheets)) throw new Error("la vista previa cambió la estructura de la hoja");
      for (const p of pv.pull) console.log(`   hoja → app · ${p.sheet}: ${Object.entries(p.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "sin filas"}`);
    });
  } finally {
    await api.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: tabIds.map((sheetId) => ({ deleteSheet: { sheetId } })) } });
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id = ${owner}`);
    await admin.client.end(); await app.client.end();
    console.log("Pestañas temporales y estudio de prueba eliminados.");
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
