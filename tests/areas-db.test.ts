import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, withRls } from "../src/db/client";
import { createStudy, listAreas, loadStudyData } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { listEntries, saveEntry } from "../src/server/entry/service";
import { addMeasurement, listMeasurements, listSnapshots, takeSnapshot } from "../src/server/history";
import { createInvitation, listRoles, redeemInvitation, saveRole, updateMember } from "../src/server/access";
import { connectSheet, listConnections } from "../src/server/sheets/sync";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-92 — restricción por áreas, con PostgreSQL real: una persona con algunas áreas ve y edita SOLO los registros de esas áreas en todos los módulos (cargos, dotación,
 * actividades, evaluaciones, oportunidades, rediseño, plan, mediciones); lo que no es de un área (fotos, auditoría, agente, conexión con Google) solo lo ve quien tiene
 * todas las áreas; los totales se calculan solo con sus áreas; cambiar las áreas de una persona surte efecto de inmediato. No deja datos.
 */
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};
const codeCol = (id: EntryId) => entryDef(id)!.fields.find((f) => f.field === "code")!.col;
async function code(p: Promise<unknown>): Promise<string> { try { await p; return "ok"; } catch (e) { const x = e as { code?: string; cause?: { code?: string } }; return x.cause?.code ?? x.code ?? "error"; } }

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), ana = randomUUID(), berta = randomUUID(), carlos = randomUUID();
  const mail = (u: string) => `${u.slice(0, 8)}@prueba.co`;
  for (const id of [owner, ana, berta, carlos]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba áreas");
    const area = async (n: string) => ((await admin.db.execute(sql`select id from public.areas where study_id = ${studyId} and name = ${n}`)) as unknown as { id: string }[])[0].id;
    const [cajas, domicilios] = [await area("Cajas"), await area("Domicilios")];
    const base = { kind: "REAL", site: "S1", calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "5" };
    const must = async (id: EntryId, by: Record<string, string>) => { const r = await saveEntry(app.db, owner, studyId, id, cells(id, by), {}); if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.errors)}`); return r; };

    // Datos de dos áreas (los carga el dueño, que tiene todas)
    await must("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "4", weeklyHours: "42" });
    await must("2", { area: "Domicilios", site: "S1", position: "Auxiliar", headcount: "2", weeklyHours: "42" });
    await must("3", { ...base, code: "A-C1", area: "Cajas", position: "Cajero", name: "Arqueo" });
    await must("3", { ...base, code: "A-D1", area: "Domicilios", position: "Auxiliar", name: "Entrega" });
    await must("3", { ...base, code: "A-C2", area: "Cajas", position: "Cajero", name: "Apoyo a domicilios", loadShare: "50", secondaryPosition: "Auxiliar" }); // el resto lo asume un cargo de OTRA área
    await must("5", { code: "A-C1", direct: "Sí", hasIndicators: "Sí" });
    await must("5", { code: "A-D1", direct: "Sí", hasIndicators: "Sí" });
    await must("8", { code: "O-C1", area: "Cajas", site: "S1", position: "Cajero" });
    await must("8", { code: "O-D1", area: "Domicilios", site: "S1", position: "Auxiliar" });
    await must("10", { code: "P-C1", action: "Capacitar", area: "Cajas", site: "S1", position: "Cajero" });
    await must("10", { code: "P-D1", action: "Entrenar", area: "Domicilios", site: "S1", position: "Auxiliar" });
    const acts = (await admin.db.execute(sql`select id, code from public.activities where study_id = ${studyId}`)) as unknown as { id: string; code: string }[];
    for (const a of acts.filter((x) => x.code !== "A-C2")) await addMeasurement(app.db, owner, studyId, { activityId: a.id, observedAt: new Date(), unitsProcessed: 10, personHours: 1, method: "timed", observer: null });
    await takeSnapshot(app.db, owner, studyId, "Foto de prueba");
    await connectSheet(app.db, owner, studyId, `areas-${randomUUID()}`, "push");

    // Roles y personas: Ana (solo Cajas), Berta (solo Domicilios), Carlos (todas las áreas)
    const full = { cargos: "edit", actividades: "edit", medibilidad: "edit", oportunidades: "edit", plan: "edit", historia: "edit", agente: "edit", integraciones: "edit" } as const;
    const role = await saveRole(app.db, owner, studyId, { name: "Equipo de campo", perms: full });
    if (!role.ok) throw new Error(JSON.stringify(role));
    const invite = async (who: string, allAreas: boolean, areaIds: string[]) => {
      const inv = await createInvitation(app.db, owner, studyId, { email: mail(who), roleId: role.id, allAreas, areaIds });
      if (!inv.ok) throw new Error(JSON.stringify(inv));
      const r = await redeemInvitation(app.db, who, mail(who), inv.token);
      if (!r.ok) throw new Error(JSON.stringify(r));
    };
    await invite(ana, false, [cajas]); await invite(berta, false, [domicilios]); await invite(carlos, true, []);

    const codesOf = async (who: string, id: EntryId) => ((await listEntries(app.db, who, studyId, id))!.rows.map((r) => String(r.cells[codeCol(id)] ?? "")).filter(Boolean).sort().join());
    const count = async (who: string, table: string) => withRls(app.db, { sub: who }, async (tx) => ((await tx.execute(sql.raw(`select count(*)::int n from public.${table} where study_id = '${studyId}'`))) as unknown as { n: number }[])[0].n);

    await check("Una persona con un área ve solo lo de esa área en cada módulo (cargos, actividades, evaluaciones, oportunidades, plan y mediciones); con todas las áreas, todo", async () => {
      const want = { ana: { "3": "A-C1,A-C2", "5": "A-C1", "8": "O-C1", "10": "P-C1" }, berta: { "3": "A-D1", "5": "A-D1", "8": "O-D1", "10": "P-D1" }, carlos: { "3": "A-C1,A-C2,A-D1", "5": "A-C1,A-D1", "8": "O-C1,O-D1", "10": "P-C1,P-D1" } } as const;
      for (const [name, who] of [["ana", ana], ["berta", berta], ["carlos", carlos]] as const) for (const id of ["3", "5", "8", "10"] as const) {
        const got = await codesOf(who, id);
        if (got !== want[name][id]) throw new Error(`${name} hoja ${id}: «${got}» ≠ «${want[name][id]}»`);
      }
      if ((await listEntries(app.db, ana, studyId, "2"))!.rows.length !== 1 || (await listEntries(app.db, berta, studyId, "2"))!.rows.length !== 1 || (await listEntries(app.db, carlos, studyId, "2"))!.rows.length !== 2) throw new Error("dotación por área");
      if ((await listMeasurements(app.db, ana, studyId)).length !== 1 || (await listMeasurements(app.db, carlos, studyId)).length !== 2) throw new Error("mediciones por área");
      if ((await listAreas(app.db, ana, studyId)).map((a) => a.name).join() !== "Cajas" || (await listAreas(app.db, carlos, studyId)).length < 14) throw new Error("la lista de áreas también se limita");
    });

    await check("No puede escribir fuera de sus áreas: crear, mover un registro suyo a otra área y editar o borrar uno ajeno se rechazan (la base lo hace cumplir)", async () => {
      const [posD] = (await admin.db.execute(sql`select id from public.positions where study_id = ${studyId} and area_id = ${domicilios}`)) as unknown as { id: string }[];
      const [posC] = (await admin.db.execute(sql`select id from public.positions where study_id = ${studyId} and area_id = ${cajas}`)) as unknown as { id: string }[];
      const ins = await code(withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`insert into public.activities (study_id, code, position_id, name) values (${studyId}, 'X-1', ${posD.id}, 'ajena')`)));
      if (ins !== "42501") throw new Error("crear en otra área debía dar 42501 y dio " + ins);
      const move = await code(withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`update public.activities set position_id = ${posD.id} where study_id = ${studyId} and code = 'A-C1'`)));
      if (move !== "42501") throw new Error("mover a otra área debía dar 42501 y dio " + move);
      const upd = await withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`update public.activities set name = 'hackeado' where study_id = ${studyId} and code = 'A-D1' returning id`));
      const del = await withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`delete from public.activities where study_id = ${studyId} and code = 'A-D1' returning id`));
      if ((upd as unknown as unknown[]).length !== 0 || (del as unknown as unknown[]).length !== 0) throw new Error("editó o borró un registro de otra área");
      const opp = await code(withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`insert into public.improvement_opportunities (study_id, code, area_id) values (${studyId}, 'X-O', ${domicilios})`)));
      if (opp !== "42501") throw new Error("oportunidad en otra área: " + opp);
      const area = await code(withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`insert into public.areas (study_id, name, sort_order) values (${studyId}, 'Área nueva', 99)`)));
      if (area !== "42501") throw new Error("solo quien tiene todas las áreas crea áreas: " + area);
      const mine = await saveEntry(app.db, ana, studyId, "3", cells("3", { ...base, code: "A-C3", area: "Cajas", position: "Cajero", name: "Propia" }), {});
      if (!mine.ok) throw new Error("en su área sí debía poder: " + JSON.stringify(mine));
      const other = await saveEntry(app.db, ana, studyId, "3", cells("3", { ...base, code: "A-D2", area: "Domicilios", position: "Auxiliar", name: "Ajena" }), {});
      if (other.ok) throw new Error("por el formulario tampoco debía poder crear en otra área");
      await admin.db.execute(sql`delete from public.activities where study_id = ${studyId} and code = 'A-C3'`);
      void posC;
    });

    await check("Lo que no es de un área (fotos del estudio, auditoría, agente, validaciones y la conexión de la hoja) solo lo ve quien tiene todas las áreas; todos dejan el evento de sincronización", async () => {
      for (const t of ["study_snapshots", "audit_log", "agent_runs", "agent_proposals", "validation_issues", "deviations"]) {
        if ((await count(ana, t)) !== 0 || (await count(berta, t)) !== 0) throw new Error(`una persona con áreas no debía ver ${t}`);
      }
      if ((await count(carlos, "study_snapshots")) !== 1 || (await count(carlos, "audit_log")) < 1) throw new Error("quien tiene todas las áreas sí debía verlas");
      if ((await listSnapshots(app.db, ana, studyId)).length !== 0) throw new Error("fotos");
      const snap = await code(takeSnapshot(app.db, ana, studyId, "No debería"));
      if (snap !== "42501") throw new Error("tomar una foto exige todas las áreas: " + snap);
      if ((await listConnections(app.db, ana, studyId)).length !== 1) throw new Error("quien edita debe poder consultar la conexión para que su cambio llegue a la hoja");
      await withRls(app.db, { sub: ana }, (tx) => tx.execute(sql`insert into public.sync_events (study_id, connection_id, direction, origin_id, sheet_name, payload, status) select ${studyId}::uuid, id, 'app_to_sheet', ${randomUUID()}::uuid, 'prueba', '{}'::jsonb, 'processed' from public.sheet_connections where study_id = ${studyId}`));
    });

    await check("Los totales se calculan solo con sus áreas: el estudio que ve cada persona trae únicamente sus cargos y actividades", async () => {
      const a = await loadStudyData(app.db, ana, studyId), b = await loadStudyData(app.db, berta, studyId), c = await loadStudyData(app.db, carlos, studyId);
      if (a.staff.length !== 1 || a.staff[0].area !== "Cajas" || a.acts.some((x) => x.area !== "Cajas")) throw new Error("Ana: " + JSON.stringify([a.staff.length, a.acts.map((x) => x.area)]));
      if (b.staff.length !== 1 || b.staff[0].area !== "Domicilios" || b.acts.length !== 1) throw new Error("Berta");
      if (c.staff.length !== 2 || c.acts.length !== 3) throw new Error("Carlos (todas las áreas)");
    });

    await check("Una actividad cuyo resto lo asume un cargo de un área que no se ve no rompe nada: aparece sin ese cargo (el estado lo dirá), y quien tiene todas las áreas lo ve completo", async () => {
      const a = (await loadStudyData(app.db, ana, studyId)).acts.find((x) => x.code === "A-C2")!;
      const c = (await loadStudyData(app.db, carlos, studyId)).acts.find((x) => x.code === "A-C2")!;
      if (a.secondaryPosition !== null || c.secondaryPosition !== "Auxiliar") throw new Error(JSON.stringify([a.secondaryPosition, c.secondaryPosition]));
    });

    await check("Cambiar las áreas de una persona surte efecto de inmediato (sin volver a entrar), en los dos sentidos", async () => {
      const rid = (await listRoles(app.db, owner, studyId)).find((r) => r.name === "Equipo de campo")!.id;
      const add = await updateMember(app.db, owner, studyId, ana, { roleId: rid, allAreas: false, areaIds: [cajas, domicilios] });
      if (!add.ok || (await codesOf(ana, "3")) !== "A-C1,A-C2,A-D1") throw new Error("al agregar un área debía ver también la otra");
      const all = await updateMember(app.db, owner, studyId, ana, { roleId: rid, allAreas: true, areaIds: [] });
      if (!all.ok || (await count(ana, "study_snapshots")) !== 1) throw new Error("con todas las áreas debía ver también lo que no es de un área");
      const back = await updateMember(app.db, owner, studyId, ana, { roleId: rid, allAreas: false, areaIds: [cajas] });
      if (!back.ok || (await codesOf(ana, "3")) !== "A-C1,A-C2" || (await count(ana, "study_snapshots")) !== 0) throw new Error("al limitarla otra vez debía perder lo ajeno");
    });

    await check("Las oportunidades y las acciones del plan exigen área en la base de datos (obligatoria): una fila sin área se rechaza", async () => {
      const c1 = await code(admin.db.execute(sql`insert into public.improvement_opportunities (study_id, code) values (${studyId}, 'SIN-AREA')`));
      const c2 = await code(admin.db.execute(sql`insert into public.action_items (study_id, code, action) values (${studyId}, 'SIN-AREA', 'x')`));
      if (c1 !== "23502" || c2 !== "23502") throw new Error(`debía dar 23502 y dio ${c1} / ${c2}`);
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${ana}, ${berta}, ${carlos})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
