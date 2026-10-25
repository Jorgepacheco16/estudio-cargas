/**
 * Prueba de la validación de cobertura con el MODELO REAL y datos de demostración creados a propósito (un estudio temporal que se borra al terminar).
 * No usa datos reales. Uso: npx tsx --env-file=.env.local scripts/test-coverage-live.ts
 *  Perfil de 6 funciones: 3 cubiertas (una actividad abarca dos), 1 solo en parte, 1 sin actividad y 1 más cubierta. Se ejecuta 2 veces para ver la consistencia.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { saveEntry } from "../src/server/entry/service";
import { listCoverageCargos, validateCoverage } from "../src/server/coverage";

const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) out[d.fields.find((y) => y.field === f)!.col] = v;
  return out;
};

async function main() {
  const admin = createDb(process.env.DATABASE_URL_MIGRATIONS!, 1), app = createDb(process.env.DATABASE_URL!, 2);
  const owner = randomUUID();
  await admin.db.execute(sql`insert into auth.users (id) values (${owner})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Demostración de cobertura (temporal)");
    const funciones = [
      "1. Recibir la mercancía del proveedor y verificarla contra la orden de compra.",
      "2. Almacenar la mercancía en su ubicación y mantener el orden de la bodega.",
      "3. Realizar el inventario cíclico semanal y reportar las diferencias.",
      "4. Elaborar el informe mensual de indicadores de la bodega y presentarlo a la jefatura.",
      "5. Capacitar al personal nuevo en el uso del montacargas.",
      "6. Despachar los pedidos a las tiendas según la programación.",
    ].join("\n");
    const base = { kind: "REAL", area: "Recibo y almacenamiento - Operaciones", site: "Sede demo", position: "Auxiliar de bodega", calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "10" };
    const r0 = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: base.area, site: base.site, position: base.position, headcount: "2", weeklyHours: "42", functions: funciones }), {});
    if (!r0.ok) throw new Error(JSON.stringify(r0));
    const acts: [string, string, string][] = [
      ["B-1", "Recibir y verificar mercancía", "Descarga el camión, cuenta las unidades y las compara con la orden de compra; reporta faltantes."],
      ["B-2", "Ubicar y ordenar la bodega", "Lleva la mercancía a su ubicación y mantiene limpia y ordenada la bodega."],
      ["B-3", "Conteo de inventario semanal", "Cuenta los productos asignados cada semana y registra las diferencias encontradas."],
      ["B-4", "Alistar y despachar pedidos", "Alista los pedidos de las tiendas y los despacha en el horario programado."],
      ["B-5", "Elaborar informe mensual de indicadores", "Recopila los datos de recibo y despacho del mes. No incluye la presentación a la jefatura."],
    ];
    for (const [code, name, description] of acts) { const r = await saveEntry(app.db, owner, studyId, "3", cells("3", { ...base, code, name, description }), {}); if (!r.ok) throw new Error(JSON.stringify(r)); }
    const [cargo] = await listCoverageCargos(app.db, owner, studyId);
    for (let i = 1; i <= 2; i++) {
      const t0 = Date.now();
      const r = await validateCoverage(app.db, owner, studyId, cargo.id);
      console.log(`\n── Ejecución ${i} (${Math.round((Date.now() - t0) / 1000)} s)`);
      if (!r.ok) { console.log("ERROR:", r.code, r.message); continue; }
      console.log(r.result.summary, "·", r.result.level);
      for (const f of r.result.functions) console.log(`  [${f.status}] ${f.text.slice(0, 70)} ← ${f.activities.map((a) => a.code).join(",") || "—"} ${f.note ? "| " + f.note.slice(0, 110) : ""}`);
      console.log("  sin función:", r.result.unrelated.map((a) => a.code).join(",") || "ninguna");
    }
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id = ${owner}`);
    await admin.client.end(); await app.client.end();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
