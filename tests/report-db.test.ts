import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { listRoles, saveRole } from "../src/server/access";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { saveEntry } from "../src/server/entry/service";
import { saveShift } from "../src/server/shifts";
import { SECTION_IDS } from "../src/domain/report-text";
import type { SectionPayload } from "../src/domain/report-text";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-106 (parte C2) con PostgreSQL real y un agente SIMULADO (no gasta fichas): una versión nace como borrador; solo una persona con «Resultados» en Edición la edita y aprueba; lo aprobado
 * no se modifica ni se borra; las secciones sin cambios se reutilizan; una cifra inventada deja la sección por revisar y bloquea la aprobación; el tope diario y el de fichas se cumplen;
 * lo que se envía al agente no trae correos ni teléfonos; y la seguridad por filas separa a quien solo lee, a quien no tiene «Resultados» y a quien no es del estudio. No deja datos.
 */
process.env.REPORT_DAILY_LIMIT = "9";
process.env.REPORT_MAX_TOKENS_PER_RUN = "50000";
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { const x = e as { code?: string; cause?: { code?: string } }; return x.cause?.code ?? x.code ?? "error"; }
}

async function main() {
  const M = await import("../src/server/report-version");
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 6);
  const owner = randomUUID(), lee = randomUUID(), edita = randomUUID(), sin = randomUUID(), ajeno = randomUUID(), acotado = randomUUID();
  for (const id of [owner, lee, edita, sin, ajeno, acotado]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  /** Agentes simulados: el bueno usa los marcadores con las dos primeras cifras de la sección; el malo inventa una cifra; el que falla lanza un error; el pesado gasta muchas fichas. */
  const seen: SectionPayload[] = [];
  const good = async (p: SectionPayload) => { seen.push(p); return { input: { paragraphs: [`Hay {{${p.cifras[0].id}}} y {{${p.cifras[Math.min(1, p.cifras.length - 1)].id}}} en esta sección.`] }, inputTokens: 1200, outputTokens: 300 }; };
  const bad = async (p: SectionPayload) => { seen.push(p); return { input: { paragraphs: ["Se necesitan 999 personas más."] }, inputTokens: 1000, outputTokens: 100 }; };
  const boom = async () => { throw new Error("servicio caído"); };
  let heavyCalls = 0;
  const heavy = async (p: SectionPayload) => { heavyCalls++; seen.push(p); return { input: { paragraphs: ["Se necesitan 999 personas más."] }, inputTokens: 60000, outputTokens: 100 }; };
  const versions = () => M.listVersions(app.db, owner, studyId);
  const runs = async () => ((await admin.db.execute(sql`select status from public.agent_runs where study_id = ${studyId} and trigger = 'report' order by created_at`)) as unknown as { status: string }[]);
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba del informe");
    for (const [position, headcount, hours, area] of [["Cajero", "9", "40", "Cajas"], ["Fiscal", "3", "40", "Cajas"], ["Auxiliar", "8", "40", "Domicilios"]] as const) {
      const r = await saveEntry(app.db, owner, studyId, "2", cells("2", { area, site: "Prado", position, headcount, weeklyHours: hours }), {});
      if (!r.ok) throw new Error("no se pudo sembrar el cargo " + position + ": " + JSON.stringify(r));
    }
    for (const [code_, area, position, exec, period, min] of [["C-1", "Cajas", "Cajero", "150", "Semana", "144"], ["C-2", "Cajas", "Cajero", "1", "Mes", "360"], ["F-1", "Cajas", "Fiscal", "75", "Semana", "84"], ["D-1", "Domicilios", "Auxiliar", "6", "Día", "60"]] as const) {
      const r = await saveEntry(app.db, owner, studyId, "3", cells("3", { kind: "REAL", code: code_, area, site: "Prado", position, name: `Actividad ${code_}`, calcMode: "Por evento", executions: exec, period, scope: "Total del cargo en la sede", timeAvg: min }), {});
      if (!r.ok) throw new Error("no se pudo sembrar la actividad " + code_ + ": " + JSON.stringify(r));
    }
    const [pos] = (await admin.db.execute(sql`select id from public.positions where study_id = ${studyId} and name = 'Cajero'`)) as unknown as { id: string }[];
    const sh = await saveShift(app.db, owner, studyId, pos.id, undefined, { name: "T1", start: "07:00", end: "15:00", breakMin: "30", days: ["0", "1", "2", "3", "4", "5"] });
    if (!sh.ok) throw new Error("turno: " + JSON.stringify(sh));
    await admin.db.execute(sql`update public.positions set operation_description = 'Atiende el público. Escriba a juan.perez@empresa.co o llame al +57 300 123 4567 (cédula 1234567890).' where id = ${pos.id}`);
    const rl = await saveRole(app.db, owner, studyId, { name: "Lee resultados", perms: { resultados: "read" } });
    const re = await saveRole(app.db, owner, studyId, { name: "Edita y redacta", perms: { resultados: "edit", agente: "edit" } });
    if (!rl.ok || !re.ok) throw new Error("roles de prueba");
    const roleId = async (name: string) => (await listRoles(app.db, owner, studyId)).find((r) => r.name === name)!.id;
    for (const [u, name] of [[lee, "Lee resultados"], [edita, "Edita y redacta"], [sin, "Editor"]] as const) await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role, role_id) values (${studyId}, ${u}, 'viewer', ${await roleId(name)})`);
    // con Edición en Resultados pero limitado a algunas áreas (sin áreas asignadas): el texto resume todo el estudio y no lo ve
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role, role_id, all_areas) values (${studyId}, ${acotado}, 'viewer', ${await roleId("Edita y redacta")}, false)`);

    await check("Generar: nace un borrador con el texto de cada sección (la de diagnóstico, sin datos, no se redacta), a nombre de quien lo pidió, con su registro y sin gastar la cuota del agente de ajustes", async () => {
      const r = await M.generateVersion(app.db, owner, studyId, good);
      if (!r.ok || r.number !== 1 || r.reused !== 0 || r.written !== 6) throw new Error(JSON.stringify(r));
      const [v] = await versions();
      if (v.status !== "draft" || v.number !== 1 || v.createdBy !== owner || v.approvedBy !== null || v.baseNumber !== null || v.sections.length !== 7) throw new Error(JSON.stringify({ s: v.status, n: v.number }));
      const by = Object.fromEntries(v.sections.map((s) => [s.id, s]));
      if (by.hallazgos.status !== "nodata" || by.hallazgos.paragraphs.length !== 0) throw new Error("hallazgos sin datos");
      for (const id of SECTION_IDS.filter((i) => i !== "hallazgos")) {
        const s = by[id];
        if (s.status !== "verified" || s.source !== "agent" || s.paragraphs.length !== 1 || /\{\{/.test(s.paragraphs[0]) || s.cites.length < 1) throw new Error(`${id}: ${JSON.stringify(s)}`);
      }
      const total = v.catalog.resumen.find((i) => i.id === "totals.required")!;
      if (!by.resumen.paragraphs[0].includes(total.display)) throw new Error("la cifra del texto debe ser la calculada");
      if ((await runs()).length !== 1 || (await runs())[0].status !== "done") throw new Error("la redacción debe quedar contada");
      const agente = ((await admin.db.execute(sql`select count(*)::int n from public.agent_runs where study_id = ${studyId} and trigger not in ('coverage', 'report')`)) as unknown as { n: number }[])[0].n;
      if (agente !== 0) throw new Error("las redacciones del informe no deben gastar la cuota del agente de ajustes");
      const log = (await admin.db.execute(sql`select origin, action from public.audit_log where study_id = ${studyId} and entity = 'report_version'`)) as unknown as { origin: string; action: string }[];
      if (!log.some((l) => l.origin === "agent" && l.action === "run")) throw new Error("falta el registro");
    });

    await check("Lo que se envía al agente: cifras y contexto sin correos, teléfonos ni números largos; el contexto solo en las secciones que lo usan", async () => {
      const todo = JSON.stringify(seen);
      if (/juan\.perez|@empresa|300 123|1234567890/.test(todo)) throw new Error("salió información personal al agente");
      const dot = seen.find((p) => p.seccion.id === "dotacion")!;
      if (!dot.contexto?.[0].operation.includes("[correo]") || !dot.contexto[0].operation.includes("[número]") || !dot.contexto[0].shifts.length) throw new Error("el contexto debía limpiarse: " + JSON.stringify(dot.contexto));
      if (seen.find((p) => p.seccion.id === "resumen")!.contexto !== undefined) throw new Error("el resumen no recibe contexto");
      if (/employee|colaborador_/i.test(todo)) throw new Error("códigos de colaborador");
    });

    await check("Solo un borrador a la vez: crear otra versión con un borrador abierto se rechaza con un mensaje claro", async () => {
      const r = await M.generateVersion(app.db, owner, studyId, good);
      if (r.ok || !/borrador sin aprobar \(versión 1\)/.test(r.message) || (await versions()).length !== 1) throw new Error(JSON.stringify(r));
      if (await code(admin.db.execute(sql`insert into public.report_versions (study_id, number, status, catalog, input_hash, sections, model, created_by) values (${studyId}, 2, 'draft', '{}'::jsonb, 'x', '[]'::jsonb, 'm', ${owner})`)) !== "23505") throw new Error("el índice único debía impedir un segundo borrador");
    });

    await check("Una cifra inventada deja la sección «requiere revisión» y bloquea la aprobación; al redactarla de nuevo bien, se puede aprobar; la aprobación queda a nombre de quien aprueba", async () => {
      const [v] = await versions();
      const mala = await M.regenerateSection(app.db, owner, studyId, v.id, "alcance", bad);
      if (!mala.ok) throw new Error(JSON.stringify(mala));
      const rev = (await versions())[0].sections.find((s) => s.id === "alcance")!;
      if (rev.status !== "review" || !/999/.test(rev.note ?? "")) throw new Error("debía quedar por revisar: " + JSON.stringify(rev));
      const no = await M.approveVersion(app.db, owner, studyId, v.id);
      if (no.ok || !/Alcance y método/.test(no.message)) throw new Error("no debía aprobarse: " + JSON.stringify(no));
      const bien = await M.regenerateSection(app.db, owner, studyId, v.id, "alcance", good);
      if (!bien.ok || (await versions())[0].sections.find((s) => s.id === "alcance")!.status !== "verified") throw new Error("redactar de nuevo");
      const ok = await M.approveVersion(app.db, owner, studyId, v.id);
      if (!ok.ok || ok.number !== 1) throw new Error(JSON.stringify(ok));
      const a = (await versions())[0];
      if (a.status !== "approved" || a.approvedBy !== owner || !a.approvedAt) throw new Error("aprobación");
      const log = (await admin.db.execute(sql`select action from public.audit_log where study_id = ${studyId} and entity = 'report_version' and action = 'approve'`)) as unknown as unknown[];
      if (log.length !== 1) throw new Error("falta la constancia de la aprobación");
    });

    await check("Lo aprobado no se toca: ni siquiera el administrador de la base lo modifica, lo borra ni lo vuelve borrador; aprobar a nombre de otra persona se rechaza", async () => {
      const [v] = await versions();
      const intentos: [string, string][] = [
        ["cambiar el texto", `update public.report_versions set sections = '[]'::jsonb where id = '${v.id}'`], ["borrarla", `delete from public.report_versions where id = '${v.id}'`],
        ["volverla borrador", `update public.report_versions set status = 'draft' where id = '${v.id}'`], ["cambiar las cifras", `update public.report_versions set catalog = '{}'::jsonb where id = '${v.id}'`],
        ["cambiar el aprobador", `update public.report_versions set approved_by = '${lee}' where id = '${v.id}'`],
      ];
      for (const [que, q] of intentos) if ((await code(admin.db.execute(sql.raw(q)))) !== "23514") throw new Error(`debía rechazar ${que}`);
      const [d] = (await admin.db.execute(sql`select id from public.report_versions where study_id = ${studyId} and number = 1`)) as unknown as { id: string }[];
      if (!d) throw new Error("la versión aprobada sigue ahí");
      // aprobar a nombre de otra persona: un borrador nuevo (con la base) que se intenta aprobar con otro aprobador
      await admin.db.execute(sql`insert into public.report_versions (study_id, number, status, catalog, input_hash, sections, model, created_by) values (${studyId}, 9, 'draft', '{}'::jsonb, 'x', '[]'::jsonb, 'm', ${owner})`);
      const otra = await code(withRls(app.db, { sub: owner }, (tx) => tx.execute(sql`update public.report_versions set status = 'approved', approved_by = ${lee}, approved_at = now() where study_id = ${studyId} and number = 9`)));
      if (otra !== "23514") throw new Error("aprobar a nombre de otra persona debía rechazarse: " + otra);
      await admin.db.execute(sql`delete from public.report_versions where study_id = ${studyId} and number = 9`);
    });

    await check("Actualizar sin cambios: se crea la versión 2 reutilizando todo (el agente no se llama); al aprobarla la 1 pasa a «reemplazada» y no se vuelve a modificar", async () => {
      const antes = seen.length;
      const r = await M.generateVersion(app.db, owner, studyId, good);
      if (!r.ok || r.number !== 2 || r.written !== 0 || r.reused !== 6 || seen.length !== antes) throw new Error(JSON.stringify({ r, llamadas: seen.length - antes }));
      const v2 = (await versions())[0];
      if (v2.baseNumber !== 1 || v2.sections.filter((s) => s.source === "reused").length !== 6) throw new Error("reutilización");
      const ap = await M.approveVersion(app.db, owner, studyId, v2.id);
      if (!ap.ok) throw new Error(JSON.stringify(ap));
      const all = await versions();
      if (all.map((v) => v.status).join() !== "approved,superseded") throw new Error("estados: " + all.map((v) => v.status));
      if (await code(admin.db.execute(sql.raw(`update public.report_versions set model = 'otro' where id = '${all[1].id}'`))) !== "23514") throw new Error("una versión reemplazada no se modifica");
    });

    await check("Cambia solo el contexto de la operación: se vuelven a redactar las 3 secciones que lo usan y las otras 3 se reutilizan (con su texto tal como estaba)", async () => {
      await admin.db.execute(sql`update public.positions set operation_description = 'Atiende el público en cajas rápidas y cajas normales.' where id = ${pos.id}`);
      const r = await M.generateVersion(app.db, owner, studyId, good);
      if (!r.ok || r.number !== 3 || r.written !== 3 || r.reused !== 3) throw new Error(JSON.stringify(r));
      const v3 = (await versions())[0], v2 = (await versions())[1];
      const re = v3.sections.filter((s) => s.source === "reused").map((s) => s.id).sort().join();
      if (re !== "alcance,calidad,resumen") throw new Error("reutilizadas: " + re);
      for (const id of ["alcance", "calidad", "resumen"] as const) if (v3.sections.find((s) => s.id === id)!.paragraphs.join() !== v2.sections.find((s) => s.id === id)!.paragraphs.join()) throw new Error(`${id}: el texto reutilizado debía ser idéntico`);
    });

    await check("Editar a mano un borrador: si los números son los de la sección queda «editada»; si no, «requiere revisión» y no se aprueba; texto vacío o demasiado largo se rechaza; lo aprobado no se edita", async () => {
      const v3 = (await versions())[0];
      const req = v3.catalog.resumen.find((i) => i.id === "totals.required")!;
      const ok = await M.saveSectionText(app.db, owner, studyId, v3.id, "resumen", `Se necesitan ${req.display} personas.\n\nSegundo párrafo sin cifras.`);
      if (!ok.ok || ok.status !== "edited") throw new Error(JSON.stringify(ok));
      const s = (await versions())[0].sections.find((x) => x.id === "resumen")!;
      if (s.source !== "person" || s.paragraphs.length !== 2 || !s.cites.includes("totals.required")) throw new Error("texto editado: " + JSON.stringify(s));
      const mal = await M.saveSectionText(app.db, owner, studyId, v3.id, "resumen", "Se necesitan 4321 personas.");
      if (!mal.ok || mal.status !== "review" || !/4321/.test(mal.note ?? "")) throw new Error(JSON.stringify(mal));
      const blocked = await M.approveVersion(app.db, owner, studyId, v3.id);
      if (blocked.ok) throw new Error("con una sección por revisar no se aprueba");
      await M.saveSectionText(app.db, owner, studyId, v3.id, "resumen", `Se necesitan ${req.display} personas.`);
      for (const t of ["", "   ", "x".repeat(6001), Array(11).fill("p").join("\n\n")]) if ((await M.saveSectionText(app.db, owner, studyId, v3.id, "resumen", t)).ok) throw new Error("debía rechazar el texto " + t.length);
      if ((await M.saveSectionText(app.db, owner, studyId, v3.id, "hallazgos", "Texto.")).ok) throw new Error("una sección sin datos no se escribe");
      const [aprobada] = (await versions()).filter((v) => v.status === "approved");
      if ((await M.saveSectionText(app.db, owner, studyId, aprobada.id, "resumen", "Texto.")).ok || (await M.regenerateSection(app.db, owner, studyId, aprobada.id, "resumen", good)).ok) throw new Error("lo aprobado no se edita ni se redacta de nuevo");
    });

    await check("Descartar: el borrador se borra (y queda constancia); lo aprobado nunca; si el servicio del agente falla no se crea nada ni se cuenta la redacción", async () => {
      const v3 = (await versions())[0];
      const [aprobada] = (await versions()).filter((v) => v.status === "approved");
      if ((await M.discardDraft(app.db, owner, studyId, aprobada.id)).ok) throw new Error("no se descarta lo aprobado");
      const d = await M.discardDraft(app.db, owner, studyId, v3.id);
      if (!d.ok || (await versions()).length !== 2) throw new Error("descartar");
      const contadas = (await runs()).filter((r) => r.status !== "failed").length;
      const f = await M.generateVersion(app.db, owner, studyId, boom);
      if (f.ok || !/No se pudo consultar al agente/.test(f.message) || (await versions()).length !== 2) throw new Error("falla del servicio: " + JSON.stringify(f));
      const despues = await runs();
      if (despues.filter((r) => r.status !== "failed").length !== contadas || despues[despues.length - 1].status !== "failed") throw new Error("la redacción fallida no debe contarse");
      if (!((await admin.db.execute(sql`select action from public.audit_log where study_id = ${studyId} and entity = 'report_version' and action = 'discard'`)) as unknown as unknown[]).length) throw new Error("falta la constancia del descarte");
    });

    await check("Tope de fichas por redacción: al pasarse no se reintenta ni se llama de más, y las secciones quedan «requiere revisión» con el motivo (nada se presenta como bueno)", async () => {
      const r = await M.generateVersion(app.db, owner, studyId, heavy);
      if (!r.ok) throw new Error(JSON.stringify(r));
      const v = (await versions())[0];
      // solo se redactan las secciones cuyo contexto cambió (3); las demás se reutilizan y no pasan por el agente
      const redactadas = v.sections.filter((s) => s.source === "agent");
      if (redactadas.length !== 3 || heavyCalls !== 3) throw new Error(`debían redactarse 3 secciones con una llamada cada una (sin reintentos por el tope); redactadas ${redactadas.length}, llamadas ${heavyCalls}`);
      if (redactadas.some((s) => s.status !== "review" || !/999/.test(s.note ?? ""))) throw new Error(JSON.stringify(redactadas.map((s) => [s.id, s.status, s.note])));
      if (v.sections.filter((s) => s.source === "reused").length !== 3) throw new Error("las demás se reutilizan");
      if ((await M.approveVersion(app.db, owner, studyId, v.id)).ok) throw new Error("con todo por revisar no se aprueba");
      await M.discardDraft(app.db, owner, studyId, v.id);
    });

    await check("Tope diario: al llegar al máximo de redacciones del día se rechaza otra, con mensaje; las redacciones fallidas no cuentan", async () => {
      const antes = await withRls(app.db, { sub: owner }, (tx) => M.reportUsageToday(tx, studyId));
      let exitos = 0, ultimo = "";
      for (let i = 0; i < 12; i++) {
        const r = await M.generateVersion(app.db, owner, studyId, good);
        if (!r.ok) { ultimo = r.message; break; }
        exitos++;
        const [d] = await versions();
        await M.discardDraft(app.db, owner, studyId, d.id);
      }
      if (exitos !== M.REPORT_DAILY_LIMIT - antes || !/tope diario/.test(ultimo)) throw new Error(`éxitos ${exitos} (límite ${M.REPORT_DAILY_LIMIT}, usadas ${antes}); mensaje: ${ultimo}`);
      if ((await withRls(app.db, { sub: owner }, (tx) => M.reportUsageToday(tx, studyId))) !== M.REPORT_DAILY_LIMIT) throw new Error("el uso del día");
      await admin.db.execute(sql`delete from public.agent_runs where study_id = ${studyId} and trigger = 'report'`); // se reinicia el contador para las pruebas que siguen
    });

    await check("Seguridad por filas: quien solo lee ve las versiones pero no puede escribir; quien tiene Edición en Resultados las edita pero sin agente no puede redactar; sin Resultados, fuera del estudio o limitado a algunas áreas no se ve nada", async () => {
      const [aprobada] = (await versions()).filter((v) => v.status === "approved");
      if ((await M.listVersions(app.db, lee, studyId)).length !== 2 || (await M.listVersions(app.db, edita, studyId)).length !== 2) throw new Error("Lectura y Edición ven las versiones");
      for (const quien of [sin, ajeno, acotado]) if ((await M.listVersions(app.db, quien, studyId)).length !== 0) throw new Error("no debía ver versiones");
      if ((await M.generateVersion(app.db, acotado, studyId, good)).ok || (await M.approveVersion(app.db, acotado, studyId, aprobada.id)).ok) throw new Error("limitado a algunas áreas no genera ni aprueba");
      if ((await M.generateVersion(app.db, lee, studyId, good)).ok || (await M.approveVersion(app.db, lee, studyId, aprobada.id)).ok) throw new Error("con Lectura no se genera ni se aprueba");
      const ins = (u: string) => code(withRls(app.db, { sub: u }, (tx) => tx.execute(sql`insert into public.report_versions (study_id, number, status, catalog, input_hash, sections, model, created_by) values (${studyId}, 20, 'draft', '{}'::jsonb, 'x', '[]'::jsonb, 'm', ${u})`)));
      if ((await ins(lee)) !== "42501" || (await ins(sin)) !== "42501" || (await ins(ajeno)) !== "42501") throw new Error("la base debía rechazar escribir sin Edición en Resultados");
      const aNombreDeOtro = await code(withRls(app.db, { sub: edita }, (tx) => tx.execute(sql`insert into public.report_versions (study_id, number, status, catalog, input_hash, sections, model, created_by) values (${studyId}, 21, 'draft', '{}'::jsonb, 'x', '[]'::jsonb, 'm', ${owner})`)));
      if (aNombreDeOtro !== "42501") throw new Error("crear una versión a nombre de otra persona debía rechazarse: " + aNombreDeOtro);
      const g = await M.generateVersion(app.db, edita, studyId, good);
      if (!g.ok) throw new Error("quien tiene Edición en Resultados y en Agente puede redactar: " + JSON.stringify(g));
      const [borrador] = (await versions()).filter((v) => v.status === "draft");
      const ed = await M.saveSectionText(app.db, edita, studyId, borrador.id, "calidad", `Hay ${borrador.catalog.calidad.find((i) => i.id === "data.activities")!.display} actividades.`);
      if (!ed.ok) throw new Error("editar con Edición: " + JSON.stringify(ed));
      if ((await M.saveSectionText(app.db, lee, studyId, borrador.id, "calidad", "Texto.")).ok || (await M.discardDraft(app.db, lee, studyId, borrador.id)).ok) throw new Error("con Lectura no se edita ni se descarta");
      if ((await M.listVersions(app.db, lee, studyId)).find((v) => v.id === borrador.id)?.sections.find((s) => s.id === "calidad")?.source !== "person") throw new Error("lo editado por quien tiene Edición se guardó");
      await M.discardDraft(app.db, edita, studyId, borrador.id);
    });

    await check("Borrar el estudio borra sus versiones, también las aprobadas, sin chocar con las protecciones", async () => {
      await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
      const n = ((await admin.db.execute(sql`select count(*)::int n from public.report_versions where study_id = ${studyId}`)) as unknown as { n: number }[])[0].n;
      studyId = "";
      if (n !== 0) throw new Error("quedaron versiones huérfanas: " + n);
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from public.memberships where user_id in (${lee}, ${edita}, ${sin}, ${acotado})`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${lee}, ${edita}, ${sin}, ${ajeno}, ${acotado})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
