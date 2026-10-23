/**
 * Compara el tablero de la aplicación (estudio ya importado) con los valores guardados en la hoja 11 del libro (oráculo).
 *   npx tsx scripts/verify-dashboard.ts --file <ruta.xlsx> --email <correo> [--study <id>]
 * Imprime solo conteos y diferencias; no vuelca datos del estudio.
 */
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { loadDashboard } from "../src/server/dashboard-data";
import { plain } from "../src/server/import/normalize";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

async function main() {
  const file = arg("file"), email = arg("email");
  if (!file || !email || !process.env.DATABASE_URL || !process.env.DATABASE_URL_MIGRATIONS) throw new Error("Uso: --file <xlsx> --email <correo>; requiere DATABASE_URL y DATABASE_URL_MIGRATIONS");
  const a = createDb(process.env.DATABASE_URL_MIGRATIONS, 1), b = createDb(process.env.DATABASE_URL, 2);
  try {
    const u = (await a.db.execute(sql`select id from auth.users where lower(email) = lower(${email}) limit 1`)) as unknown as { id: string }[];
    const st = (await a.db.execute(sql`select s.id from public.studies s join public.memberships m on m.study_id = s.id where m.user_id = ${u[0].id} order by s.created_at desc`)) as unknown as { id: string }[];
    const studyId = arg("study") ?? st[0].id;
    const { dashboard: d } = await loadDashboard(b.db, u[0].id, studyId, "real");

    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("11_Tablero")!;
    const cell = (c: string) => plain(ws.getCell(c).value);
    const num = (c: string) => { const v = cell(c); return typeof v === "number" ? v : 0; };
    const str = (c: string) => { const v = cell(c); return v === null || v === undefined ? "" : String(v); };

    let compared = 0; const diffs: string[] = [];
    const eqN = (c: string, mine: number | null, label: string) => { compared++; const x = num(c); const m = mine ?? 0; if (!close(m, x)) diffs.push(`${c} ${label}: app=${m} excel=${x}`); };
    const eqS = (c: string, mine: string, label: string) => { compared++; const x = str(c); if (mine !== x) diffs.push(`${c} ${label}: app='${mine.slice(0, 90)}' excel='${x.slice(0, 90)}'`); };
    const k = d.indicators;

    eqS("B8", k.areasWithInfo, "áreas con información"); eqN("D8", k.activities, "actividades"); eqN("F8", k.completePct, "% completas"); eqN("H8", k.hours, "horas");
    eqN("J8", k.capacity, "capacidad"); eqN("L8", k.capacityPct, "% capacidad");
    eqN("B12", k.overload, "cargos sobre capacidad"); eqN("D12", k.lowLoad, "cargos con carga baja"); eqN("F12", k.verifiablePct, "% fuente verificable");
    eqN("H12", k.opportunities, "oportunidades"); eqN("J12", k.recoverableHours, "tiempo recuperable"); eqN("L12", k.criticalNoBackup, "críticas sin respaldo");

    d.areas.forEach((r, i) => { const row = 17 + i; eqS(`B${row}`, r.area, "área"); eqN(`C${row}`, r.activities, "actividades"); eqN(`D${row}`, r.complete, "completas"); eqN(`E${row}`, r.hours, "horas"); eqN(`F${row}`, r.capacity, "capacidad"); eqN(`G${row}`, r.pct, "% capacidad"); eqS(`H${row}`, r.reading, "lectura"); });
    d.byValue.forEach((s, i) => { eqN(`C${52 + i}`, s.hours, s.label); eqN(`D${52 + i}`, s.pct, s.label + " %"); });
    d.byType.forEach((s, i) => { eqN(`H${52 + i}`, s.hours, s.label); eqN(`I${52 + i}`, s.pct, s.label + " %"); });
    d.byPotential.forEach((s, i) => { eqN(`M${52 + i}`, s.hours, "potencial " + s.label); eqN(`N${52 + i}`, s.pct, "potencial " + s.label + " %"); });
    for (let i = 0; i < 10; i++) {
      const t = d.top10[i], row = 63 + i;
      eqS(`C${row}`, t?.code ?? "", `top ${i + 1} código`); eqN(`G${row}`, t?.hours ?? null, `top ${i + 1} horas`); eqS(`B${row}`, t?.name ?? "", `top ${i + 1} actividad`);
    }
    // Cobertura (C77:C88) y oportunidades (C92:C97): el Excel guarda números y textos; se comparan como texto normalizado.
    const cov = ["C77", "C78", "C79", "C80", "C81", "C82", "C83", "C84", "C85", "C86", "C87", "C88"];
    d.coverage.forEach((c, i) => {
      const x = cell(cov[i]); compared++;
      const xs = typeof x === "number" ? (i === 0 || i === 4 ? `${Math.round(x * 100)}%` : String(x)) : x === null ? (i === 0 || i === 4 ? "0%" : "0") : String(x); // el libro no guarda resultado cuando la fórmula da 0
      if (c.value !== xs && !(c.value === "0" && xs === "")) diffs.push(`${cov[i]} ${c.label.slice(0, 40)}: app='${c.value}' excel='${xs}'`);
    });
    eqN("C92", Number(d.opportunities[0].value), "confirmados"); eqN("C93", Number(d.opportunities[1].value), "hipótesis"); eqN("C94", Number(d.opportunities[2].value), "pendientes");
    eqN("C97", Number(d.opportunities[5].value), "plazo vencido");
    // Conclusiones: B101:B110, mismas frases (las celdas vacías no generan texto)
    const excelConcl: string[] = []; for (let r = 101; r <= 110; r++) { const s = str(`B${r}`).trim(); if (s) excelConcl.push(s); }
    compared += Math.max(excelConcl.length, d.conclusions.length);
    const n = Math.max(excelConcl.length, d.conclusions.length);
    for (let i = 0; i < n; i++) if ((d.conclusions[i] ?? "") !== (excelConcl[i] ?? "")) diffs.push(`conclusión ${i + 1}: app='${(d.conclusions[i] ?? "").slice(0, 110)}' excel='${(excelConcl[i] ?? "").slice(0, 110)}'`);

    console.log(`Tablero vs hoja 11: ${compared} valores comparados · ${diffs.length} diferencias`);
    diffs.forEach((x) => console.log("  DIF", x));
    if (diffs.length) process.exitCode = 1;
  } finally { await a.client.end(); await b.client.end(); }
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
