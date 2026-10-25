import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { listRows, parseForm, saveRow, SHEETS, sheetById } from "../src/server/capture";
import { ENTRY_IDS, allEntryDefs, entryDef, type EntryId } from "../src/server/entry/defs";
import { deleteEntry, getEntry, listEntries, saveEntry } from "../src/server/entry/service";
import { SHEET_FIELDS } from "../src/domain/sheetfields";
import { check, rejects, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-62 — la APP es la fuente de los datos de entrada. Pruebas: (1) cada casilla amarilla del libro tiene su campo en la app; (2) las columnas con fórmula
 * son de solo lectura y se calculan; (3) guardar, duplicar, versión (409), borrar y permisos con PostgreSQL real; (4) parámetros. No deja datos.
 */
const def = (id: string) => sheetById(id)!;
const fd = (o: Record<string, string>) => o as Record<string, FormDataEntryValue>;
/** Arma las casillas por nombre de campo (el formulario envía columna → texto). */
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    await check("Cobertura: TODA casilla de entrada (amarilla) de las hojas 2, 3, 5, 6, 7, 8, 9 y 10 tiene su campo en la app (174)", () => {
      let total = 0;
      for (const d of allEntryDefs()) {
        const want = SHEET_FIELDS[d.id].columns.filter((c) => c.input).map((c) => c.col).sort();
        const got = d.fields.map((f) => f.col).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`hoja ${d.id}: faltan ${want.filter((c) => !got.includes(c))} / sobran ${got.filter((c) => !want.includes(c))}`);
        total += got.length;
      }
      if (total !== 174) throw new Error(`se esperaban 174 casillas y hay ${total}`);
    });

    await check("Solo lectura: las columnas con fórmula del libro NO son campos del formulario y se muestran como calculadas", () => {
      for (const d of allEntryDefs()) {
        const calc = SHEET_FIELDS[d.id].columns.filter((c) => !c.input).map((c) => c.col).sort();
        if (JSON.stringify(calc) !== JSON.stringify(d.computed.map((c) => c.col).sort())) throw new Error(`hoja ${d.id}: calculadas distintas del libro`);
        if (d.fields.some((f) => calc.includes(f.col))) throw new Error(`hoja ${d.id}: una columna con fórmula es editable`);
      }
    });

    await check("Validación de parámetros: no numérico, fuera de rango y formato estricto se rechazan (nunca 0); «semanas por mes» ya no es editable", () => {
      const bad = (o: Record<string, string>, frag: string) => {
        const e = parseForm(def("param"), fd(o)).errors.join(" | ");
        if (!e.includes(frag)) throw new Error(`esperaba «${frag}», obtuvo «${e}»`);
      };
      bad({ reservePct: "150" }, "Reserva");
      bad({ workDaysPerWeek: "1,2,3" }, "Días laborales");
      bad({ reservePct: "1%2%" }, "Reserva");
      bad({ reservePct: "%12" }, "Reserva");
      const okp = parseForm(def("param"), fd({ reservePct: " 12,5 % " }));
      if (okp.errors.length || okp.values.reservePct !== "0.1250") throw new Error(JSON.stringify(okp));
      if (def("param").fields.some((f) => f.key === "weeksPerMonth")) throw new Error("weeksPerMonth sigue editable");
    });

    studyId = await createStudy(app.db, owner, "Estudio de prueba captura");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    let recs: Record<string, string> = {};

    await check("Validación del formulario: obligatorios, lista fuera de catálogo, número ilegible y escala fuera de rango se rechazan con mensaje", async () => {
      const r1 = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas" }), {});
      if (r1.ok || !r1.errors.join().includes("es obligatorio")) throw new Error(JSON.stringify(r1));
      const r2 = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "abc" }), {});
      if (r2.ok) throw new Error("aceptó «abc» como cantidad");
      const r3 = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Área inventada", site: "S1", position: "Cajero" }), {});
      if (r3.ok) throw new Error("aceptó un área fuera de la lista");
    });

    await check("Hoja 2: crea con cantidad y jornada; la capacidad (fórmula) se calcula y no se captura; duplicado y versión vieja (409) se rechazan", async () => {
      const r = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "2", weeklyHours: "42" }), {});
      if (!r.ok || r.result !== "created") throw new Error(JSON.stringify(r));
      recs["2"] = r.recId;
      const got = (await getEntry(app.db, owner, studyId, "2", r.recId))!;
      if (typeof got.row.computed.R !== "number" || got.row.computed.R <= 0 || got.row.computed.R >= 84) throw new Error(`capacidad ${got.row.computed.R}`);
      if (got.row.computed.V !== "OK") throw new Error(`estado ${got.row.computed.V}`);
      const up = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "3", weeklyHours: "42" }), { recId: r.recId, version: got.row.version });
      if (!up.ok || up.result !== "updated") throw new Error(JSON.stringify(up));
      const old = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "9", weeklyHours: "42" }), { recId: r.recId, version: got.row.version });
      if (old.ok || !old.conflict) throw new Error("aceptó una versión vieja");
    });

    await check("Hoja 2: repetir área, sede y cargo agrega otra fila de dotación (como en el libro) y ambas se conservan", async () => {
      const r = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position: "Cajero", headcount: "1", weeklyHours: "24" }), {});
      if (!r.ok || r.result !== "created") throw new Error(JSON.stringify(r));
      if ((await listEntries(app.db, owner, studyId, "2"))!.rows.length !== 2) throw new Error("no hay dos filas");
    });

    await check("Hoja 3: la actividad se crea con sus 50 campos posibles y el estado de captura (fórmula) sale de la hoja", async () => {
      const r = await saveEntry(app.db, owner, studyId, "3", cells("3", { kind: "REAL", code: "C-1", area: "Cajas", site: "S1", position: "Cajero", name: "Arqueo", calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "10", planning: "Planificada", loadShare: "50", reworkPct: "5 %" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      recs["3"] = r.recId;
      const got = (await getEntry(app.db, owner, studyId, "3", r.recId))!;
      if (typeof got.row.computed.C !== "string" || got.row.computed.C === "") throw new Error(`estado ${got.row.computed.C}`);
      if (got.row.cells[entryDef("3")!.fields.find((f) => f.field === "loadShare")!.col] !== 0.5) throw new Error("«50» en un porcentaje debe guardarse como 50 %");
    });

    for (const [id, values] of [
      ["5", { code: "C-1", direct: "Sí", hasIndicators: "Sí" }],
      ["6", { code: "C-1", situation: "1. Corresponde al cargo, requiere capacitación" }],
      ["7", { code: "C-1", impLegal: "5", probability: "3" }],
    ] as const) {
      await check(`Hoja ${id}: crea, edita con la versión vista, rechaza duplicado y versión vieja (409); las columnas calculadas aparecen`, async () => {
        const v = cells(id, values as Record<string, string>);
        const r = await saveEntry(app.db, owner, studyId, id, v, {});
        if (!r.ok) throw new Error(JSON.stringify(r));
        const dup = await saveEntry(app.db, owner, studyId, id, v, {});
        if (dup.ok) throw new Error("permitió duplicar la clave");
        const got = (await getEntry(app.db, owner, studyId, id, r.recId))!;
        if (got.row.computed.E !== "Arqueo") throw new Error(`nombre de la actividad (E) = ${got.row.computed.E}`);
        const up = await saveEntry(app.db, owner, studyId, id, v, { recId: r.recId, version: got.row.version });
        if (!up.ok) throw new Error(JSON.stringify(up));
        if (up.result === "updated") { const old = await saveEntry(app.db, owner, studyId, id, v, { recId: r.recId, version: got.row.version }); if (old.ok || !old.conflict) throw new Error("aceptó versión vieja"); }
        recs[id] = r.recId;
      });
    }

    await check("Hoja 7: criticidad, concentración y respaldo (fórmulas) se calculan a partir de lo capturado", async () => {
      const got = (await getEntry(app.db, owner, studyId, "7", recs["7"]))!;
      if (got.row.computed.T !== 5) throw new Error(`impacto máximo = ${got.row.computed.T}`);
      if (!got.row.computed.U) throw new Error("sin criticidad");
    });

    await check("Hoja 8: escala fuera de rango se rechaza y el código duplicado no se duplica", async () => {
      const bad = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-1", impact: "9" }), {});
      if (bad.ok) throw new Error("aceptó impacto 9");
      const ok = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-1", impact: "4", ease: "3", effort: "2", cost: "2", riskScore: "1", hours: "5" }), {});
      if (!ok.ok) throw new Error(JSON.stringify(ok));
      recs["8"] = ok.recId;
      const dup = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-1" }), {});
      if (dup.ok) throw new Error("duplicó");
      const got = (await getEntry(app.db, owner, studyId, "8", ok.recId))!;
      if (typeof got.row.computed.Z !== "number") throw new Error(`puntaje ${got.row.computed.Z}`);
    });

    await check("Hojas 9 y 10: rediseño por (tipo, área, cargo) con sus fórmulas y plan con fechas incoherentes rechazado", async () => {
      const r = await saveEntry(app.db, owner, studyId, "9", cells("9", { area: "Cajas", position: "Cajero", hoursOut: "2" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      recs["9"] = r.recId;
      const got = (await getEntry(app.db, owner, studyId, "9", r.recId))!;
      if (typeof got.row.computed.Q !== "number") throw new Error(`carga actual ${got.row.computed.Q}`);
      const bad = await saveEntry(app.db, owner, studyId, "10", cells("10", { code: "P-1", action: "x", start: "2026-02-01", end: "2026-01-01" }), {});
      if (bad.ok) throw new Error("aceptó fechas incoherentes");
      const ok = await saveEntry(app.db, owner, studyId, "10", cells("10", { code: "P-1", action: "x", start: "2026-01-01", end: "2026-02-01" }), {});
      if (!ok.ok) throw new Error(JSON.stringify(ok));
      recs["10"] = ok.recId;
      const g10 = (await getEntry(app.db, owner, studyId, "10", ok.recId))!;
      if (g10.row.computed.S !== 31) throw new Error(`duración ${g10.row.computed.S}`);
    });

    await check("Parámetros: se actualizan con control de versión y la reserva se guarda como fracción", async () => {
      const d = def("param");
      const [row] = await listRows(app.db, owner, studyId, d);
      const p = parseForm(d, fd({ reservePct: "15" })).values;
      if ((await saveRow(app.db, owner, studyId, d, p, row.version)) !== "updated") throw new Error("no actualizó");
      const [after] = await listRows(app.db, owner, studyId, d);
      if (Number(after.reservePct) !== 0.15) throw new Error(String(after.reservePct));
    });

    await check("Un viewer no puede crear ni borrar; el owner borra y quedan auditorías insert/update/delete con origen «app»", async () => {
      await rejects(saveEntry(app.db, viewer, studyId, "8", cells("8", { code: "V-1" }), {}), "42501");
      const del = await deleteEntry(app.db, viewer, studyId, "8", recs["8"]);
      if (del.ok) throw new Error("el viewer borró");
      const ok = await deleteEntry(app.db, owner, studyId, "8", recs["8"]);
      if (!ok.ok) throw new Error("el owner no pudo borrar");
      if ((await listEntries(app.db, owner, studyId, "8"))!.rows.length !== 0) throw new Error("la fila sigue");
      const a = await admin.db.execute(sql`select action, count(*)::int n from public.audit_log where study_id = ${studyId} and origin = 'app' group by action`);
      const by = Object.fromEntries((a as unknown as { action: string; n: number }[]).map((x) => [x.action, x.n]));
      if (!by.insert || !by.update || !by.delete) throw new Error(JSON.stringify(by));
    });

    await check("Las definiciones no repiten claves de campo ni columnas", () => {
      for (const s of SHEETS) if (new Set(s.fields.map((f) => f.key)).size !== s.fields.length) throw new Error(`claves repetidas en ${s.id}`);
      for (const id of ENTRY_IDS) { const d = entryDef(id)!; if (new Set(d.fields.map((f) => f.col)).size !== d.fields.length) throw new Error(`columnas repetidas en ${id}`); }
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
