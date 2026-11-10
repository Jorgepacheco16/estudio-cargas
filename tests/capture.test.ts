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
        const got = d.fields.filter((f) => !f.extra).map((f) => f.col).sort(); // sin los campos propios de la aplicación (centro de operaciones, D-75)
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

    await check("Umbral de sobrecarga (D-103): admite hasta 200 % (105 % para tolerar un poco de sobrecarga) y dice el límite real; los demás porcentajes siguen limitados a 100 %", () => {
      const field = (o: Record<string, string>, label: string) => parseForm(def("param"), fd(o)).errors.filter((e) => e.startsWith(label)).join(" | ");
      for (const [txt, guardado] of [["105", "1.0500"], ["105 %", "1.0500"], ["100", "1.0000"], ["200", "2.0000"], ["110,5", "1.1050"]] as const) {
        const r = parseForm(def("param"), fd({ overloadThreshold: txt }));
        if (field({ overloadThreshold: txt }, "Umbral de sobrecarga") !== "" || r.values.overloadThreshold !== guardado) throw new Error(`${txt}: ${JSON.stringify(r)}`);
      }
      for (const txt of ["200,5", "250", "-1", "abc", "1%2%"]) {
        const e = field({ overloadThreshold: txt }, "Umbral de sobrecarga");
        if (!e) throw new Error(`${txt} debía rechazarse`);
        if (/^[\d,.]+$/.test(txt) && !e.includes("entre 0 y 200")) throw new Error(`el mensaje debía decir el límite real (200): ${e}`);
      }
      if (!field({ reservePct: "101" }, "Reserva").includes("entre 0 y 100") || !field({ lowLoadThreshold: "101" }, "Umbral de carga baja").includes("entre 0 y 100")) throw new Error("los demás porcentajes siguen en 100");
      const campo = def("param").fields.find((f) => f.key === "overloadThreshold")!;
      if (!/105 %/.test(campo.hint ?? "") || !/Dotación requerida/.test(campo.hint ?? "")) throw new Error("la ayuda del campo debe explicar el uso del umbral");
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

    await check("Fracción desde la cual se suma una persona (D-108): se escribe en % y se guarda como fracción de 0 a 1; no admite más de 100 % y explica el redondeo", () => {
      for (const [txt, guardado] of [["50", "0.5000"], ["50 %", "0.5000"], ["0", "0.0000"], ["100", "1.0000"], ["33,5", "0.3350"]] as const) {
        const r = parseForm(def("param"), fd({ staffRoundFrom: txt }));
        if (r.errors.some((e) => e.startsWith("Fracción")) || r.values.staffRoundFrom !== guardado) throw new Error(`${txt}: ${JSON.stringify(r)}`);
      }
      for (const txt of ["101", "-5", "abc"]) if (!parseForm(def("param"), fd({ staffRoundFrom: txt })).errors.some((e) => e.startsWith("Fracción"))) throw new Error(txt + " debía rechazarse");
      if (!parseForm(def("param"), fd({ staffRoundFrom: "101" })).errors.join(" ").includes("entre 0 y 100")) throw new Error("el mensaje debía decir el límite");
      const campo = def("param").fields.find((f) => f.key === "staffRoundFrom")!;
      if (!/5,4/.test(campo.hint ?? "") || !/5,5/.test(campo.hint ?? "")) throw new Error("la ayuda debe dar el ejemplo 5,4 → 5 y 5,5 → 6");
    });

    await check("Horas compartidas entre las tareas de una persona (D-110): admite de 0 a 12 h, rechaza lo demás y explica el ejemplo", () => {
      for (const [txt, guardado] of [["3", "3"], ["0", "0"], ["12", "12"], ["2,5", "2.5"]] as const) {
        const r = parseForm(def("param"), fd({ minSharedHours: txt }));
        if (r.errors.some((e) => e.startsWith("Horas compartidas")) || r.values.minSharedHours !== guardado) throw new Error(`${txt}: ${JSON.stringify(r)}`);
      }
      for (const txt of ["13", "-1", "abc"]) if (!parseForm(def("param"), fd({ minSharedHours: txt })).errors.some((e) => e.startsWith("Horas compartidas"))) throw new Error(txt + " debía rechazarse");
      const campo = def("param").fields.find((f) => f.key === "minSharedHours")!;
      if (!/apertura/.test(campo.hint ?? "") || !/cierre/.test(campo.hint ?? "")) throw new Error("la ayuda debe dar el ejemplo de apertura, tesorería y cierre");
    });

    studyId = await createStudy(app.db, owner, "Estudio de prueba captura");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    const recs: Record<string, string> = {};

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

    await check("Cargo secundario: si ya existe con ese nombre en otra área se usa ese, no se crea uno nuevo bajo el área de la actividad", async () => {
      const base = { kind: "REAL", site: "S1", executions: "1", period: "Día", calcMode: "Por evento", scope: "Por colaborador", timeAvg: "5" };
      const a = await saveEntry(app.db, owner, studyId, "3", cells("3", { ...base, code: "D-1", area: "Domicilios", position: "Auxiliar de domicilios", name: "Entregar pedido" }), {});
      if (!a.ok) throw new Error(JSON.stringify(a));
      const b = await saveEntry(app.db, owner, studyId, "3", cells("3", { ...base, code: "D-2", area: "Cajas", position: "Cajero", name: "Validar pedido", secondaryPosition: "Auxiliar de domicilios" }), {});
      if (!b.ok) throw new Error(JSON.stringify(b));
      const rows = (await admin.db.execute(sql`select a.name area from public.positions p join public.areas a on a.id = p.area_id where p.study_id = ${studyId} and lower(p.name) = 'auxiliar de domicilios'`)) as unknown as { area: string }[];
      if (rows.length !== 1 || rows[0].area !== "Domicilios") throw new Error(JSON.stringify(rows));
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
      const ok = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-1", area: "Cajas", site: "S1", position: "Cajero", impact: "4", ease: "3", effort: "2", cost: "2", riskScore: "1", hours: "5" }), {});
      if (!ok.ok) throw new Error(JSON.stringify(ok));
      recs["8"] = ok.recId;
      const dup = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-1", area: "Cajas", site: "S1", position: "Cajero" }), {});
      if (dup.ok) throw new Error("duplicó");
      const got = (await getEntry(app.db, owner, studyId, "8", ok.recId))!;
      if (typeof got.row.computed.Z !== "number") throw new Error(`puntaje ${got.row.computed.Z}`);
    });

    await check("Hojas 9 y 10: rediseño por (tipo, área, cargo) con sus fórmulas y plan con fechas incoherentes rechazado", async () => {
      const r = await saveEntry(app.db, owner, studyId, "9", cells("9", { area: "Cajas", site: "S1", position: "Cajero", hoursOut: "2" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      recs["9"] = r.recId;
      const got = (await getEntry(app.db, owner, studyId, "9", r.recId))!;
      if (typeof got.row.computed.Q !== "number") throw new Error(`carga actual ${got.row.computed.Q}`);
      const bad = await saveEntry(app.db, owner, studyId, "10", cells("10", { code: "P-1", action: "x", area: "Cajas", site: "S1", position: "Cajero", start: "2026-02-01", end: "2026-01-01" }), {});
      if (bad.ok) throw new Error("aceptó fechas incoherentes");
      const ok = await saveEntry(app.db, owner, studyId, "10", cells("10", { code: "P-1", action: "x", area: "Cajas", site: "S1", position: "Cajero", start: "2026-01-01", end: "2026-02-01" }), {});
      if (!ok.ok) throw new Error(JSON.stringify(ok));
      recs["10"] = ok.recId;
      const g10 = (await getEntry(app.db, owner, studyId, "10", ok.recId))!;
      if (g10.row.computed.S !== 31) throw new Error(`duración ${g10.row.computed.S}`);
    });

    await check("Amarre al origen (D-90): la oportunidad toma área, centro y cargo de su actividad; el plan, de su oportunidad; un valor distinto o un cargo que no existe se rechaza y lo obligatorio no se omite", async () => {
      const d8 = entryDef("8")!, d10 = entryDef("10")!;
      const val = (d: typeof d8, row: { cells: Record<string, unknown> }, f: string) => String(row.cells[d.fields.find((x) => x.field === f)!.col] ?? "");
      const o = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-2", activityCode: "C-1" }), {});
      if (!o.ok) throw new Error("la oportunidad con actividad debía tomar el amarre de ella: " + JSON.stringify(o));
      const go = (await getEntry(app.db, owner, studyId, "8", o.recId))!.row;
      if (val(d8, go, "area") !== "Cajas" || val(d8, go, "site") !== "S1" || val(d8, go, "position") !== "Cajero") throw new Error(JSON.stringify(go.cells));
      const p = await saveEntry(app.db, owner, studyId, "10", cells("10", { code: "P-2", action: "y", finding: "O-2" }), {});
      if (!p.ok) throw new Error("el plan con su oportunidad de origen debía tomar el amarre de ella: " + JSON.stringify(p));
      const gp = (await getEntry(app.db, owner, studyId, "10", p.recId))!.row;
      if (val(d10, gp, "area") !== "Cajas" || val(d10, gp, "site") !== "S1" || val(d10, gp, "position") !== "Cajero") throw new Error(JSON.stringify(gp.cells));
      const clash = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-3", activityCode: "C-1", area: "Domicilios" }), {});
      if (clash.ok || !clash.errors.join().includes("no coincide")) throw new Error("aceptó un área distinta a la de la actividad");
      const none = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-4" }), {});
      if (none.ok || !none.errors.join().includes("obligatorio")) throw new Error("aceptó una oportunidad sin área, centro ni cargo");
      const noPos = await saveEntry(app.db, owner, studyId, "10", cells("10", { code: "P-3", action: "z", area: "Cajas", site: "S1", position: "Inexistente" }), {});
      if (noPos.ok || !noPos.errors.join().includes("no está registrado")) throw new Error("aceptó un cargo que no existe en Cargos y dotación");
      const several = await saveEntry(app.db, owner, studyId, "8", cells("8", { code: "O-5", area: "Cajas", site: "S1", position: "Cajero; Otro cargo afectado" }), {});
      if (!several.ok) throw new Error("con varios cargos, el primero debía ser el principal: " + JSON.stringify(several));
      for (const [id, rec] of [["8", o.recId], ["10", p.recId], ["8", several.recId]] as const) { const del = await deleteEntry(app.db, owner, studyId, id, rec); if (!del.ok) throw new Error("no se pudo limpiar " + id); } // deja el estudio como lo encontró la prueba siguiente
    });

    await check("Parámetros: se actualizan con control de versión y la reserva se guarda como fracción", async () => {
      const d = def("param");
      const [row] = await listRows(app.db, owner, studyId, d);
      const p = parseForm(d, fd({ reservePct: "15" })).values;
      if ((await saveRow(app.db, owner, studyId, d, p, row.version)) !== "updated") throw new Error("no actualizó");
      const [after] = await listRows(app.db, owner, studyId, d);
      if (Number(after.reservePct) !== 0.15) throw new Error(String(after.reservePct));
    });

    await check("Fracción para sumar una persona (D-108): un estudio nuevo trae 50 %, se actualiza como los demás parámetros y la base rechaza más de 100 %", async () => {
      const d = def("param");
      const [row] = await listRows(app.db, owner, studyId, d);
      if (Number(row.staffRoundFrom) !== 0.5) throw new Error("por defecto debía ser 0,5: " + String(row.staffRoundFrom));
      if ((await saveRow(app.db, owner, studyId, d, parseForm(d, fd({ staffRoundFrom: "30" })).values, row.version)) !== "updated") throw new Error("no actualizó");
      const [after] = await listRows(app.db, owner, studyId, d);
      if (Number(after.staffRoundFrom) !== 0.3) throw new Error(String(after.staffRoundFrom));
      await rejects(admin.db.execute(sql`update public.study_parameters set staff_round_from = 1.5 where study_id = ${studyId}`), "23514");
    });

    await check("Horas compartidas (D-110): un estudio nuevo trae 3 h, se actualiza como los demás parámetros y la base rechaza más de 12", async () => {
      const d = def("param");
      const [row] = await listRows(app.db, owner, studyId, d);
      if (Number(row.minSharedHours) !== 3) throw new Error("por defecto debía ser 3: " + String(row.minSharedHours));
      if ((await saveRow(app.db, owner, studyId, d, parseForm(d, fd({ minSharedHours: "4" })).values, row.version)) !== "updated") throw new Error("no actualizó");
      const [after] = await listRows(app.db, owner, studyId, d);
      if (Number(after.minSharedHours) !== 4) throw new Error(String(after.minSharedHours));
      await rejects(admin.db.execute(sql`update public.study_parameters set min_shared_hours = 13 where study_id = ${studyId}`), "23514");
    });

    await check("Un viewer no puede crear ni borrar; el owner borra y quedan auditorías insert/update/delete con origen «app»", async () => {
      await rejects(saveEntry(app.db, viewer, studyId, "8", cells("8", { code: "V-1", area: "Cajas", site: "S1", position: "Cajero" }), {}), "42501");
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
