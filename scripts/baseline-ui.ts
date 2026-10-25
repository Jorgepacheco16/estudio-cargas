/**
 * Línea base de resultados antes de reorganizar la interfaz (brief de reorganización, Paso 0).
 *   demo  → docs/evidence/baseline-ui/demo.json (ficticio, se versiona)
 *   real  → .baseline/real.json (datos reales, NO se versiona)
 * Compara con:  npx tsx --env-file=.env.local scripts/baseline-ui.ts check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import demo from "../src/data/demo.json";
import { analyze, type Mode } from "../src/domain/summary";
import { buildDashboard } from "../src/domain/dashboard";
import type { ActivityInput, Params, StaffingInput } from "../src/domain/engine";
import { calcValue, CALC_4A } from "../src/domain/calc4a";
import { loadDashboard } from "../src/server/dashboard-data";
import { ENTRY_IDS, type EntryId } from "../src/server/entry/defs";
import { listEntries } from "../src/server/entry/service";
import { AREAS_14 } from "../src/server/studies";

const TH = { high: 1, low: 0.5 };
const stable = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 1e9) / 1e9 : x)));
const calc4a = (acts: { code: string; dataKind: string; area: string; site: string; position: string }[], occ: (a: never) => number) =>
  acts.map((a) => ({ code: a.code, kind: a.dataKind, v: CALC_4A.map((c) => calcValue(a as never, c.key, occ(a as never))) }));

function demoBase() {
  const out: Record<string, unknown> = {};
  for (const mode of ["demo", "real", "all"] as Mode[]) {
    const a = analyze(demo.positions as StaffingInput[], demo.activities as ActivityInput[], demo.params as Params, TH, mode);
    const d = buildDashboard({ mode, analysis: a, params: demo.params as Params, thresholds: TH, areaNames: [...AREAS_14], assumptionsValidated: false, hourlyCost: null, meta: [], meas: [], suit: [], risks: [], opps: [], plans: [] });
    const occ = (x: { dataKind: string; area: string; site: string; position: string }) => a.positions.find((p) => p.dataKind === x.dataKind && p.area === x.area && p.site === x.site && p.position === x.position)?.occupants ?? 0;
    out[mode] = stable({ kpis: a.kpis, positions: a.positions, activities: a.activities, dashboard: d, calc4a: calc4a(a.activities as never, occ as never) });
  }
  return out;
}

async function realBase() {
  const admin = createDb(process.env.DATABASE_URL_MIGRATIONS!, 1), app = createDb(process.env.DATABASE_URL!, 2);
  try {
    const c = (await admin.db.execute(sql`select study_id, actor_id from public.sheet_connections limit 1`)) as unknown as { study_id: string; actor_id: string }[];
    const out: Record<string, unknown> = {};
    for (const mode of ["real", "demo", "all"] as Mode[]) {
      const d = await loadDashboard(app.db, c[0].actor_id, c[0].study_id, mode);
      const occ = (x: { dataKind: string; area: string; site: string; position: string }) => d.analysis.positions.find((p) => p.dataKind === x.dataKind && p.area === x.area && p.site === x.site && p.position === x.position)?.occupants ?? 0;
      out[mode] = stable({ kpis: d.analysis.kpis, positions: d.analysis.positions, activities: d.analysis.activities, dashboard: d.dashboard, calc4a: calc4a(d.analysis.activities as never, occ as never) });
    }
    const entries: Record<string, unknown> = {};
    for (const id of ENTRY_IDS as EntryId[]) entries[id] = stable((await listEntries(app.db, c[0].actor_id, c[0].study_id, id))!.rows.map((r) => ({ cells: r.cells, computed: r.computed })));
    out.entries = entries;
    return out;
  } finally { await admin.client.end(); await app.client.end(); }
}

async function main() {
  const cmd = process.argv[2] ?? "save";
  const [d, r] = [demoBase(), await realBase()];
  if (cmd === "save") {
    writeFileSync("docs/evidence/baseline-ui/demo.json", JSON.stringify(d, null, 1));
    writeFileSync(".baseline/real.json", JSON.stringify(r));
    console.log("Línea base guardada: demo (versionada) y real (local).");
    return;
  }
  const bad: string[] = [];
  if (JSON.stringify(stable(d)) !== JSON.stringify(JSON.parse(readFileSync("docs/evidence/baseline-ui/demo.json", "utf8")))) bad.push("demo");
  const was = JSON.parse(readFileSync(".baseline/real.json", "utf8")) as Record<string, unknown>;
  for (const k of Object.keys(was)) if (JSON.stringify(stable((r as Record<string, unknown>)[k])) !== JSON.stringify(was[k])) bad.push(`real.${k}`);
  console.log(bad.length ? `DIFERENCIAS en: ${bad.join(", ")}` : "Idéntico a la línea base (demo y real).");
  if (bad.length) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
