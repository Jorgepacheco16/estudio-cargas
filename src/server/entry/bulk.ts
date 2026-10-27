/**
 * Carga masiva (D-72): revisa y aplica el archivo leído por bulk-file.ts. TODO O NADA: todo corre en una sola transacción con RLS y solo se
 * confirma si no hay ningún error y, cuando hay registros que ya existen, si la persona marcó «Actualizar existentes». La revisión previa usa el
 * mismo código que la aplicación, pero siempre se revierte. Cada fila corre en un punto de guardado para poder informar SU error sin romper el resto.
 */
import { and, eq, sql } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../../db/client";
import { activities, areas, auditLog, positionShifts, positions, sites, staffingEntries } from "../../db/schema";
import { LONG_TEXT_MAX } from "../../domain/limits";
import { ALL_SHIFTS, parseDaysText, parseShift } from "../../domain/shifts";
import { saveShiftTx, setActivityShiftsTx } from "../shifts";
import { BULK_MAX_ROWS, type BulkSheet, type ParsedUpload } from "./bulk-file";
import { entryDef, type EntryId } from "./defs";
import { persistEntry, siteExtra, validateRaw } from "./service";

export interface BulkRowReport { sheet: "Datos" | "Turnos"; rowNo: number; label: string; action: "create" | "update" | "unchanged" | "error"; messages: string[] }
export interface Counts { create: number; update: number; unchanged: number; error: number }
export interface BulkReport {
  hoja: BulkSheet; counts: Counts; shiftCounts: Counts; rows: BulkRowReport[]; fileErrors: string[];
  /** ¿Se guardó? (solo con apply, sin errores y con la confirmación de actualizar si hacía falta). */
  committed: boolean;
  /** Hay registros que ya existen y falta marcar «Actualizar existentes». */
  needsUpdateConfirm: boolean;
  /** Hojas de Google que hay que refrescar tras guardar. */
  mirror: EntryId[];
}

class RowFail extends Error { constructor(public errors: string[]) { super("fila"); } }
const ROLLBACK = new Error("BULK_ROLLBACK");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const empty = (): Counts => ({ create: 0, update: 0, unchanged: 0, error: 0 });

/** Ejecuta una fila en un punto de guardado: si falla, solo esa fila se revierte. */
async function attempt<T>(tx: Tx, fn: (sp: Tx) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; errors: string[] }> {
  try { return { ok: true, value: await tx.transaction((sp) => fn(sp as unknown as Tx)) }; }
  catch (e) { return { ok: false, errors: e instanceof RowFail ? e.errors : ["No se pudo guardar esta fila. Revise sus datos."] }; }
}

export async function runBulk(db: Db, sub: string, studyId: string, hoja: BulkSheet, parsed: ParsedUpload, opts: { apply: boolean; allowUpdate: boolean }): Promise<BulkReport> {
  const def = entryDef(hoja)!;
  const report: BulkReport = { hoja, counts: empty(), shiftCounts: empty(), rows: [], fileErrors: [...parsed.fileErrors], committed: false, needsUpdateConfirm: false, mirror: [] };
  if (report.fileErrors.length) return report;
  const field = (name: string) => def.fields.find((f) => f.field === name)!.col;
  const labelOf = (cells: Record<string, string>) => hoja === "2" ? [cells[field("area")], cells[field("site")], cells[field("position")]].filter(Boolean).join(" · ") || "(sin datos)"
    : hoja === "3" ? [cells[field("code")], cells[field("name")]].filter(Boolean).join(" · ") || "(sin código)"
      : def.listFields.map((f) => cells[field(f)]).filter(Boolean).join(" · ") || "(sin datos)";
  const add = (sheet: "Datos" | "Turnos", rowNo: number, label: string, action: BulkRowReport["action"], messages: string[] = []) => {
    report.rows.push({ sheet, rowNo, label, action, messages });
    (sheet === "Datos" ? report.counts : report.shiftCounts)[action]++;
  };

  try {
    await withRls(db, { sub }, async (tx) => {
      const existingBefore = (await def.adapter.all(tx, studyId)).length;
      const seen = new Map<string, number>(); // id del registro → fila del archivo que lo tocó primero

      for (const r of parsed.rows) {
        const label = labelOf(r.cells);
        if (r.error) { add("Datos", r.rowNo, label, "error", [r.error]); continue; }
        const v = validateRaw(def, r.cells);
        if (!v.ok) { add("Datos", r.rowNo, label, "error", v.errors); continue; }
        const res = await attempt(tx, async (sp) => {
          // Cargos (hoja 2): no tienen código; la clave es tipo de dato + área + sede + cargo + código del colaborador (si lo trae). Si ya hay UNA fila con esa
          // clave se actualiza; si hay varias no se adivina (error); si no hay, se crea.
          let ref: { recId?: string; version?: number; matchExisting?: boolean; extra?: Record<string, unknown> } = { matchExisting: true };
          if (hoja === "2") {
            const found = await findStaffing(sp, studyId, v.row.s("kind") === "demo" ? "demo" : "real", v.row.s("area") ?? "", v.row.s("site") ?? "", v.row.s("position") ?? "", v.row.s("employeeCode") ?? "");
            if (found.length > 1) throw new RowFail(["Ya hay varias filas de dotación con esta clave (tipo, área, sede, cargo y código del colaborador). Edítelas en la aplicación o indique el código del colaborador."]);
            ref = found.length === 1 ? { recId: found[0].id, version: found[0].version } : {};
          }
          const sx = await siteExtra(sp, studyId, def, r.cells, true); // D-75: centro de operaciones (8, 9 y 10); en blanco no cambia el actual
          if ("error" in sx) throw new RowFail([sx.error]);
          ref = { ...ref, extra: sx.extra };
          const saved = await persistEntry(sp, sub, studyId, def, v.row, ref);
          if (!saved.ok) throw new RowFail(saved.errors);
          if (seen.has(saved.recId)) throw new RowFail([`Fila repetida: tiene la misma clave que la fila ${seen.get(saved.recId)}.`]);
          let action: BulkRowReport["action"] = saved.result === "created" ? "create" : saved.result === "updated" ? "update" : "unchanged";
          const bump = (changed: boolean) => { if (changed && action === "unchanged") action = "update"; };
          if (hoja === "2" && r.operation.trim() !== "") bump(await setOperation(sp, sub, studyId, saved.recId, r.operation));
          if (hoja === "3" && r.shiftsText.trim() !== "") bump(await setActivityShiftsFromText(sp, sub, studyId, saved.recId, r.shiftsText));
          return { id: saved.recId, action, notices: saved.notices };
        });
        if (!res.ok) { add("Datos", r.rowNo, label, "error", res.errors); continue; }
        seen.set(res.value.id, r.rowNo);
        add("Datos", r.rowNo, label, res.value.action, res.value.notices);
      }

      if (hoja === "2") {
        const seenShift = new Map<string, number>();
        for (const s of parsed.shifts) {
          const label = [s.area, s.site, s.position, s.name].filter(Boolean).join(" · ") || "(sin datos)";
          const bad = Object.values(s).find((x) => typeof x === "string" && x.startsWith("⚠"));
          if (bad) { add("Turnos", s.rowNo, label, "error", [String(bad).slice(1)]); continue; }
          const missing = ([["Área", s.area], ["Sede", s.site], ["Cargo", s.position], ["Nombre del turno", s.name]] as const).filter(([, x]) => x === "").map(([n]) => n);
          if (missing.length) { add("Turnos", s.rowNo, label, "error", [`Falta: ${missing.join(", ")}.`]); continue; }
          const days = parseDaysText(s.days);
          if (!days) { add("Turnos", s.rowNo, label, "error", [`Días no válidos «${s.days}»: use Todos, L-S, L-V, «L, X, V» o Domingo.`]); continue; }
          const p = parseShift({ name: s.name, start: s.start, end: s.end, breakMin: s.breakMin, days });
          if (!p.ok) { add("Turnos", s.rowNo, label, "error", p.errors); continue; }
          const res = await attempt(tx, async (sp) => {
            const kind = norm(s.kind) === "demo" ? "demo" : "real";
            const [pos] = await sp.select({ id: positions.id }).from(positions).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
              .where(and(eq(positions.studyId, studyId), eq(positions.dataKind, kind), sql`lower(btrim(${areas.name})) = ${norm(s.area)}`, sql`lower(btrim(${sites.name})) = ${norm(s.site)}`, sql`lower(btrim(${positions.name})) = ${norm(s.position)}`));
            if (!pos) throw new RowFail(["El cargo no existe: debe estar en la hoja «Datos» de este archivo o ya registrado en la aplicación (mismo tipo de dato, área, sede y cargo)."]);
            const dup = `${pos.id}|${norm(s.name)}`;
            if (seenShift.has(dup)) throw new RowFail([`Turno repetido: el mismo cargo y nombre aparecen en la fila ${seenShift.get(dup)}.`]);
            const [cur] = await sp.select({ id: positionShifts.id }).from(positionShifts).where(and(eq(positionShifts.positionId, pos.id), sql`lower(btrim(${positionShifts.name})) = ${norm(p.values.name)}`));
            const saved = await saveShiftTx(sp, sub, studyId, pos.id, cur?.id, p.values);
            if (!saved.ok) throw new RowFail(saved.errors);
            seenShift.set(dup, s.rowNo);
            return cur ? (saved.changed ? "update" : "unchanged") : "create";
          });
          if (!res.ok) add("Turnos", s.rowNo, label, "error", res.errors); else add("Turnos", s.rowNo, label, res.value as BulkRowReport["action"]);
        }
      }

      // Capacidad de la hoja de Google de la sección (la app la espeja en filas fijas).
      const cap = BULK_MAX_ROWS[hoja];
      if (existingBefore + report.counts.create > cap) report.fileErrors.push(`La sección admite máximo ${cap} registros (la hoja de Google tiene ${cap} filas): hoy hay ${existingBefore} y esta carga crearía ${report.counts.create}.`);

      const errors = report.counts.error + report.shiftCounts.error + report.fileErrors.length;
      const updates = report.counts.update + report.shiftCounts.update;
      report.needsUpdateConfirm = errors === 0 && updates > 0 && !opts.allowUpdate;
      if (!(opts.apply && errors === 0 && !report.needsUpdateConfirm)) throw ROLLBACK;
      const c = report.counts, t = report.shiftCounts;
      await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "bulk", entity: `bulk_upload_${hoja}`, entityId: null, diff: { registros: { from: null, to: `${c.create} nuevos, ${c.update} actualizados, ${c.unchanged} sin cambios` }, ...(hoja === "2" ? { turnos: { from: null, to: `${t.create} nuevos, ${t.update} actualizados, ${t.unchanged} sin cambios` } } : {}) } });
      report.committed = true;
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  if (report.committed) report.mirror = hoja === "2" ? (report.shiftCounts.create + report.shiftCounts.update > 0 ? ["2", "3"] : ["2"]) : [hoja];
  return report;
}

/** Filas de dotación que ya tienen esa clave (tipo de dato, área, sede, cargo y código del colaborador, vacío = sin código). */
async function findStaffing(tx: Tx, studyId: string, kind: "real" | "demo", area: string, site: string, position: string, employeeCode: string): Promise<{ id: string; version: number }[]> {
  return tx.select({ id: staffingEntries.id, version: staffingEntries.version }).from(staffingEntries)
    .innerJoin(positions, eq(positions.id, staffingEntries.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
    .where(and(eq(staffingEntries.studyId, studyId), eq(positions.dataKind, kind), sql`lower(btrim(${areas.name})) = ${norm(area)}`, sql`lower(btrim(${sites.name})) = ${norm(site)}`, sql`lower(btrim(${positions.name})) = ${norm(position)}`,
      sql`lower(btrim(coalesce(${staffingEntries.employeeCode}, ''))) = ${norm(employeeCode)}`));
}

/** Descripción de la operación del cargo de un registro de dotación. Devuelve si cambió. */
async function setOperation(tx: Tx, sub: string, studyId: string, entryId: string, raw: string): Promise<boolean> {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text.length > LONG_TEXT_MAX) throw new RowFail([`La descripción de la operación admite máximo ${LONG_TEXT_MAX} caracteres (tiene ${text.length}).`]);
  const [e] = await tx.select({ positionId: staffingEntries.positionId }).from(staffingEntries).where(and(eq(staffingEntries.id, entryId), eq(staffingEntries.studyId, studyId)));
  if (!e) throw new RowFail(["No se encontró el cargo del registro."]);
  const [cur] = await tx.select({ t: positions.operationDescription }).from(positions).where(eq(positions.id, e.positionId));
  if ((cur?.t ?? "") === text) return false;
  await tx.update(positions).set({ operationDescription: text }).where(and(eq(positions.id, e.positionId), eq(positions.studyId, studyId)));
  await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "update", entity: "position_operation", entityId: e.positionId, diff: { operationDescription: { from: cur?.t ? cur.t.slice(0, 200) : null, to: text.slice(0, 200) } } });
  return true;
}

/** Turnos de la actividad escritos como texto: «Todos los turnos» o nombres separados por «;». Devuelve si cambió. */
async function setActivityShiftsFromText(tx: Tx, sub: string, studyId: string, activityId: string, raw: string): Promise<boolean> {
  const text = raw.trim();
  if (norm(text) === norm(ALL_SHIFTS)) {
    const r = await setActivityShiftsTx(tx, sub, studyId, activityId, { all: true, ids: [] });
    if (!r.ok) throw new RowFail(r.errors);
    return r.changed === true;
  }
  const names = [...new Set(text.split(/[;\n]/).map((x) => x.trim()).filter(Boolean))];
  const [a] = await tx.select({ positionId: activities.positionId }).from(activities).where(and(eq(activities.id, activityId), eq(activities.studyId, studyId)));
  const shifts = await tx.select({ id: positionShifts.id, name: positionShifts.name }).from(positionShifts).where(and(eq(positionShifts.studyId, studyId), eq(positionShifts.positionId, a.positionId)));
  const ids: string[] = [], unknown: string[] = [];
  for (const n of names) { const s = shifts.find((x) => norm(x.name) === norm(n)); if (s) ids.push(s.id); else unknown.push(n); }
  if (unknown.length) throw new RowFail([`Turnos que no existen en el cargo de la actividad: ${unknown.map((u) => `«${u}»`).join(", ")}. Créelos en Cargos y dotación (editar el cargo) o use el nombre exacto.`]);
  const r = await setActivityShiftsTx(tx, sub, studyId, activityId, { all: false, ids });
  if (!r.ok) throw new RowFail(r.errors);
  return r.changed === true;
}
