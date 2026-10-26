import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createStudy } from "../src/server/studies";
import { entryDef, type EntryId } from "../src/server/entry/defs";
import { saveEntry } from "../src/server/entry/service";
import { activityShiftSelection, deleteShift, listShifts, saveShift, setActivityShifts, shiftTextByActivityCode, shiftsByPosition } from "../src/server/shifts";
import { withRls } from "../src/db/client";
import { check, rejects, summary, URL_ADMIN, URL_APP } from "./helpers";

/**
 * D-67 — turnos del cargo y turnos de cada actividad, con PostgreSQL real: crear/editar/duplicado, selección en la actividad («Todos los turnos»
 * o lista), turnos de otro cargo descartados, eliminar un turno en uso (pide confirmación y se quita de las actividades), permisos (viewer) y
 * cascada al borrar el cargo. No deja datos.
 */
const cells = (id: EntryId, byField: Record<string, string>) => {
  const d = entryDef(id)!; const out: Record<string, string> = {};
  for (const [f, v] of Object.entries(byField)) { const x = d.fields.find((y) => y.field === f); if (!x) throw new Error(`${id}: no hay campo ${f}`); out[x.col] = v; }
  return out;
};
const T = (name: string, start = "", end = "", breakMin = "") => ({ name, start, end, breakMin });

async function main() {
  const admin = createDb(URL_ADMIN, 2), app = createDb(URL_APP, 4);
  const owner = randomUUID(), viewer = randomUUID();
  for (const id of [owner, viewer]) await admin.db.execute(sql`insert into auth.users (id) values (${id})`);
  let studyId = "";
  try {
    studyId = await createStudy(app.db, owner, "Estudio de prueba turnos");
    await admin.db.execute(sql`insert into public.memberships (study_id, user_id, role) values (${studyId}, ${viewer}, 'viewer')`);
    const pos = async (position: string) => {
      const r = await saveEntry(app.db, owner, studyId, "2", cells("2", { area: "Cajas", site: "S1", position, headcount: "3", weeklyHours: "42" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      const [p] = (await admin.db.execute(sql`select id from public.positions where study_id = ${studyId} and name = ${position}`)) as unknown as { id: string }[];
      return p.id;
    };
    const act = async (code: string, position: string) => {
      const r = await saveEntry(app.db, owner, studyId, "3", cells("3", { kind: "REAL", code, area: "Cajas", site: "S1", position, name: `Actividad ${code}`, calcMode: "Por evento", executions: "1", period: "Día", scope: "Por colaborador", timeAvg: "5" }), {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      return r.recId;
    };
    const fiscal = await pos("Fiscal de piso"), otro = await pos("Cajero");
    const a1 = await act("F-1", "Fiscal de piso"), a2 = await act("F-2", "Fiscal de piso"), a3 = await act("F-3", "Fiscal de piso");
    const ids: Record<string, string> = {};

    await check("Crear turnos del cargo con horario y receso; la hora «5:30» queda como 05:30; se listan en orden", async () => {
      for (const [n, s, e] of [["Apertura", "5:30", "13:00"], ["Intermedio", "09:00", "16:30"], ["Cierre", "13:00", "20:30"]]) {
        const r = await saveShift(app.db, owner, studyId, fiscal, undefined, T(n, s, e, "30"));
        if (!r.ok) throw new Error(JSON.stringify(r));
      }
      const l = await listShifts(app.db, owner, studyId, fiscal);
      if (l.map((x) => x.name).join() !== "Apertura,Intermedio,Cierre" || l[0].start !== "05:30" || l[0].end !== "13:00" || l[0].breakMin !== 30) throw new Error(JSON.stringify(l));
      for (const x of l) ids[x.name] = x.id;
    });

    await check("Rechaza: nombre repetido (sin distinguir mayúsculas), hora inválida y el nombre reservado «Todos los turnos»", async () => {
      for (const t of [T("apertura"), T("X", "25:00", "13:00"), T("Todos los turnos")]) {
        const r = await saveShift(app.db, owner, studyId, fiscal, undefined, t);
        if (r.ok) throw new Error(`aceptó ${JSON.stringify(t)}`);
      }
      if ((await listShifts(app.db, owner, studyId, fiscal)).length !== 3) throw new Error("se creó un turno inválido");
    });

    await check("Editar un turno cambia sus datos y deja auditoría con origen «app»", async () => {
      const r = await saveShift(app.db, owner, studyId, fiscal, ids["Cierre"], T("Cierre", "13:00", "20:30", "45"));
      if (!r.ok) throw new Error(JSON.stringify(r));
      if ((await listShifts(app.db, owner, studyId, fiscal)).find((x) => x.name === "Cierre")?.breakMin !== 45) throw new Error("no cambió");
      const a = (await admin.db.execute(sql`select count(*)::int n from public.audit_log where study_id = ${studyId} and origin = 'app' and entity = 'position_shift'`)) as unknown as { n: number }[];
      if (a[0].n < 4) throw new Error(`auditoría ${a[0].n}`);
    });

    await check("Actividad con varios turnos: se guardan y se leen; el texto sale ordenado", async () => {
      const r = await setActivityShifts(app.db, owner, studyId, a1, { all: false, ids: [ids["Cierre"], ids["Apertura"]] });
      if (!r.ok) throw new Error(JSON.stringify(r));
      const s = await activityShiftSelection(app.db, owner, studyId, a1);
      if (s.all || s.ids.length !== 2) throw new Error(JSON.stringify(s));
      const txt = await withRls(app.db, { sub: owner }, (tx) => shiftTextByActivityCode(tx, studyId));
      if (txt.get("F-1") !== "Apertura, Cierre" || txt.has("F-2")) throw new Error(JSON.stringify([...txt]));
    });

    await check("«Todos los turnos»: la actividad queda marcada y sin turnos sueltos; un turno agregado después también aplica", async () => {
      await setActivityShifts(app.db, owner, studyId, a2, { all: false, ids: [ids["Apertura"]] });
      const r = await setActivityShifts(app.db, owner, studyId, a2, { all: true, ids: [ids["Apertura"]] });
      if (!r.ok) throw new Error(JSON.stringify(r));
      const s = await activityShiftSelection(app.db, owner, studyId, a2);
      if (!s.all || s.ids.length !== 0) throw new Error(JSON.stringify(s));
      await saveShift(app.db, owner, studyId, fiscal, undefined, T("Refuerzo", "10:00", "14:00"));
      const txt = await withRls(app.db, { sub: owner }, (tx) => shiftTextByActivityCode(tx, studyId));
      if (txt.get("F-2") !== "Todos los turnos") throw new Error(txt.get("F-2"));
    });

    await check("Un turno de otro cargo se descarta (y se avisa); no se guarda en la actividad", async () => {
      const other = await saveShift(app.db, owner, studyId, otro, undefined, T("Mañana", "06:00", "14:00"));
      if (!other.ok) throw new Error(JSON.stringify(other));
      const foreign = (await listShifts(app.db, owner, studyId, otro))[0].id;
      const r = await setActivityShifts(app.db, owner, studyId, a3, { all: false, ids: [foreign, ids["Intermedio"]] });
      if (!r.ok || r.notices.length !== 1) throw new Error(JSON.stringify(r));
      const s = await activityShiftSelection(app.db, owner, studyId, a3);
      if (s.ids.join() !== ids["Intermedio"]) throw new Error(JSON.stringify(s));
    });

    await check("El selector del formulario ofrece los turnos por cargo (con tipo de dato, área, sede y cargo)", async () => {
      const p = await shiftsByPosition(app.db, owner, studyId);
      const f = p.find((x) => x.position === "Fiscal de piso");
      if (!f || f.kind !== "real" || f.area !== "Cajas" || f.site !== "S1" || f.shifts.length !== 4) throw new Error(JSON.stringify(p));
    });

    await check("Eliminar un turno en uso pide confirmación; al confirmar se quita de las actividades y estas conservan los demás", async () => {
      const first = await deleteShift(app.db, owner, studyId, ids["Apertura"], false);
      if (first.ok || !("needsConfirm" in first) || first.needsConfirm !== 1) throw new Error(JSON.stringify(first));
      const done = await deleteShift(app.db, owner, studyId, ids["Apertura"], true);
      if (!done.ok || done.removedFrom !== 1) throw new Error(JSON.stringify(done));
      const s = await activityShiftSelection(app.db, owner, studyId, a1);
      if (s.ids.join() !== ids["Cierre"]) throw new Error(JSON.stringify(s));
    });

    await check("Un viewer ve los turnos pero no puede crear, editar ni asignar", async () => {
      if ((await listShifts(app.db, viewer, studyId, fiscal)).length === 0) throw new Error("el viewer no ve los turnos");
      await rejects(saveShift(app.db, viewer, studyId, fiscal, undefined, T("Nocturno", "22:00", "06:00")), "42501");
      await rejects(setActivityShifts(app.db, viewer, studyId, a1, { all: true, ids: [] }), "42501");
    });

    await check("Borrar el cargo borra sus turnos y los vínculos de las actividades (cascada)", async () => {
      await admin.db.execute(sql`delete from public.activities where study_id = ${studyId} and position_id = ${fiscal}`);
      await admin.db.execute(sql`delete from public.positions where id = ${fiscal}`);
      const r = (await admin.db.execute(sql`select (select count(*)::int from public.position_shifts where position_id = ${fiscal}) s, (select count(*)::int from public.activity_shifts where study_id = ${studyId}) l`)) as unknown as { s: number; l: number }[];
      if (r[0].s !== 0 || r[0].l !== 0) throw new Error(JSON.stringify(r));
    });
  } finally {
    if (studyId) await admin.db.execute(sql`delete from public.studies where id = ${studyId}`);
    await admin.db.execute(sql`delete from auth.users where id in (${owner}, ${viewer})`);
    await admin.client.end(); await app.client.end();
  }
}
main().then(summary).catch((e) => { console.error(e); process.exit(1); });
