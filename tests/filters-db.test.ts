import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { listEntries, saveEntry } from "../src/server/entry/service";
import { entryFilters } from "../src/server/entry/filters";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-74 — filtros de las listas de registros con PostgreSQL real: centro de operaciones, área y cargo en las 8 secciones (en medibilidad, pertinencia y
 * riesgos salen de la actividad que citan) y los filtros propios aprobados: captura (actividades), nivel (medibilidad), criticidad (riesgos), tipo
 * (oportunidades) y estado, prioridad, iniciativa, alerta y vencimiento (plan de acción). No deja datos.
 */
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID();
  await admin.db.execute(sql`insert into auth.users (id) values (${owner})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba filtros");
    const save = async (id: EntryId, by: Record<string, string>) => { const r = await saveEntry(app.db, owner, studyId, id, cells(id, by), {}); if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.errors)}`); };
    const ok = { calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador" };
    for (const [area, site, position] of [["Cajas", "CO Prado", "Cajero"], ["Cajas", "CO Norte", "Fiscal"], ["Domicilios", "CO Norte", "Auxiliar"]]) await save("2", { area, site, position, headcount: "2", weeklyHours: "42" });
    await save("3", { kind: "REAL", code: "A-1", area: "Cajas", site: "CO Prado", position: "Cajero", name: "Arqueo", ...ok, timeAvg: "5" });          // completa
    await save("3", { kind: "REAL", code: "A-2", area: "Cajas", site: "CO Norte", position: "Fiscal", name: "Apertura", ...ok });                       // falta el tiempo → incompleta
    await save("3", { kind: "REAL", code: "A-3", area: "Domicilios", site: "CO Norte", position: "Auxiliar", name: "Entrega", ...ok, timeAvg: "10" });
    await save("5", { code: "A-1", direct: "Sí", hasIndicators: "Sí" });
    await save("6", { code: "A-2", situation: "1. Corresponde al cargo, requiere capacitación" });
    await save("7", { code: "A-1", impLegal: "5", probability: "3" });                                       // 5 × 3 = 15 → Crítica
    await save("7", { code: "A-3", impLegal: "1", probability: "1" });                                       // 1 → Baja
    await save("8", { code: "O-1", area: "Cajas", position: "Cajero", type: "Simplificar procedimiento", impact: "4", ease: "3", effort: "2", cost: "2", riskScore: "1", hours: "5" });
    await save("8", { code: "O-2", area: "Domicilios", position: "Auxiliar", type: "Automatizar o digitalizar" });
    await save("9", { area: "Cajas", position: "Cajero", hoursOut: "2" });
    await save("10", { code: "P-1", action: "Capacitar", area: "Cajas", position: "Cajero", priority: "Alta", initiative: "Capacitación", status: "En curso", start: "2026-01-01", end: "2026-03-31" });
    await save("10", { code: "P-2", action: "Automatizar", area: "Domicilios", position: "Auxiliar", priority: "Baja", initiative: "Ajuste tecnológico", status: "No iniciada", start: "2026-05-01", end: "2026-06-30" });

    const rows = async (id: EntryId) => (await listEntries(app.db, owner, studyId, id))!.rows;
    const run = async (id: EntryId, sp: Record<string, string | string[]>) => { const r = entryFilters(entryDef(id)!, await rows(id), sp); return { ...r, codes: r.rows.map((x) => Object.values(x.cells).find((v) => typeof v === "string" && /^[A-Z]-\d$/.test(v)) ?? "") }; };

    await check("Cargos (hoja 2): centro de operaciones, área y cargo, con selección múltiple; las opciones salen de todas las filas", async () => {
      const all = await run("2", {});
      if (all.rows.length !== 3 || all.active !== 0) throw new Error("sin filtros");
      if ((await run("2", { co: "CO Norte" })).rows.length !== 2 || (await run("2", { co: ["CO Prado", "CO Norte"] })).rows.length !== 3) throw new Error("centro de operaciones");
      if ((await run("2", { area: "Domicilios" })).rows.length !== 1 || (await run("2", { cargo: ["Cajero", "Auxiliar"] })).rows.length !== 2) throw new Error("área o cargo");
      const f = await run("2", { co: "CO Prado" });
      if (f.fields.find((x) => x.key === "co")!.options.length !== 2 || f.active !== 1) throw new Error("las opciones deben salir de todas las filas");
    });

    await check("Actividades (hoja 3): estado de captura y búsqueda por texto, combinados con los básicos", async () => {
      const inc = await run("3", { captura: "incompleta" }); if (inc.codes.join() !== "A-2") throw new Error(`incompletas: ${inc.codes}`);
      if ((await run("3", { captura: "completa" })).codes.join() !== "A-1,A-3") throw new Error("completas");
      if ((await run("3", { q: "entrega" })).codes.join() !== "A-3") throw new Error("búsqueda");
      if ((await run("3", { co: "CO Norte", captura: "completa" })).codes.join() !== "A-3") throw new Error("combinados");
    });

    await check("Medibilidad, pertinencia y riesgos: centro de operaciones, área y cargo salen de la actividad citada; nivel y criticidad", async () => {
      if ((await run("5", { co: "CO Prado" })).codes.join() !== "A-1" || (await run("5", { co: "CO Norte" })).rows.length !== 0) throw new Error("medibilidad por centro");
      if ((await run("6", { cargo: "Fiscal" })).codes.join() !== "A-2") throw new Error("pertinencia por cargo");
      const n = await run("5", {}); const nivel = n.fields.find((x) => x.key === "nivel"); if (!nivel || nivel.options.length < 1) throw new Error("falta el filtro de nivel");
      if ((await run("5", { nivel: nivel.options[0].value })).rows.length !== 1) throw new Error("nivel");
      if ((await run("6", {})).fields.some((x) => !["co", "area", "cargo"].includes(x.key))) throw new Error("pertinencia solo lleva los básicos");
      if ((await run("7", { criticidad: "Crítica" })).codes.join() !== "A-1" || (await run("7", { criticidad: "Baja" })).codes.join() !== "A-3") throw new Error("criticidad");
      if ((await run("7", { criticidad: ["Crítica", "Baja"], co: "CO Norte" })).codes.join() !== "A-3") throw new Error("criticidad + centro");
    });

    await check("Oportunidades (tipo) y rediseño (solo básicos): área y cargo de sus propios campos", async () => {
      if ((await run("8", { tipo: "Simplificar procedimiento" })).codes.join() !== "O-1" || (await run("8", { area: "Domicilios" })).codes.join() !== "O-2") throw new Error("oportunidades");
      if ((await run("9", { area: "Cajas" })).rows.length !== 1 || (await run("9", { area: "Domicilios" })).rows.length !== 0) throw new Error("rediseño");
      if ((await run("9", {})).fields.some((x) => !["co", "area", "cargo"].includes(x.key))) throw new Error("rediseño solo lleva los básicos");
    });

    await check("Plan de acción: estado, prioridad, tipo de iniciativa, alerta de plazo y vencimiento en un rango de fechas", async () => {
      if ((await run("10", { estado: "En curso" })).codes.join() !== "P-1" || (await run("10", { prioridad: "Baja" })).codes.join() !== "P-2") throw new Error("estado o prioridad");
      if ((await run("10", { iniciativa: ["Capacitación", "Ajuste tecnológico"] })).rows.length !== 2) throw new Error("iniciativa");
      if ((await run("10", { vdesde: "2026-04-01" })).codes.join() !== "P-2" || (await run("10", { vhasta: "2026-04-01" })).codes.join() !== "P-1") throw new Error("rango de fechas");
      if ((await run("10", { vdesde: "2026-01-01", vhasta: "2026-12-31" })).rows.length !== 2 || (await run("10", { vdesde: "2027-01-01" })).rows.length !== 0) throw new Error("rango amplio o vacío");
      if ((await run("10", { vdesde: "no-es-fecha" })).rows.length !== 2) throw new Error("una fecha inválida no debe filtrar");
      const f = await run("10", { vdesde: "2026-04-01" }); if (f.active !== 1 || !f.range) throw new Error("conteo de filtros activos con rango");
      const keys = f.fields.map((x) => x.key); for (const k of ["estado", "prioridad", "iniciativa", "alerta"]) if (!keys.includes(k)) throw new Error(`falta el filtro ${k}`);
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id = ${owner}`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
