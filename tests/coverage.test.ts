import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { listEntries, saveEntry } from "../src/server/entry/service";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { buildCoverage, splitProfile, type CoverageActivity } from "../src/domain/coverage";
import { NOTICE, coveragePayload, coveragePdf, coverageXlsx, wrapText } from "../src/lib/coverage-export";
import { check, rejects, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * Validación de cobertura de funciones (brief). La IA se simula con un clasificador propio para no gastar tokens ni enviar datos: las reglas de
 * validación, los casos límite, el límite diario y que todo sea de solo lectura se prueban contra PostgreSQL real. La prueba con el modelo real está
 * en scripts/test-coverage-live.ts (datos de demostración).
 */
process.env.COVERAGE_DAILY_LIMIT = "8";
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) out[d.fields.find((y) => y.field === f)!.col] = v;
  return out;
};
const acts = (n: number): CoverageActivity[] => Array.from({ length: n }, (_, i) => ({ code: `A-${i + 1}`, name: `Actividad ${i + 1}`, description: null }));
const fn = (text: string, status: "covered" | "partial" | "none", activities: string[], note = "") => ({ text, status, activities, note });

async function main() {
  const { validateCoverage, listCoverageCargos, classifyProfile } = await import("../src/server/coverage");
  const { runAgent } = await import("../src/server/agent");
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    /* ───── Reglas puras ───── */
    await check("Perfil con 5 funciones y actividades que cubren 4: la restante sale «Sin cobertura», con alerta, primero en la tabla", () => {
      const r = buildCoverage([{ functions: [fn("Función 1", "covered", ["A-1"]), fn("Función 2", "covered", ["A-2"]), fn("Función 3", "none", [], "Ninguna actividad la contempla"), fn("Función 4", "covered", ["A-3"]), fn("Función 5", "covered", ["A-4"])] }], { functionsText: "x", activities: acts(4) });
      if (!r.ok) throw new Error(r.reason);
      if (r.result.level !== "alert" || r.result.functions[0].status !== "none" || r.result.summary !== "4 de 5 funciones cubiertas · 0 parcialmente · 1 sin cobertura") throw new Error(JSON.stringify(r.result.summary));
    });
    await check("Una misma actividad que abarca dos funciones: ambas cubiertas, sin importar la diferencia de cantidades", () => {
      const r = buildCoverage([{ functions: [fn("Recibir pedidos", "covered", ["A-1"]), fn("Registrar pedidos", "covered", ["A-1"])] }], { functionsText: "x", activities: acts(1) });
      if (!r.ok || r.result.level !== "ok" || r.result.counts.covered !== 2 || r.result.unrelated.length) throw new Error(JSON.stringify(r));
    });
    await check("Igual número de funciones y de actividades, pero una función sin actividad: se detecta (no se compara por cantidad)", () => {
      const r = buildCoverage([{ functions: [fn("Función 1", "covered", ["A-1"]), fn("Función 2", "covered", ["A-2"]), fn("Función 3", "covered", ["A-2"]), fn("Función 4", "none", [], "Falta"), fn("Función 5", "covered", ["A-5"])] }], { functionsText: "x", activities: acts(5) });
      if (!r.ok || r.result.counts.none !== 1 || r.result.counts.total !== 5 || r.result.unrelated.map((a) => a.code).join() !== "A-3,A-4") throw new Error(JSON.stringify(r));
    });
    await check("Una función cubierta solo en parte: «Parcialmente cubierta», con la parte faltante explicada y advertencia", () => {
      const r = buildCoverage([{ functions: [fn("Cuadrar caja y reportar", "partial", ["A-1"], "Falta el reporte diario"), fn("Función 2", "covered", ["A-2"])] }], { functionsText: "x", activities: acts(2) });
      if (!r.ok || r.result.level !== "warning" || r.result.functions[0].status !== "partial" || !r.result.functions[0].note) throw new Error(JSON.stringify(r));
    });
    await check("Respuesta inválida: contrato roto, actividad inventada, «cubierta» sin actividad, «sin cobertura» con actividad, parcial sin explicación → error, nunca resultado parcial", () => {
      const I = { functionsText: "x", activities: acts(2) };
      const bad = [
        {}, { functions: [] }, { functions: [fn("Función 1", "covered", ["Z-9"])] }, { functions: [fn("Función 1", "covered", [])] },
        { functions: [fn("Función 1", "none", ["A-1"], "x")] }, { functions: [fn("Función 1", "partial", ["A-1"])] }, { functions: [fn("Función 1", "covered", ["A-1"]), { text: "Función 2", status: "?" }] },
      ];
      for (const b of bad) if (buildCoverage([b], I).ok) throw new Error(`aceptó ${JSON.stringify(b).slice(0, 80)}`);
      if (!buildCoverage([{ functions: JSON.stringify([fn("Función 1", "covered", ["a-1"])]) }], I).ok) throw new Error("debía aceptar el arreglo entregado como texto JSON y códigos en otra capitalización");
    });
    await check("Texto muy largo: se procesa completo en tramos y al unir los resultados no se duplican funciones (se conserva el estado más prudente)", () => {
      const text = Array.from({ length: 400 }, (_, i) => `${i + 1}. Función número ${i + 1} del cargo con su descripción larga para ocupar espacio.`).join("\n");
      const parts = splitProfile(text, 6000);
      if (parts.length < 3 || parts.join("\n").replace(/\s+/g, "") !== text.replace(/\s+/g, "")) throw new Error(`tramos ${parts.length}`);
      const r = buildCoverage([{ functions: [fn("Atender clientes", "covered", ["A-1"])] }, { functions: [fn("atender  clientes", "partial", ["A-2"], "Falta una parte"), fn("Otra", "covered", ["A-2"])] }], { functionsText: "x", activities: acts(2) });
      if (!r.ok || r.result.counts.total !== 2 || r.result.functions.find((f) => f.text.toLowerCase().includes("atender"))!.status !== "partial") throw new Error(JSON.stringify(r));
    });

    await check("Perfil largo (≈57 funciones): se divide en tramos en paralelo y, si la respuesta de un tramo se corta por tamaño, ese tramo se divide y se repite; no se pierde ni se duplica ninguna función", async () => {
      const lines = Array.from({ length: 60 }, (_, i) => `${i + 1}. Función número ${i + 1} del cargo, descrita con suficiente texto para ocupar espacio.`);
      const handled: string[] = []; let truncatedCalls = 0, calls = 0;
      const proposer = async (chunk: string) => {
        calls++;
        if (chunk.length > 700) { truncatedCalls++; return { raw: {}, inputTokens: 1, outputTokens: 4096, truncated: true }; }
        const ls = chunk.split("\n"); handled.push(...ls);
        return { raw: { functions: ls.map((l) => fn(l, "covered", ["A-1"])) }, inputTokens: 1, outputTokens: 1 };
      };
      const raws = await classifyProfile(proposer, lines.join("\n"), acts(1), Date.now() + 30_000, { inTok: 0, outTok: 0 });
      const built = buildCoverage(raws, { functionsText: "x", activities: acts(1) });
      if (!built.ok || built.result.counts.total !== 60 || handled.length !== 60 || new Set(handled).size !== 60 || truncatedCalls === 0 || calls < 4) throw new Error(`total ${built.ok && built.result.counts.total} tratadas ${handled.length} truncadas ${truncatedCalls} llamadas ${calls}`);
      let failed = false;
      try { await classifyProfile(async () => ({ raw: {}, inputTokens: 1, outputTokens: 1, truncated: true }), "Una función corta", acts(1), Date.now() + 30_000, { inTok: 0, outTok: 0 }); } catch { failed = true; }
      if (!failed) throw new Error("un tramo que ya no se puede dividir debe fallar, no devolver un resultado parcial");
    });

    await check("Exportación: el Excel y el PDF traen cargo, resumen, aviso de IA, cada función COMPLETA (sin recortar) con su estado en texto, actividades y observación", async () => {
      const long = "Elaborar y entregar el informe mensual de indicadores de la bodega, consolidando recibo, despacho y diferencias de inventario, y presentarlo a la jefatura inmediata antes del quinto día hábil de cada mes con sus soportes";
      const r = buildCoverage([{ functions: [fn(long, "partial", ["A-1"], "Falta la presentación a la jefatura, que ninguna actividad contempla"), fn("Recibir mercancía", "covered", ["A-1", "A-2"]), fn("Capacitar al personal nuevo", "none", [], "Ninguna actividad lo contempla")] }], { functionsText: "x", activities: acts(3) });
      if (!r.ok) throw new Error(r.reason);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await coverageXlsx("Cajero · Cajas · Norte", r.result, "2026-10-26") as unknown as ArrayBuffer);
      const ws = wb.worksheets[0]; const cells: string[] = []; ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
      for (const must of ["Cajero · Cajas · Norte", r.result.summary, NOTICE, long, "✖ Sin cobertura", "⚠ Parcialmente cubierta", "✔ Cubierta", "A-1 · Actividad 1", "Falta la presentación a la jefatura"]) if (!cells.some((c) => c.includes(must))) throw new Error(`el Excel no trae «${must.slice(0, 40)}»`);
      if (cells.some((c) => c.includes("..."))) throw new Error("el Excel recorta texto");
      const pdf = await coveragePdf("Cajero · Cajas · Norte", r.result, "2026-10-26");
      if (Buffer.from(pdf.subarray(0, 5)).toString() !== "%PDF-" || (await PDFDocument.load(pdf)).getPageCount() < 1) throw new Error("PDF inválido");
      const many = buildCoverage([{ functions: Array.from({ length: 60 }, (_, i) => fn(`Función número ${i + 1} con un texto bastante largo para que ocupe varias líneas en la celda de la tabla del PDF`, i % 3 === 0 ? "none" : "covered", i % 3 === 0 ? [] : ["A-1"], i % 3 === 0 ? "Falta" : "")) }], { functionsText: "x", activities: acts(1) });
      if (!many.ok || (await PDFDocument.load(await coveragePdf("Cargo grande", many.result, "2026-10-26"))).getPageCount() < 3) throw new Error("el PDF de 60 funciones debe paginar");
      const lines = wrapText(long, 200, (s) => s.length * 4);
      if (lines.length < 4 || lines.some((l) => l.length * 4 > 200) || lines.join(" ") !== long) throw new Error(`ajuste de líneas: ${lines.length}`);
      if (coveragePayload.safeParse({ cargo: "x", result: { functions: [{ n: 1, text: "x", status: "otro", activities: [], note: "" }] } }).success) throw new Error("aceptó una carga inválida");
    });

    /* ───── Con la base de datos ───── */    studyId = await createStudy(app.db, owner, "Estudio de cobertura (prueba)");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    const cargo = async (site: string, position: string, functions: string) => {
      const r = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site, position, headcount: "2", weeklyHours: "42", functions }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
    };
    const activity = async (code: string, site: string, position: string, name: string, description: string) => {
      const r = await saveEntry(app.db, owner, studyId, "3", cells("3", { kind: "REAL", code, area: "Cajas", site, position, name, description, calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "5" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
    };
    await cargo("Norte", "Sin funciones", ""); await cargo("Norte", "Sin actividades", "1. Cobrar al cliente");
    await cargo("Norte", "Cajero", "1. Cobrar al cliente\n2. Cuadrar la caja al cierre\n3. Atender reclamos");
    await cargo("Sur", "Cajero", "1. Abrir la tienda"); // mismo nombre de cargo, otra sede: sus funciones son distintas y no se mezclan
    await activity("N-1", "Norte", "Sin funciones", "Actividad sin perfil", "x");
    await activity("C-1", "Norte", "Cajero", "Cobrar", "Registrar el pago del cliente"); await activity("C-2", "Norte", "Cajero", "Cuadrar caja", "Conteo y cuadre al cierre");
    await activity("S-1", "Sur", "Cajero", "Abrir tienda", "Apertura");
    const cargos = await listCoverageCargos(app.db, owner, studyId);
    const id = (label: string) => cargos.find((c) => c.label.includes(label))!.id;
    const idNorteCajero = cargos.find((c) => c.label === "Cajero · Cajas · Norte")!.id;

    let calls = 0; const seen: { fns: string; acts: CoverageActivity[] }[] = [];
    const ok = async (fns: string, a: CoverageActivity[]) => { calls++; seen.push({ fns, acts: a }); return { inputTokens: 10, outputTokens: 10, raw: { functions: [fn("Cobrar al cliente", "covered", ["C-1"]), fn("Cuadrar la caja al cierre", "covered", ["C-2"]), fn("Atender reclamos", "none", [], "Ninguna actividad lo contempla")] } }; };

    await check("Cargo sin funciones o sin actividades: mensaje claro y SIN llamada a la IA", async () => {
      const a = await validateCoverage(app.db, owner, studyId, id("Sin funciones"), ok), b = await validateCoverage(app.db, owner, studyId, id("Sin actividades"), ok);
      if (a.ok || a.code !== "no_functions" || !/registr/i.test(a.message) || b.ok || b.code !== "no_activities" || calls !== 0) throw new Error(JSON.stringify([a, b, calls]));
    });

    const snapshot = async () => JSON.stringify([await Promise.all((["2", "3"] as EntryId[]).map(async (h) => (await listEntries(app.db, owner, studyId, h))!.rows)), (await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and entity <> 'coverage_run'`))]);
    await check("Cargo concreto: usa solo SUS actividades y sus funciones (nunca las de otra sede) y a la IA solo salen funciones y datos de actividades; después de validar nada cambió", async () => {
      const before = await snapshot();
      const r = await validateCoverage(app.db, owner, studyId, idNorteCajero, ok);
      if (!r.ok || r.result.level !== "alert" || r.result.counts.none !== 1) throw new Error(JSON.stringify(r));
      const s = seen[seen.length - 1];
      if (s.acts.map((a) => a.code).join() !== "C-1,C-2" || s.fns.includes("Abrir la tienda") || JSON.stringify(s).match(/headcount|weeklyHours|surveyor|@/)) throw new Error(JSON.stringify(s));
      if (await snapshot() !== before) throw new Error("la validación modificó datos de funciones, actividades o cálculos");
    });
    await check("Cambiar funciones o actividades y validar de nuevo usa los datos actuales (no se reutiliza el resultado anterior)", async () => {
      await activity("C-3", "Norte", "Cajero", "Atender reclamos de clientes", "Recibe y resuelve reclamos");
      const before = seen.length;
      await validateCoverage(app.db, owner, studyId, idNorteCajero, ok);
      if (seen.length !== before + 1 || seen[seen.length - 1].acts.length !== 3) throw new Error("no usó las actividades actuales");
    });
    await check("Falla de la IA: error comprensible y se puede reintentar; una respuesta inválida se reintenta una vez; nunca queda un resultado parcial", async () => {
      const down = await validateCoverage(app.db, owner, studyId, idNorteCajero, async () => { throw new Error("red caída"); });
      if (down.ok || down.code !== "error" || !/reintentar/i.test(down.message)) throw new Error(JSON.stringify(down));
      let n = 0;
      const flaky = await validateCoverage(app.db, owner, studyId, idNorteCajero, async (f, a) => (++n === 1 ? { inputTokens: 1, outputTokens: 1, raw: { functions: "no es un arreglo" } } : ok(f, a)));
      if (!flaky.ok || n !== 2) throw new Error(`reintento: ${JSON.stringify(flaky)} n=${n}`);
      const broken = await validateCoverage(app.db, owner, studyId, idNorteCajero, async () => ({ inputTokens: 1, outputTokens: 1, raw: {} }));
      if (broken.ok || broken.code !== "error") throw new Error(JSON.stringify(broken));
    });
    await check("Un usuario de solo lectura no puede ejecutar la validación", async () => {
      const r = await validateCoverage(app.db, viewer, studyId, idNorteCajero, ok);
      if (r.ok || r.code !== "forbidden") throw new Error(JSON.stringify(r));
    });
    await check("Límite propio de validaciones por día (aquí 8) y no consume las ejecuciones normales del agente", async () => {
      let last: Awaited<ReturnType<typeof validateCoverage>> | null = null, tries = 0;
      while (tries < 12) { last = await validateCoverage(app.db, owner, studyId, idNorteCajero, ok); if (!last.ok && last.code === "limit") break; tries++; }
      if (!last || last.ok || last.code !== "limit") throw new Error("nunca llegó al límite");
      const used = (await admin.db.execute(sql`select count(*)::int n from public.agent_runs where study_id = ${studyId} and trigger = 'coverage'`)) as unknown as { n: number }[];
      if (used[0].n !== 8) throw new Error(`se registraron ${used[0].n} validaciones y el límite es 8`);
      const a = await runAgent(app.db, owner, studyId, "manual", async () => ({ accepted: [], discarded: [], inputTokens: 1, outputTokens: 1, attempts: 1 }));
      if (!a.ok) throw new Error(`el agente normal quedó bloqueado: ${JSON.stringify(a)}`);
    });    await check("Una sola lógica: el botón del cargo y el Agente de IA llaman a la misma acción, que usa la única función validateCoverage", () => {
      const panel = readFileSync("src/components/CoveragePanel.tsx", "utf8"), actions = readFileSync("src/app/agente/actions.ts", "utf8"), form = readFileSync("src/components/EntryForm.tsx", "utf8"), page = readFileSync("src/app/agente/page.tsx", "utf8");
      if (!panel.includes("validateCoverageAction") || !form.includes("<CoveragePanel cargoId") || !page.includes("<CoveragePanel options") || (actions.match(/validateCoverage\(/g) ?? []).length !== 1) throw new Error("las dos vías no comparten la misma lógica");
      if (/@anthropic-ai|messages\.create/.test(panel + form + page)) throw new Error("hay una segunda implementación que llama a la IA");
    });
    await rejects(Promise.resolve().then(() => { throw Object.assign(new Error("x"), { code: "42501" }); }), "42501");
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
