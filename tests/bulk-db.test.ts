import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { runBulk } from "../src/server/entry/bulk";
import type { ParsedRow, ParsedShift, ParsedUpload } from "../src/server/entry/bulk-file";
import { check, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-72 — carga masiva con PostgreSQL real: la revisión no guarda nada; aplicar es todo o nada; actualizar existentes exige confirmación;
 * turnos y descripción de la operación (cargos) y turnos de la actividad; filas repetidas, cargo inexistente y capacidad; permisos. No deja datos.
 */
const d2 = entryDef("2")!, d3 = entryDef("3")!;
const col = (d: typeof d2, f: string) => d.fields.find((x) => x.field === f)!.col;
const cargo = (rowNo: number, position: string, headcount = "4", operation = "", extra: Record<string, string> = {}): ParsedRow => ({
  rowNo, operation, shiftsText: "", cells: { [col(d2, "area")]: "Cajas", [col(d2, "site")]: "Prado", [col(d2, "position")]: position, [col(d2, "headcount")]: headcount, [col(d2, "weeklyHours")]: "42", ...extra },
});
const actividad = (rowNo: number, code: string, position: string, shiftsText = ""): ParsedRow => ({
  rowNo, operation: "", shiftsText,
  cells: { [col(d3, "kind")]: "REAL", [col(d3, "code")]: code, [col(d3, "area")]: "Cajas", [col(d3, "site")]: "Prado", [col(d3, "position")]: position, [col(d3, "name")]: `Actividad ${code}`, [col(d3, "calcMode")]: "Por evento", [col(d3, "executions")]: "1", [col(d3, "period")]: "Día", [col(d3, "scope")]: "Por colaborador", [col(d3, "timeAvg")]: "5" },
});
const turno = (rowNo: number, position: string, name: string, start: string, end: string, days = "L-S", breakMin = "30"): ParsedShift => ({ rowNo, kind: "", area: "Cajas", site: "Prado", position, name, start, end, breakMin, days, type: "" });
const up = (rows: ParsedRow[], shifts: ParsedShift[] = []): ParsedUpload => ({ rows, shifts, fileErrors: [] });

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba carga masiva");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    const count = async (table: string) => ((await admin.db.execute(sql.raw(`select count(*)::int n from public.${table} where study_id = '${studyId}'`))) as unknown as { n: number }[])[0].n;
    const run = (hoja: EntryId, u: ParsedUpload, apply: boolean, allowUpdate = false, who = owner) => runBulk(app.db, who, studyId, hoja, u, { apply, allowUpdate });

    const fiscales = up([cargo(2, "Fiscal", "4", "Apertura con 5 cajas; cierre con 6.")], [turno(2, "Fiscal", "Apertura", "5:30", "13:00"), turno(3, "Fiscal", "Cierre", "13:00", "20:30", "L-S")]);

    await check("Revisión (sin aplicar): cuenta lo que se crearía y NO guarda nada", async () => {
      const r = await run("2", fiscales, false);
      if (r.committed || r.counts.create !== 1 || r.counts.error !== 0 || r.shiftCounts.create !== 2 || r.fileErrors.length) throw new Error(JSON.stringify(r));
      if ((await count("staffing_entries")) !== 0 || (await count("position_shifts")) !== 0 || (await count("positions")) !== 0) throw new Error("la revisión guardó datos");
    });

    await check("Aplicar: crea el cargo con su dotación, la descripción de la operación y los dos turnos (con días), y deja auditoría", async () => {
      const r = await run("2", fiscales, true);
      if (!r.committed || r.mirror.join() !== "2,3") throw new Error(JSON.stringify(r));
      if ((await count("staffing_entries")) !== 1 || (await count("position_shifts")) !== 2) throw new Error("no se guardó");
      const p = (await admin.db.execute(sql`select operation_description o from public.positions where study_id = ${studyId} and name = 'Fiscal'`)) as unknown as { o: string }[];
      if (p[0].o !== "Apertura con 5 cajas; cierre con 6.") throw new Error(p[0].o);
      const s = (await admin.db.execute(sql`select name, to_char(start_time, 'HH24:MI') s, days from public.position_shifts where study_id = ${studyId} order by name`)) as unknown as { name: string; s: string; days: number | null }[];
      if (s[0].name !== "Apertura" || s[0].s !== "05:30" || s[0].days !== 63 || s[1].name !== "Cierre") throw new Error(JSON.stringify(s)); // L-S = 63
      const a = (await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and entity = 'bulk_upload_2'`)) as unknown as { n: number }[];
      if (a[0].n !== 1) throw new Error(`auditoría ${a[0].n}`);
    });

    await check("Repetir el mismo archivo: todo «sin cambios» y se puede aplicar sin confirmar", async () => {
      const r = await run("2", fiscales, true);
      if (!r.committed || r.counts.unchanged !== 1 || r.counts.update !== 0 || r.shiftCounts.unchanged !== 2 || r.needsUpdateConfirm) throw new Error(JSON.stringify(r));
    });

    await check("Registros que ya existen: sin «Actualizar existentes» NO se aplica nada y se avisa; con la casilla se actualiza", async () => {
      const changed = up([cargo(2, "Fiscal", "5", "Apertura con 5 cajas; cierre con 6.")], [turno(2, "Fiscal", "Apertura", "5:30", "13:00"), turno(3, "Fiscal", "Cierre", "13:00", "21:00")]);
      const no = await run("2", changed, true, false);
      if (no.committed || !no.needsUpdateConfirm || no.counts.update !== 1 || no.shiftCounts.update !== 1) throw new Error(JSON.stringify(no));
      const still = (await admin.db.execute(sql`select headcount h from public.staffing_entries where study_id = ${studyId}`)) as unknown as { h: number }[];
      if (Number(still[0].h) !== 4) throw new Error("se actualizó sin confirmar");
      const yes = await run("2", changed, true, true);
      if (!yes.committed) throw new Error(JSON.stringify(yes));
      const now = (await admin.db.execute(sql`select headcount h from public.staffing_entries where study_id = ${studyId}`)) as unknown as { h: number }[];
      const cierre = (await admin.db.execute(sql`select to_char(end_time, 'HH24:MI') e from public.position_shifts where study_id = ${studyId} and name = 'Cierre'`)) as unknown as { e: string }[];
      if (Number(now[0].h) !== 5 || cierre[0].e !== "21:00") throw new Error(JSON.stringify([now, cierre]));
    });

    await check("Todo o nada: con una sola fila con error no se guarda NINGUNA (ni la buena), y se informa fila y motivo", async () => {
      const before = [await count("staffing_entries"), await count("positions")];
      const r = await run("2", up([cargo(2, "Cajero", "3"), cargo(3, "Cajero B", "")].map((x, i) => i === 1 ? { ...x, cells: { ...x.cells, [col(d2, "position")]: "" } } : x)), true);
      if (r.committed || r.counts.error !== 1 || r.counts.create !== 1 || !r.rows.find((x) => x.rowNo === 3)?.messages.join().includes("obligatorio")) throw new Error(JSON.stringify(r));
      if ((await count("staffing_entries")) !== before[0] || (await count("positions")) !== before[1]) throw new Error("guardó la fila buena");
    });

    await check("Turnos: cargo que no existe, días no válidos y turno repetido en el archivo se informan por fila", async () => {
      const r = await run("2", up([], [turno(2, "Inexistente", "Mañana", "06:00", "14:00"), turno(3, "Fiscal", "Nocturno", "22:00", "06:00", "festivos"), turno(4, "Fiscal", "Refuerzo", "10:00", "14:00"), turno(5, "Fiscal", "refuerzo", "10:00", "15:00")]), true);
      const msg = (n: number) => r.rows.find((x) => x.rowNo === n)?.messages.join(" ") ?? "";
      if (r.committed || r.shiftCounts.error !== 3 || !msg(2).includes("no existe") || !msg(3).includes("Días no válidos") || !msg(5).includes("repetido")) throw new Error(JSON.stringify(r.rows));
      if ((await count("position_shifts")) !== 2) throw new Error("guardó turnos con errores en el archivo");
    });

    await check("Actividades: turnos del cargo por nombre y «Todos los turnos»; un turno inexistente o una clave repetida son error", async () => {
      const ok = await run("3", up([actividad(2, "F-1", "Fiscal", "Apertura; Cierre"), actividad(3, "F-2", "Fiscal", "Todos los turnos"), actividad(4, "F-3", "Fiscal", "")]), true);
      if (!ok.committed || ok.counts.create !== 3) throw new Error(JSON.stringify(ok));
      const t = (await admin.db.execute(sql`select a.code, a.all_shifts, (select count(*)::int from public.activity_shifts s where s.activity_id = a.id) n from public.activities a where a.study_id = ${studyId} order by a.code`)) as unknown as { code: string; all_shifts: boolean; n: number }[];
      if (t[0].n !== 2 || t[0].all_shifts || !t[1].all_shifts || t[1].n !== 0 || t[2].all_shifts || t[2].n !== 0) throw new Error(JSON.stringify(t));
      const bad = await run("3", up([actividad(2, "F-4", "Fiscal", "Apertura; Madrugada"), actividad(3, "F-5", "Fiscal"), actividad(4, "F-5", "Fiscal")]), true);
      const msg = (n: number) => bad.rows.find((x) => x.rowNo === n)?.messages.join(" ") ?? "";
      if (bad.committed || bad.counts.error !== 2 || !msg(2).includes("Madrugada") || !msg(4).includes("repetida")) throw new Error(JSON.stringify(bad.rows));
      if ((await count("activities")) !== 3) throw new Error("guardó actividades de un archivo con errores");
    });

    await check("Actividades que ya existen: con turnos distintos se piden confirmación y luego se actualizan; en blanco no cambia los turnos", async () => {
      const upd = up([actividad(2, "F-1", "Fiscal", "Cierre"), actividad(3, "F-2", "Fiscal", "")]);
      const no = await run("3", upd, true, false);
      if (no.committed || !no.needsUpdateConfirm || no.counts.update !== 1 || no.counts.unchanged !== 1) throw new Error(JSON.stringify(no));
      const yes = await run("3", upd, true, true);
      if (!yes.committed) throw new Error(JSON.stringify(yes));
      const t = (await admin.db.execute(sql`select a.code, a.all_shifts, (select count(*)::int from public.activity_shifts s where s.activity_id = a.id) n from public.activities a where a.study_id = ${studyId} and a.code in ('F-1','F-2') order by a.code`)) as unknown as { code: string; all_shifts: boolean; n: number }[];
      if (t[0].n !== 1 || !t[1].all_shifts) throw new Error(JSON.stringify(t)); // F-1 quedó con 1 turno; F-2 (en blanco) conservó «Todos»
    });

    await check("Fase 2 · Medibilidad, Pertinencia y Riesgos (por código de actividad): crear, repetir = sin cambios, cambiar pide confirmación; un código de actividad que no existe es error y no se guarda nada", async () => {
      const gen = (hoja: "5" | "6" | "7" | "8" | "9" | "10", by: Record<string, string>, rowNo = 2): ParsedRow => { const d = entryDef(hoja)!; return { rowNo, operation: "", shiftsText: "", cells: Object.fromEntries(Object.entries(by).map(([f, v]) => [col(d, f), v])) }; };
      const base = { "5": { code: "F-1", direct: "Sí", hasIndicators: "Sí" }, "6": { code: "F-1", situation: "1. Corresponde al cargo, requiere capacitación" }, "7": { code: "F-1", impLegal: "5", probability: "3" } } as const;
      for (const h of ["5", "6", "7"] as const) {
        const a = await run(h, up([gen(h, base[h])]), true);
        if (!a.committed || a.counts.create !== 1) throw new Error(`${h} crear: ${JSON.stringify(a)}`);
        const b = await run(h, up([gen(h, base[h])]), true);
        if (!b.committed || b.counts.unchanged !== 1) throw new Error(`${h} repetir: ${JSON.stringify(b)}`);
        const miss = await run(h, up([gen(h, { ...base[h], code: "NO-EXISTE" })]), true);
        if (miss.committed || miss.counts.error !== 1) throw new Error(`${h} código inexistente: ${JSON.stringify(miss)}`);
      }
      const chg = await run("7", up([gen("7", { code: "F-1", impLegal: "2", probability: "3" })]), true, false);
      if (chg.committed || !chg.needsUpdateConfirm || chg.counts.update !== 1) throw new Error(JSON.stringify(chg));
      if (!(await run("7", up([gen("7", { code: "F-1", impLegal: "2", probability: "3" })]), true, true)).committed) throw new Error("no actualizó con la casilla");
      if ((await count("risk_assessments")) !== 1 || (await count("measurability_assessments")) !== 1 || (await count("suitability_assessments")) !== 1) throw new Error("conteos");

      // Oportunidades (código), Rediseño (área + cargo) y Plan de acción (código)
      const o = await run("8", up([gen("8", { code: "O-1", impact: "4", ease: "3", effort: "2", cost: "2", riskScore: "1", hours: "5" })]), true);
      const r = await run("9", up([gen("9", { area: "Cajas", position: "Fiscal", hoursOut: "2" })]), true);
      const p = await run("10", up([gen("10", { code: "P-1", action: "Capacitar", start: "2026-01-01", end: "2026-02-01" })]), true);
      if (!o.committed || !r.committed || !p.committed) throw new Error(JSON.stringify([o.fileErrors, r.rows, p.rows]));
      const again = await run("9", up([gen("9", { area: "Cajas", position: "Fiscal", hoursOut: "3" })]), true, false);
      if (again.committed || !again.needsUpdateConfirm || again.counts.update !== 1 || (await count("redesign_proposals")) !== 1) throw new Error("rediseño: la clave área+cargo debía coincidir con el existente");
      const bad = await run("10", up([gen("10", { code: "P-2", action: "x", start: "2026-02-01", end: "2026-01-01" }, 2), gen("10", { code: "P-3", action: "Otra", start: "2026-01-01", end: "2026-02-01" }, 3)]), true);
      if (bad.committed || bad.counts.error !== 1 || (await count("action_items")) !== 1) throw new Error("plan de acción: debía ser todo o nada");
    });

    await check("Centro de operaciones (D-75) en la carga masiva de oportunidades: se guarda, en blanco no lo cambia y uno desconocido es error", async () => {
      const d8 = entryDef("8")!;
      const r8 = (rowNo: number, code: string, site: string): ParsedRow => ({ rowNo, operation: "", shiftsText: "", cells: { [col(d8, "code")]: code, [col(d8, "site")]: site } });
      const siteOf = async (code: string) => ((await admin.db.execute(sql`select s.name n from public.improvement_opportunities o left join public.sites s on s.id = o.site_id where o.study_id = ${studyId} and o.code = ${code}`)) as unknown as { n: string | null }[])[0]?.n ?? null;
      const a = await run("8", up([r8(2, "O-9", "prado")]), true);                       // sin distinguir mayúsculas
      if (!a.committed || a.counts.create !== 1 || (await siteOf("O-9")) !== "Prado") throw new Error(JSON.stringify(a));
      const b = await run("8", up([r8(2, "O-9", "")]), true, true);                      // en blanco: no cambia el actual
      if (!b.committed || (await siteOf("O-9")) !== "Prado") throw new Error("el blanco no debía quitar el centro de operaciones");
      const c = await run("8", up([r8(2, "O-10", "Inventado")]), true);
      if (c.committed || c.counts.error !== 1 || !c.rows[0].messages.join().includes("no está registrado") || (await siteOf("O-10")) !== null) throw new Error(JSON.stringify(c));
    });

    await check("Capacidad: más filas nuevas de las que admite la hoja de Google (200 en cargos) se rechazan antes de guardar", async () => {
      const rows = Array.from({ length: 205 }, (_, i) => cargo(i + 2, `Cargo ${i}`));
      const r = await run("2", up(rows), true);
      if (r.committed || !r.fileErrors.join().includes("admite máximo 200")) throw new Error(JSON.stringify(r.fileErrors));
    });

    await check("Un viewer no puede aplicar: ninguna fila se guarda y se informa error", async () => {
      const before = await count("positions");
      const r = await run("2", up([cargo(2, "Solo lectura")]), true, false, viewer);
      if (r.committed || r.counts.error !== 1 || (await count("positions")) !== before) throw new Error(JSON.stringify(r));
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
