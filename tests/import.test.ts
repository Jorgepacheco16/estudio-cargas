import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { Report, date, label, num, pct, bool } from "../src/server/import/normalize";
import { parseWorkbook } from "../src/server/import/parse";
import { importWorkbook } from "../src/server/import/load";
import { createStudy, loadStudyData } from "../src/server/studies";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

const L = { sheet: "t", row: 1, field: "f" };

/** Libro sintético (datos ficticios) con las hojas y columnas del Excel de referencia. */
async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const put = (sheet: string, row: number, cells: Record<string, string | number>) => { const ws = wb.getWorksheet(sheet) ?? wb.addWorksheet(sheet); for (const [c, v] of Object.entries(cells)) ws.getCell(`${c}${row}`).value = v; };
  for (const s of ["4a_Calculo_tiempos", "4b_Cargas", "5_Medibilidad", "6_Pertinencia", "7_Riesgos", "8_Oportunidades", "9_Rediseno", "10_Plan_accion"]) wb.addWorksheet(s);
  put("Parametros", 5, { C: 6 }); put("Parametros", 6, { C: 52 / 12 }); put("Parametros", 7, { C: 52 }); put("Parametros", 8, { C: 0.1 }); put("Parametros", 9, { C: 1 }); put("Parametros", 10, { C: 0.5 }); put("Parametros", 12, { C: "Base" });
  put("2_Caracterizacion", 7, { A: "DEMO", B: "Cajas", C: "Sede Uno", E: "Cajero (ficticio)", F: 4, K: 42, M: "Persona Ficticia", N: "entrevista con colaborador" });
  put("2_Caracterizacion", 8, { A: "DEMO", B: "Cajas", C: "Solo sede" });                       // sin cargo → rechazada
  put("3_Actividades", 7, { A: "DEMO", B: "X-001", D: "Cajas", E: "Sede Uno", F: "Cajero (ficticio)", H: "Arqueo", O: "Por evento", P: 1, Q: "Día", R: "Por colaborador", T: 10, AD: "Planificada" });
  put("3_Actividades", 8, { A: "DEMO", B: "X-002", D: "Cajas", E: "Sede Uno", F: "Cajero (ficticio)", H: "Sin tiempo", O: "Por evento", P: 1, Q: "Día", R: "Por colaborador" });
  put("3_Actividades", 9, { A: "DEMO", B: "x-001", D: "Cajas", E: "Sede Uno", F: "Cajero (ficticio)", H: "Duplicada", O: "Por evento" }); // código repetido
  put("3_Actividades", 10, { A: "DEMO", B: "X-003", D: "Cajas", E: "Sede Uno", F: "Cargo no registrado", H: "Cargo huérfano", O: "Por evento", P: 1, Q: "Día", R: "Total del cargo en la sede", T: 30, AB: 0.5, AC: "Cargo receptor", AD: "Planificada" });
  put("5_Medibilidad", 7, { B: "X-001", G: "Sí", H: "No" });
  put("5_Medibilidad", 8, { B: "X-999", G: "No" });                                              // actividad inexistente
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  await check("Normalización: coma decimal, número ambiguo, porcentaje, fecha serial, etiqueta con acento y Sí/No", () => {
    const r = new Report();
    if (num(r, L, "6,5") !== 6.5 || num(r, L, "1.234,5") !== 1234.5) throw new Error("coma decimal");
    if (num(r, L, "1.234") !== null || !r.issues.some((i) => i.rule === "AMBIGUOUS_NUMBER")) throw new Error("ambiguo debe informarse y no importarse");
    if (num(r, L, "") !== null || num(r, L, null) !== null) throw new Error("vacío debe ser NULL, nunca 0");
    if (pct(r, L, "10 %") !== 0.1 || pct(r, L, 0.25) !== 0.25) throw new Error("porcentaje");
    if (pct(r, L, 12) !== null || !r.issues.some((i) => i.rule === "PERCENT_OUT_OF_RANGE")) throw new Error("12 en columna de porcentaje debe informarse, no convertirse");
    if (date(r, L, 46310) !== "2026-10-15") throw new Error(`fecha serial: ${date(r, L, 46310)}`);
    if (label(r, L, "L_Periodo", "dia") !== "day" || !r.issues.some((i) => i.rule === "LABEL_AUTOFIXED")) throw new Error("etiqueta por acentos");
    if (label(r, L, "L_Periodo", "Bimestre") !== null || !r.issues.some((i) => i.rule === "NOT_IN_LIST")) throw new Error("fuera de lista");
    if (bool(r, L, "Sí") !== true || bool(r, L, "no") !== false || bool(r, L, "") !== null) throw new Error("Sí/No");
  });

  const buf = await workbook();
  const parsed = await parseWorkbook(buf);

  await check("Lectura: filas con clave por hoja y columnas calculadas ignoradas", () => {
    if (parsed.keyed["2_Caracterizacion"] !== 2 || parsed.keyed["3_Actividades"] !== 4 || parsed.keyed["5_Medibilidad"] !== 2) throw new Error(JSON.stringify(parsed.keyed));
    if (parsed.params?.workDaysPerWeek !== 6 || parsed.params?.scenario !== "base") throw new Error("parámetros");
  });

  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba de importación");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);

    await check("Un viewer no puede importar (42501) y no queda nada guardado", async () => {
      let code = "";
      try { await importWorkbook(app.db, viewer, studyId, await parseWorkbook(buf), { dryRun: false }); } catch (e) { code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? "?"; }
      if (code !== "42501") throw new Error(`código ${code}`);
      if ((await loadStudyData(app.db, owner, studyId)).acts.length !== 0) throw new Error("quedaron datos");
    });

    await check("Prueba en seco: ejecuta todo y revierte (no deja datos)", async () => {
      const r = await importWorkbook(app.db, owner, studyId, await parseWorkbook(buf), { dryRun: true });
      if (r.committed) throw new Error("confirmó en modo de prueba");
      if ((await loadStudyData(app.db, owner, studyId)).acts.length !== 0) throw new Error("la prueba en seco dejó datos");
    });

    let issues: string[] = [];
    await check("Importación: conteo cuadra, duplicados/huérfanos/faltantes se informan y se rechazan sin ocultarlos", async () => {
      const r = await importWorkbook(app.db, owner, studyId, await parseWorkbook(buf), { dryRun: false });
      if (!r.committed || !r.verification.countsOk) throw new Error(`committed=${r.committed} countsOk=${r.verification.countsOk}`);
      const c = r.counts;
      if (c["2_Caracterizacion"].inserted !== 1 || c["2_Caracterizacion"].rejected !== 1) throw new Error("hoja 2 " + JSON.stringify(c["2_Caracterizacion"]));
      if (c["3_Actividades"].inserted !== 3 || c["3_Actividades"].rejected !== 1) throw new Error("hoja 3 " + JSON.stringify(c["3_Actividades"]));
      if (c["5_Medibilidad"].rejected !== 1 || c["5_Medibilidad"].inserted !== 1) throw new Error("hoja 5 " + JSON.stringify(c["5_Medibilidad"]));
      issues = r.issues.map((i) => i.rule);
      for (const rule of ["MISSING_KEY", "DUPLICATE_CODE", "ORPHAN_REFERENCE", "POSITION_AUTO_CREATED"]) if (!issues.includes(rule)) throw new Error(`falta el hallazgo ${rule}`);
    });

    await check("Lo importado se calcula con las reglas del Excel; lo incompleto no suma y el cargo secundario aparece", async () => {
      const d = await loadStudyData(app.db, owner, studyId);
      const { analyze } = await import("../src/domain/summary");
      const a = analyze(d.staff, d.acts, d.params, d.thresholds, "demo");
      // X-001: 6 ejec/sem × 10/60 h × 4 ocupantes = 4 h; X-003: 6 × 0,5 h = 3 h (mitad al cargo receptor); X-002 incompleta.
      const area = a.areas.find((x) => x.area === "Cajas")!;
      if (Math.abs(area.hours - 7) > 1e-9 || area.activities !== 3 || area.complete !== 2) throw new Error(`área: ${JSON.stringify(area)}`);
      const rec = a.positions.find((x) => x.position === "Cargo receptor");
      if (!rec || Math.abs(rec.hours - 1.5) > 1e-9) throw new Error(`cargo receptor: ${JSON.stringify(rec)}`);
      if (a.activities.find((x) => x.code === "X-002")!.complete) throw new Error("X-002 debía quedar incompleta");
    });

    await check("Reimportar el mismo libro no duplica: todo se omite (D-11)", async () => {
      const r = await importWorkbook(app.db, owner, studyId, await parseWorkbook(buf), { dryRun: false });
      if (r.counts["3_Actividades"].inserted !== 0 || r.counts["3_Actividades"].skipped !== 3 || r.counts["2_Caracterizacion"].inserted !== 0) throw new Error(JSON.stringify(r.counts));
      if ((await loadStudyData(app.db, owner, studyId)).acts.length !== 3) throw new Error("se duplicaron actividades");
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
