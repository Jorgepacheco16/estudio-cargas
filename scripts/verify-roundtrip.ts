/**
 * Ida y vuelta de la importación (brief §10.7): compara CAMPO A CAMPO lo que dice el libro de Excel con lo que quedó guardado en la base,
 * para las hojas 3, 5, 6, 7, 8 y 10. Imprime solo conteos (nunca datos). Uso:
 *   tsx --env-file=.env.local scripts/verify-roundtrip.ts <libro.xlsx> <correo del propietario del estudio>
 */
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { listStudies } from "../src/server/studies";
import { parseWorkbook, type Row } from "../src/server/import/parse";
import { ACTIVITY_MAP, MEAS_MAP, OPP_MAP, PLAN_MAP, RISK_MAP, SUIT_MAP, forward, type FieldMap } from "../src/server/import/rowmaps";
import { ADAPTERS, sameValue } from "../src/server/sheets/adapters";
import { key } from "../src/server/import/normalize";

async function main() {
  const [file, email] = process.argv.slice(2);
  if (!file || !email) throw new Error("Uso: tsx scripts/verify-roundtrip.ts <libro.xlsx> <correo>");
  const parsed = await parseWorkbook(file);
  const admin = createDb(process.env.DATABASE_URL_MIGRATIONS!, 1), app = createDb(process.env.DATABASE_URL!, 2);
  try {
    const u = (await admin.db.execute(sql`select id from auth.users where email = ${email}`)) as unknown as { id: string }[];
    const study = (await listStudies(app.db, u[0].id))[0];
    const sheets: { name: string; rows: Row[]; map: FieldMap; target: string; extra?: (r: Row, rec: Record<string, unknown>) => [string, unknown, unknown][] }[] = [
      { name: "3_Actividades", rows: parsed.activities, map: ACTIVITY_MAP, target: "activities" },
      { name: "5_Medibilidad", rows: parsed.meas, map: MEAS_MAP, target: "5" },
      { name: "6_Pertinencia", rows: parsed.suit, map: SUIT_MAP, target: "6" },
      { name: "7_Riesgos", rows: parsed.risk, map: RISK_MAP, target: "7" },
      { name: "8_Oportunidades", rows: parsed.opp, map: OPP_MAP, target: "8" },
      { name: "10_Plan_accion", rows: parsed.plan, map: PLAN_MAP, target: "10", extra: (r, rec) => [["startDate", r.s("start"), rec.startDate], ["endDate", r.s("end"), rec.endDate]] },
    ];
    let rowsCmp = 0, fieldsCmp = 0, diffs = 0, absent = 0;
    const lines: string[] = [];
    for (const sh of sheets) {
      const adapter = ADAPTERS.find((a) => a.sheet.target === sh.target)!;
      const app_ = new Map((await withRls(app.db, { sub: u[0].id }, (tx) => adapter.all(tx, study.id))).map((x) => [key(x.code), x.rec]));
      let n = 0, f = 0, d = 0, miss = 0;
      for (const r of sh.rows) {
        const code = r.s("code"); if (!code) continue;
        const rec = app_.get(key(code));
        if (!rec) { miss++; continue; }
        n++;
        const want = forward(sh.map, r);
        for (const [db, v] of Object.entries(want)) { f++; if (!sameValue(v, (rec as Record<string, unknown>)[db])) { d++; lines.push(`   ↳ diferencia en ${sh.name}, fila ${r.row} del libro, campo «${db}» (tipo excel ${v === null ? "vacío" : typeof v}, tipo base ${(rec as Record<string, unknown>)[db] === null ? "vacío" : typeof (rec as Record<string, unknown>)[db]})`); } }
        for (const [, a, b] of sh.extra?.(r, rec) ?? []) { f++; if (!sameValue(a, b)) d++; }
      }
      rowsCmp += n; fieldsCmp += f; diffs += d; absent += miss;
      lines.push(`${sh.name.padEnd(18)} filas en el libro ${String(sh.rows.length).padStart(3)} · comparadas ${String(n).padStart(3)} · campos ${String(f).padStart(5)} · diferencias ${d} · no importadas (rechazadas y reportadas) ${miss}`);
    }
    console.log(lines.join("\n"));
    console.log(`\nTOTAL: ${rowsCmp} filas, ${fieldsCmp} campos comparados, ${diffs} diferencias, ${absent} filas no importadas (ver informe de importación).`);
    process.exit(diffs ? 1 : 0);
  } finally { await admin.client.end(); await app.client.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
