import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { addActivity, addPosition, createStudy, listActivityVersions, loadStudyData, updateActivityTime } from "../src/server/studies";
import { connectSheet, handleEvent, lookupConnection, previewSync, pushAll, reconcile, syncNow } from "../src/server/sheets/sync";
import { ADAPTERS, cellsOf, sameValue, toCell } from "../src/server/sheets/adapters";
import { readRowFrom } from "../src/server/import/parse";
import { Report } from "../src/server/import/normalize";
import { activityFields } from "../src/server/import/rowmaps";
import { SYNCED_SHEETS, colToIndex, indexToCol } from "../src/domain/sheetmap";
import { looksLikeFormula } from "../src/domain/cellguard";
import { sheetChangeEvent, type SheetChangeEvent } from "../src/domain/contracts";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";
import { FakeSheet } from "./fakesheet";

/** Fase 8: sincronización hoja ↔ app contra PostgreSQL real (RLS, versiones, auditoría). Solo la API de Google es una hoja en memoria. */
const TABS = { Parametros: 8, "2_Caracterizacion": 24, "9_Rediseno": 31, "3_Actividades": 51, "5_Medibilidad": 26, "6_Pertinencia": 26, "7_Riesgos": 26, "8_Oportunidades": 29, "10_Plan_accion": 26 };
const mk = (sheet: string, row: number, rows = 1): SheetChangeEvent => ({ eventId: randomUUID(), spreadsheetId: SID, sheetName: sheet, kind: "edit", range: { row, col: 1, rows, cols: 1 }, values: [], editedAt: new Date().toISOString() });
const SID = `test-${randomUUID()}`;
const DATE46000 = new Date((46000 - 25569) * 86400000).toISOString().slice(0, 10);
const act = (o: Record<string, unknown> = {}) => ({ A: "REAL", B: "T-1", D: "Cajas", E: "Sede Norte", F: "Cajero", H: "Arqueo de caja", O: "Por evento", P: 4, Q: "Día", R: "Por colaborador", T: 5, ...o });

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "", sid2 = "";
  const sheet = new FakeSheet(TABS);
  try {
    await check("Contrato del evento de Apps Script y detección de texto con forma de fórmula", () => {
      if (!sheetChangeEvent.safeParse(mk("3_Actividades", 7)).success) throw new Error("rechazó un evento válido");
      if (sheetChangeEvent.safeParse({ ...mk("3_Actividades", 7), extra: 1 }).success) throw new Error("aceptó un campo desconocido");
      for (const f of ["=HYPERLINK(\"x\")", "+cmd|x", "@SUM(1)", "-2+3"]) if (!looksLikeFormula(f)) throw new Error(`no detectó ${f}`);
      for (const ok of ["-5", "+3,5", "12%", "hola", ""]) if (looksLikeFormula(ok)) throw new Error(`marcó ${ok}`);
    });

    studyId = await createStudy(app.db, owner, "Estudio sincronización");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    await connectSheet(app.db, owner, studyId, SID, "bidirectional");
    const conn = (await lookupConnection(app.db, SID))!;

    await check("La conexión se ubica por spreadsheetId sin sesión (función segura) y una hoja desconocida no se conecta", async () => {
      if (conn.studyId !== studyId || conn.actorId !== owner) throw new Error("conexión incorrecta");
      if (await lookupConnection(app.db, "no-existe-123456")) throw new Error("encontró una hoja inexistente");
    });

    await check("Hoja → app: fila nueva se crea, «dia» se corrige a «Día» con hallazgo, y la hoja recibe id y versión (columnas ocultas)", async () => {
      sheet.setRow("3_Actividades", 7, act({ Q: "dia" }));
      const r = await handleEvent(app.db, mk("3_Actividades", 7), sheet);
      if (r.status !== "processed" || r.outcomes?.[0].result !== "created") throw new Error(JSON.stringify(r));
      const d = await loadStudyData(app.db, owner, studyId);
      const a = d.acts.find((x) => x.code === "T-1");
      if (!a || a.period !== "day" || a.timeAvgMin !== 5 || a.area !== "Cajas") throw new Error(JSON.stringify(a));
      if ((sheet.hidden.get("3_Actividades") ?? 0) !== 2) throw new Error("no agregó las 2 columnas ocultas");
      const idCol = (await sheet.read("'3_Actividades'!A6:AZ6"))[0].indexOf("__app_id");
      if (idCol < 0 || !sheet.cell("3_Actividades", "AZ", 7)) throw new Error("no escribió el id en la hoja");
      const iss = await admin.db.execute(sql`select rule_code, status from public.validation_issues where study_id = ${studyId}`);
      if (!(iss as unknown as { rule_code: string }[]).some((x) => x.rule_code === "LABEL_AUTOFIXED")) throw new Error("falta el hallazgo del autocorrector");
    });

    await check("Un evento repetido (mismo eventId) no se aplica dos veces (idempotencia)", async () => {
      const e = mk("3_Actividades", 7);
      sheet.set("3_Actividades", "T", 7, 6);
      if ((await handleEvent(app.db, e, sheet)).status !== "processed") throw new Error("primer envío");
      const v1 = (await listActivityVersions(app.db, owner, studyId))[0].version;
      sheet.set("3_Actividades", "T", 7, 9); // un cambio posterior que el reintento NO debe aplicar
      if ((await handleEvent(app.db, e, sheet)).status !== "duplicate") throw new Error("no detectó el duplicado");
      if ((await listActivityVersions(app.db, owner, studyId))[0].version !== v1) throw new Error("reaplicó el evento");
      const d = await loadStudyData(app.db, owner, studyId);
      if (d.acts[0].timeAvgMin !== 6) throw new Error(`tiempo ${d.acts[0].timeAvgMin}`);
    });

    await check("Control de versión: con la versión vigente actualiza; con una versión vieja hay conflicto y la hoja recupera el valor de la app", async () => {
      sheet.set("3_Actividades", "T", 7, 8);
      const ok = await handleEvent(app.db, mk("3_Actividades", 7), sheet);
      if (ok.outcomes?.[0].result !== "unchanged" && ok.outcomes?.[0].result !== "updated") throw new Error(`result ${ok.outcomes?.[0].result}`);
      const v = (await listActivityVersions(app.db, owner, studyId))[0];
      await updateActivityTime(app.db, owner, v.id, v.version, 11); // la app cambia primero
      sheet.set("3_Actividades", "T", 7, 99); // la hoja edita con la versión vieja
      const r = await handleEvent(app.db, mk("3_Actividades", 7), sheet);
      if (r.outcomes?.[0].result !== "conflict") throw new Error(`esperaba conflicto: ${r.outcomes?.[0].result}`);
      if ((await loadStudyData(app.db, owner, studyId)).acts[0].timeAvgMin !== 11) throw new Error("sobrescribió la app");
      if (Number(sheet.cell("3_Actividades", "T", 7)) !== 11) throw new Error(`la hoja quedó en ${sheet.cell("3_Actividades", "T", 7)}`);
      const nv = Number(sheet.cell("3_Actividades", "BA", 7));
      if (nv !== (await listActivityVersions(app.db, owner, studyId))[0].version) throw new Error("la hoja no recibió la versión vigente");
    });

    await check("Un valor ilegible («abc») no borra el valor guardado y queda como hallazgo", async () => {
      sheet.set("3_Actividades", "T", 7, "abc");
      const r = await handleEvent(app.db, mk("3_Actividades", 7), sheet);
      if (r.outcomes?.[0].result === "rejected") throw new Error("rechazó la fila");
      if ((await loadStudyData(app.db, owner, studyId)).acts[0].timeAvgMin !== 11) throw new Error("borró el valor");
      const iss = await admin.db.execute(sql`select rule_code from public.validation_issues where study_id = ${studyId} and status = 'open'`);
      if (!(iss as unknown as { rule_code: string }[]).some((x) => x.rule_code === "NOT_A_NUMBER")) throw new Error("falta el hallazgo");
    });

    await check("Fila sin vincular: idéntica se vincula; distinta NO se sobrescribe y se reporta; código repetido en el lote se rechaza", async () => {
      sheet.setRow("3_Actividades", 8, act({ B: "T-1", T: 11 })); // mismo código que T-1, sin id
      sheet.setRow("3_Actividades", 9, act({ B: "T-2", T: 2 }));
      const same = await handleEvent(app.db, mk("3_Actividades", 8, 2), sheet);
      const res = Object.fromEntries((same.outcomes ?? []).map((o) => [o.row, o.result]));
      if (res[8] !== "conflict" && res[8] !== "linked" && res[8] !== "rejected") throw new Error(JSON.stringify(res));
      if (res[9] !== "created") throw new Error(`T-2: ${res[9]}`);
      // Duplicado dentro del mismo lote
      sheet.setRow("3_Actividades", 10, act({ B: "T-3" })); sheet.setRow("3_Actividades", 11, act({ B: "t-3 " }));
      const dup = await handleEvent(app.db, mk("3_Actividades", 10, 2), sheet);
      const r2 = Object.fromEntries((dup.outcomes ?? []).map((o) => [o.row, o.result]));
      if (r2[10] !== "created" || r2[11] !== "rejected") throw new Error(JSON.stringify(r2));
      const n = (await loadStudyData(app.db, owner, studyId)).acts.filter((a) => a.code.toLowerCase().startsWith("t-")).length;
      if (n !== 3) throw new Error(`actividades ${n}`);
    });

    await check("Área inexistente: la fila se rechaza (la hoja no crea listas) y nada queda a medias", async () => {
      sheet.setRow("3_Actividades", 12, act({ B: "T-9", D: "Área inventada" }));
      const r = await handleEvent(app.db, mk("3_Actividades", 12), sheet);
      if (r.outcomes?.[0].result !== "rejected") throw new Error(String(r.outcomes?.[0].result));
      if ((await loadStudyData(app.db, owner, studyId)).acts.some((a) => a.code === "T-9")) throw new Error("creó la actividad");
    });

    await check("Hojas 5, 6, 7, 8 y 10: se crean desde la hoja; una evaluación de actividad inexistente se rechaza", async () => {
      sheet.setRow("5_Medibilidad", 7, { B: "T-1", G: "Sí", H: "Sí", K: "Alta", M: "Sí" });
      sheet.setRow("5_Medibilidad", 8, { B: "NO-EXISTE", G: "Sí" });
      sheet.setRow("6_Pertinencia", 7, { B: "T-1", F: "Alta", T: "1. Corresponde al cargo, requiere capacitación" });
      sheet.setRow("7_Riesgos", 7, { B: "T-1", H: 3, K: 5, M: 3, Q: 2 });
      sheet.setRow("8_Oportunidades", 7, { A: "REAL", B: "OP-1", C: "Simplificar procedimiento", D: "Hallazgo confirmado", F: "T-1", J: "Cajas", M: 2, Q: 4 });
      sheet.setRow("10_Plan_accion", 7, { A: "REAL", B: "AC-1", D: "Simplificar el arqueo", E: "Cajas", K: 46000, L: 46030, P: 10 });
      const out: Record<string, string> = {};
      for (const [name, rows] of [["5_Medibilidad", 2], ["6_Pertinencia", 1], ["7_Riesgos", 1], ["8_Oportunidades", 1], ["10_Plan_accion", 1]] as const) {
        const r = await handleEvent(app.db, mk(name, 7, rows), sheet);
        out[name] = (r.outcomes ?? []).map((o) => o.result).join(",");
      }
      const want = { "5_Medibilidad": "created,rejected", "6_Pertinencia": "created", "7_Riesgos": "created", "8_Oportunidades": "created", "10_Plan_accion": "created" };
      if (JSON.stringify(out) !== JSON.stringify(want)) throw new Error(JSON.stringify(out));
      const n = await admin.db.execute(sql`select (select count(*) from public.measurability_assessments where study_id=${studyId})::int m, (select count(*) from public.improvement_opportunities where study_id=${studyId})::int o, (select count(*) from public.action_items where study_id=${studyId} and start_date = ${DATE46000})::int a`);
      const x = (n as unknown as { m: number; o: number; a: number }[])[0];
      if (x.m !== 1 || x.o !== 1 || x.a !== 1) throw new Error(JSON.stringify(x));
    });

    await check("Auditoría: cada cambio aplicado desde la hoja queda con origen «sheet»", async () => {
      const r = await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and origin = 'sheet'`);
      if ((r as unknown as { n: number }[])[0].n < 6) throw new Error("faltan registros de auditoría");
    });

    await check("Ida y vuelta: app → celdas → fila normalizada → columnas de la base devuelve lo mismo (sin pérdidas)", async () => {
      const a = ADAPTERS[0];
      const d = await admin.db.execute(sql`select * from public.activities where study_id = ${studyId} and code = 'T-1'`);
      const rec = (d as unknown as Record<string, unknown>[])[0];
      const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const row0 = Object.fromEntries(Object.entries(rec).map(([k, v]) => [camel(k), v]));
      const cells = cellsOf(a, row0, { kind: "real", code: "T-1", area: "Cajas", site: "Sede Norte", position: "Cajero", secondaryPosition: null });
      const row = readRowFrom((col) => cells[col] ?? null, "3_Actividades", 7, a.spec, new Report());
      const back = activityFields(row);
      for (const [db] of Object.entries(a.map)) if (!sameValue(back[db], row0[db])) throw new Error(`${db}: ${String(back[db])} ≠ ${String(row0[db])}`);
    });

    await check("Valores a celdas: etiquetas en español, Sí/No, fechas como número de serie y porcentajes como fracción", () => {
      const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${String(a)} ≠ ${String(b)}`); };
      eq(toCell({ label: "L_Periodo" }, "day"), "Día"); eq(toCell("bool", true), "Sí"); eq(toCell("bool", false), "No");
      eq(toCell("date", "2026-12-02"), 46358); eq(toCell("pct", "0.0500"), 0.05); eq(toCell("text", null), "");
      eq(toCell({ label: "L_Autonomia" }, "low"), "Bajo"); eq(toCell({ label: "L_AMB" }, "low"), "Baja");
    });

    await check("App → hoja: lo que solo existe en la app se agrega con id y versión; las fórmulas de la hoja no se tocan; texto con forma de fórmula va como texto", async () => {
      const pos = await addPosition(app.db, owner, studyId, { area: "Cajas", site: "Sede Norte", position: "Cajero", dataKind: "real", headcount: 2, weeklyHours: 42 });
      await addActivity(app.db, owner, studyId, { code: "APP-1", name: "=HYPERLINK(\"http://x\")", positionId: pos, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 1, period: "week", unitsPerExecution: null, timeAvgMin: 3, planning: "planned" });
      sheet.set("3_Actividades", "C", 20, "=FORMULA_DEL_USUARIO"); // columna calculada de la hoja
      const before = sheet.writes;
      const st = await pushAll(app.db, conn, sheet);
      const s3 = st.find((x) => x.sheet === "3_Actividades")!;
      if (s3.appended !== 1 || s3.formulaLike !== 1) throw new Error(JSON.stringify(s3));
      if (sheet.writes === before) throw new Error("no escribió");
      const rows = await sheet.read("'3_Actividades'!B7:B30");
      const r = rows.findIndex((x) => x[0] === "APP-1") + 7;
      if (r < 7 || sheet.cell("3_Actividades", "H", r) !== "=HYPERLINK(\"http://x\")") throw new Error("no quedó como texto");
      if (!sheet.cell("3_Actividades", "AZ", r)) throw new Error("sin id");
      if (sheet.cell("3_Actividades", "C", 20) !== "=FORMULA_DEL_USUARIO") throw new Error("tocó una columna calculada");
      const again = (await pushAll(app.db, conn, sheet)).find((x) => x.sheet === "3_Actividades")!;
      if (again.appended !== 0) throw new Error("duplicó filas al repetir");
    });

    await check("Espejo completo (D-62): la hoja 2 recibe la dotación, «Parametros» recibe supuestos y áreas, las fórmulas no se tocan y las casillas de entrada quedan protegidas", async () => {
      sheet.set("2_Caracterizacion", "R", 7, "=FORMULA_CAPACIDAD"); sheet.set("Parametros", "C", 6, "=52/12");
      await pushAll(app.db, conn, sheet);
      const g = (c: string, r: number) => sheet.cell("2_Caracterizacion", c, r);
      if (g("B", 7) !== "Cajas" || g("C", 7) !== "Sede Norte" || g("E", 7) !== "Cajero" || g("F", 7) !== 2 || g("K", 7) !== 42) throw new Error(JSON.stringify([g("B", 7), g("C", 7), g("E", 7), g("F", 7), g("K", 7)]));
      if (!g("Y", 7)) throw new Error("la fila de la hoja 2 no quedó vinculada a la app");
      if (g("R", 7) !== "=FORMULA_CAPACIDAD" || sheet.cell("Parametros", "C", 6) !== "=52/12") throw new Error("se escribió sobre una fórmula");
      if (sheet.cell("Parametros", "C", 5) !== 6 || !(await sheet.read("'Parametros'!E5:E40")).some((r) => r[0] === "Cajas")) throw new Error(`parámetros: ${sheet.cell("Parametros", "C", 5)}`);
      const prot = sheet.protections.get("2_Caracterizacion") ?? [];
      if (!prot.length || prot.some((r) => /^(P|Q|R|S|T|U|V)\d/.test(r))) throw new Error(`protección: ${JSON.stringify(prot)}`);
    });
    await check("Turnos y descripción de la operación (D-67, D-69) → hojas 2 y 3 de Google: columnas nuevas al final con su encabezado, valores por cargo y por actividad, sin repetir escrituras, con refresco al cambiar y sin tocar filas de otra persona", async () => {
      const { saveShift, setActivityShifts, deleteShift, listShifts } = await import("../src/server/shifts");
      const { saveOperation } = await import("../src/server/operation");
      const { mirrorExtras, EXTRA_HEADERS } = await import("../src/server/sheets/extras");
      const { adapterById } = await import("../src/server/sheets/adapters");
      const [{ id: positionId }] = (await admin.db.execute(sql`select id from public.positions where study_id = ${studyId} and name = 'Cajero' limit 1`)) as unknown as { id: string }[];
      const [{ id: actId }] = (await admin.db.execute(sql`select id from public.activities where study_id = ${studyId} and code = 'APP-1'`)) as unknown as { id: string }[];
      const every = ["0", "1", "2", "3", "4", "5", "6"];
      for (const t of [{ name: "Apertura", start: "05:30", end: "13:00", breakMin: "30", days: every }, { name: "Cierre", start: "13:00", end: "20:30", breakMin: "30", days: ["0", "1", "2", "3", "4", "5"] }]) {
        const r = await saveShift(app.db, owner, studyId, positionId, undefined, t); if (!r.ok) throw new Error(JSON.stringify(r));
      }
      const shifts = await listShifts(app.db, owner, studyId, positionId);
      await setActivityShifts(app.db, owner, studyId, actId, { all: false, ids: [shifts.find((s) => s.name === "Apertura")!.id] });
      await saveOperation(app.db, owner, studyId, positionId, "Apertura con 5 cajas y cierre con 6; el resto según el pronóstico.");
      await pushAll(app.db, conn, sheet);
      const colOf = async (tab: string, header: string) => { const h = (await sheet.read(`'${tab}'!A6:BF6`))[0] as unknown[]; const i = h.indexOf(header); if (i < 0) throw new Error(`falta la columna «${header}» en ${tab}`); return indexToCol(i + 1); };
      const [cTurnos, cOper, cAct] = [await colOf("2_Caracterizacion", EXTRA_HEADERS.shifts), await colOf("2_Caracterizacion", EXTRA_HEADERS.operation), await colOf("3_Actividades", EXTRA_HEADERS.activityShifts)];
      if (colToIndex(cTurnos) <= 22 || colToIndex(cAct) <= 51) throw new Error("las columnas nuevas deben ir después de las del libro");
      const t7 = String(sheet.cell("2_Caracterizacion", cTurnos, 7));
      if (!t7.includes("Apertura · 05:30–13:00 · receso 30 min · 7 h netas") || !t7.includes("Cierre · L–S · 13:00–20:30")) throw new Error(t7);
      if (sheet.cell("2_Caracterizacion", cOper, 7) !== "Apertura con 5 cajas y cierre con 6; el resto según el pronóstico.") throw new Error("descripción de la operación");
      const r3 = ((await sheet.read("'3_Actividades'!B7:B40")).findIndex((x) => x[0] === "APP-1")) + 7;
      if (sheet.cell("3_Actividades", cAct, r3) !== "Apertura") throw new Error(String(sheet.cell("3_Actividades", cAct, r3)));
      // sin cambios no se escribe nada
      const [a2, a3] = [adapterById("2")!, adapterById("3")!];
      if ((await mirrorExtras(app.db, conn, sheet, a2)) !== 0 || (await mirrorExtras(app.db, conn, sheet, a3)) !== 0) throw new Error("repitió escrituras sin cambios");
      // una fila de otra persona (datos sin vínculo) conserva lo que tenga en las columnas nuevas
      sheet.set("2_Caracterizacion", "B", 150, "Cajas"); sheet.set("2_Caracterizacion", cTurnos, 150, "nota de otra persona");
      await mirrorExtras(app.db, conn, sheet, a2);
      if (sheet.cell("2_Caracterizacion", cTurnos, 150) !== "nota de otra persona") throw new Error("pisó una fila sin vínculo");
      sheet.set("2_Caracterizacion", "B", 150, null); sheet.set("2_Caracterizacion", cTurnos, 150, null);
      // al eliminar un turno en uso y vaciar la operación, la hoja se refresca
      await deleteShift(app.db, owner, studyId, shifts.find((s) => s.name === "Apertura")!.id, true);
      await saveOperation(app.db, owner, studyId, positionId, "");
      if ((await mirrorExtras(app.db, conn, sheet, a2)) === 0 || (await mirrorExtras(app.db, conn, sheet, a3)) === 0) throw new Error("no refrescó");
      const after = String(sheet.cell("2_Caracterizacion", cTurnos, 7));
      if (after.includes("Apertura") || !after.includes("Cierre") || sheet.cell("2_Caracterizacion", cOper, 7) !== "" || sheet.cell("3_Actividades", cAct, r3) !== "") throw new Error(JSON.stringify([after, sheet.cell("2_Caracterizacion", cOper, 7), sheet.cell("3_Actividades", cAct, r3)]));
      // vista previa: no escribe (ni agrega columnas)
      const w = sheet.writes; await mirrorExtras(app.db, conn, sheet, a2, true); if (sheet.writes !== w) throw new Error("la vista previa escribió");
    });

    await check("Centro de operaciones (D-75) → hojas 8, 9 y 10 de Google: columna adicional con su encabezado y el centro de cada registro", async () => {
      const { saveEntry } = await import("../src/server/entry/service");
      const { entryDef } = await import("../src/server/entry/defs");
      const { mirrorExtras, EXTRA_HEADERS } = await import("../src/server/sheets/extras");
      const { adapterById } = await import("../src/server/sheets/adapters");
      const d = entryDef("8")!;
      const cellsOf8 = (by: Record<string, string>) => Object.fromEntries(Object.entries(by).map(([f, v]) => [d.fields.find((x) => x.field === f)!.col, v]));
      const r = await saveEntry(app.db, owner, studyId, "8", cellsOf8({ code: "O-CO", area: "Cajas", position: "Cajero", site: "Sede Norte" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      await pushAll(app.db, conn, sheet);
      const h = (await sheet.read("'8_Oportunidades'!A6:BF6"))[0] as unknown[];
      const i = h.indexOf(EXTRA_HEADERS.site); if (i < 0) throw new Error("falta la columna Centro de operaciones en la hoja 8");
      const row = (await sheet.read("'8_Oportunidades'!B7:B60")).findIndex((x) => x[0] === "O-CO") + 7;
      if (row < 7 || sheet.cell("8_Oportunidades", indexToCol(i + 1), row) !== "Sede Norte") throw new Error(String(sheet.cell("8_Oportunidades", indexToCol(i + 1), row)));
      if ((await mirrorExtras(app.db, conn, sheet, adapterById("8")!)) !== 0) throw new Error("repitió escrituras sin cambios");
      for (const t of ["9_Rediseno", "10_Plan_accion"]) { const hh = (await sheet.read(`'${t}'!A6:BF6`))[0] as unknown[]; if (!hh.includes(EXTRA_HEADERS.site)) throw new Error(`falta la columna en ${t}`); }
    });

    await check("Cerrar huecos: tras eliminar una actividad el espejo deja la fila vacía y compactSheet sube las demás, sin tocar las fórmulas de la hoja (y no pisa filas sin vincular)", async () => {
      const { compactSheet } = await import("../src/server/sheets/mirror");
      const { adapterById } = await import("../src/server/sheets/adapters");
      const g = new FakeSheet(TABS);                           // hoja limpia: solo registros de la app
      const [{ id: positionId }] = (await admin.db.execute(sql`select id from public.positions where study_id = ${studyId} limit 1`)) as unknown as { id: string }[];
      for (const code of ["ZGAP-1", "ZGAP-2"]) await addActivity(app.db, owner, studyId, { code, name: `Temporal ${code}`, positionId, dataKind: "real", calcMode: "per_event", scope: "per_employee", executions: 1, period: "week", unitsPerExecution: null, timeAvgMin: 3, planning: "planned" });
      try {
        await pushAll(app.db, conn, g);
        g.set("3_Actividades", "C", 8, "=FORMULA_C8");
        await admin.db.execute(sql`delete from public.activities where study_id = ${studyId} and code = 'ZGAP-1'`);
        await pushAll(app.db, conn, g);                        // la fila de ZGAP-1 queda vacía entre dos registros
        const col = async () => (await g.read("'3_Actividades'!B7:B80")).map((r) => String(r[0] ?? ""));
        if (!(await col()).some((c, i, all) => c === "" && all.slice(i + 1).some((x) => x !== ""))) throw new Error("no se generó el hueco que se quería cerrar");
        const r = await compactSheet(app.db, conn, g, adapterById("3")!);
        const after = await col(); const n = after.filter(Boolean).length;
        if (r.gapsBefore < 1 || after.slice(0, n).some((c) => c === "") || after.slice(n).some((c) => c !== "")) throw new Error(`sigue habiendo huecos: ${JSON.stringify(after.slice(0, n + 2))}`);
        if (g.cell("3_Actividades", "C", 8) !== "=FORMULA_C8") throw new Error("se tocó una fórmula");
        const again = await compactSheet(app.db, conn, g, adapterById("3")!);
        if (again.moved !== 0 || again.cleared !== 0) throw new Error("la compactación no es idempotente");
        g.setRow("3_Actividades", n + 7 + 3, { B: "AJENA-1", H: "Fila que no es de la app" });   // una fila ajena: NO se debe pisar
        let refused = false; try { await compactSheet(app.db, conn, g, adapterById("3")!); } catch { refused = true; }
        if (!refused) throw new Error("debía negarse a compactar con una fila sin vincular");
      } finally { await admin.db.execute(sql`delete from public.activities where study_id = ${studyId} and code in ('ZGAP-1', 'ZGAP-2')`); }
    });
    await check("Reconciliación: recupera una edición cuyo evento se perdió y no duplica nada al repetirse", async () => {
      const rows = await sheet.read("'3_Actividades'!B7:B30");
      const r = rows.findIndex((x) => x[0] === "T-2") + 7;
      sheet.set("3_Actividades", "T", r, 3); // edición sin evento
      const first = await reconcile(app.db, conn, sheet);
      const c3 = first.find((x) => x.sheet === "3_Actividades")!.counts;
      if (c3.updated < 1) throw new Error(JSON.stringify(c3));
      if ((await loadStudyData(app.db, owner, studyId)).acts.find((a) => a.code === "T-2")?.timeAvgMin !== 3) throw new Error("no recuperó la edición");
      const second = await reconcile(app.db, conn, sheet);
      const c3b = second.find((x) => x.sheet === "3_Actividades")!.counts;
      if (c3b.updated + c3b.created !== 0) throw new Error(`la segunda pasada cambió datos: ${JSON.stringify(c3b)}`);
      const sn = await syncNow(app.db, conn, sheet);
      if (sn.pull.length !== ADAPTERS.length || sn.push.length !== SYNCED_SHEETS.length + 1) throw new Error(`syncNow incompleto: pull ${sn.pull.length}, push ${sn.push.length}`);
    });

    await check("Vista previa: cuenta lo que pasaría sin escribir nada en la hoja ni en la base", async () => {
      sheet.setRow("3_Actividades", 15, act({ B: "PREV-1", T: 1 })); // fila nueva que NO debe crearse
      const [w0, n0] = [sheet.writes, (await loadStudyData(app.db, owner, studyId)).acts.length];
      const pv = await previewSync(app.db, conn, sheet);
      const c3 = pv.pull.find((x) => x.sheet === "3_Actividades")!.counts;
      if (c3.created !== 1) throw new Error(`esperaba 1 fila nueva en la vista previa: ${JSON.stringify(c3)}`);
      if (sheet.writes !== w0) throw new Error("la vista previa escribió en la hoja");
      if ((await loadStudyData(app.db, owner, studyId)).acts.length !== n0) throw new Error("la vista previa escribió en la base");
      sheet.set("3_Actividades", "B", 15, null);
    });

    await check("Tope de 50 correcciones automáticas por lote: sin confirmación no se aplica nada (evento y sincronización); con confirmación sí", async () => {
      const big = new FakeSheet(TABS);
      for (let i = 0; i < 60; i++) big.setRow("3_Actividades", 40 + i, act({ B: `BIG-${i}`, Q: "dia" })); // 60 correcciones «dia» → «Día»
      const before = (await loadStudyData(app.db, owner, studyId)).acts.length;
      const ev = await handleEvent(app.db, mk("3_Actividades", 40, 60), big);
      if (ev.status !== "error" || !String(ev.message).includes("confirmación")) throw new Error(`evento: ${JSON.stringify(ev).slice(0, 160)}`);
      let blocked = false;
      try { await reconcile(app.db, conn, big); } catch (e) { blocked = (e as Error).name !== "Error" || String((e as Error).message).includes("confirmación"); }
      if (!blocked) throw new Error("la reconciliación aplicó más de 50 correcciones sin confirmar");
      if ((await loadStudyData(app.db, owner, studyId)).acts.length !== before) throw new Error("se aplicó algo sin confirmación");
      const pv = await previewSync(app.db, conn, big);
      if (pv.pull.find((x) => x.sheet === "3_Actividades")!.autofixes !== 60) throw new Error("la vista previa no cuenta las correcciones");
      await reconcile(app.db, conn, big, false, true);
      if ((await loadStudyData(app.db, owner, studyId)).acts.length !== before + 60) throw new Error("con confirmación debían crearse las 60");
    });

    await check("RLS: una conexión cuyo actor es de solo lectura no puede escribir; el evento falla sin dejar datos", async () => {
      const sid = `test-${randomUUID()}`; sid2 = sid;
      await admin.db.execute(sql`insert into public.sheet_connections (study_id, spreadsheet_id, actor_id, mode) values (${studyId}, ${sid}, ${viewer}, 'bidirectional')`);
      const sh2 = new FakeSheet(TABS);
      sh2.setRow("3_Actividades", 7, act({ B: "V-1" }));
      const r = await handleEvent(app.db, { ...mk("3_Actividades", 7), spreadsheetId: sid }, sh2);
      if (r.status !== "error") throw new Error(`estado ${r.status}`);
      if ((await loadStudyData(app.db, owner, studyId)).acts.some((a) => a.code === "V-1")) throw new Error("el viewer escribió");
    });

    await check("Modo «solo app → hoja»: los eventos de la hoja se ignoran", async () => {
      await connectSheet(app.db, owner, studyId, SID, "push");
      sheet.setRow("3_Actividades", 14, act({ B: "P-1" }));
      const r = await handleEvent(app.db, mk("3_Actividades", 14), sheet);
      if (r.status !== "ignored") throw new Error(r.status);
      if ((await loadStudyData(app.db, owner, studyId)).acts.some((a) => a.code === "P-1")) throw new Error("aplicó un evento en modo push");
      await connectSheet(app.db, owner, studyId, SID, "bidirectional");
    });

    await check("Los índices de columnas son consistentes (A=1, Z=26, AA=27, AY=51)", () => {
      if (colToIndex("A") !== 1 || colToIndex("Z") !== 26 || colToIndex("AA") !== 27 || colToIndex("AY") !== 51) throw new Error("índices");
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    void sid2;
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
