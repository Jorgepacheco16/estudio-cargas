"use client";
import { useEffect, useState } from "react";
import { describeShift, shiftNoun, type ShiftType } from "@/domain/shifts";

export interface PickerPosition { kind: string; area: string; site: string; position: string; type?: ShiftType | null; shifts: { id: string; name: string; start: string | null; end: string | null; breakMin: number | null; days: number | null }[] }
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * «Turnos en que se ejecuta» (D-67): casillas con los turnos del cargo responsable de la actividad. Lee el área, el centro de operaciones y el cargo que se están
 * escribiendo en el formulario (columnas D, E y F de la hoja 3, y A para REAL/DEMO) y se actualiza cuando cambian.
 */
export function ShiftPicker({ positions, initial, cols, disabled }: { positions: PickerPosition[]; initial: { all: boolean; ids: string[] }; cols: { kind: string; area: string; site: string; position: string }; disabled: boolean }) {
  const [all, setAll] = useState(initial.all);
  const [chosen, setChosen] = useState<Set<string>>(new Set(initial.ids));
  const [cargo, setCargo] = useState({ kind: "real", area: "", site: "", position: "" });

  useEffect(() => {
    const read = () => {
      const v = (c: string) => (document.getElementById(`c_${c}`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
      setCargo({ kind: norm(v(cols.kind)) === "demo" ? "demo" : "real", area: v(cols.area), site: v(cols.site), position: v(cols.position) });
    };
    read();
    const els = [cols.kind, cols.area, cols.site, cols.position].map((c) => document.getElementById(`c_${c}`)).filter((e): e is HTMLElement => !!e);
    for (const e of els) { e.addEventListener("input", read); e.addEventListener("change", read); }
    return () => { for (const e of els) { e.removeEventListener("input", read); e.removeEventListener("change", read); } };
  }, [cols.kind, cols.area, cols.site, cols.position]);

  const mine = positions.find((p) => p.kind === cargo.kind && norm(p.area) === norm(cargo.area) && norm(p.site) === norm(cargo.site) && norm(p.position) === norm(cargo.position));
  const w = shiftNoun(mine?.type);
  const ALL_SHIFTS = w.all;
  const complete = cargo.area.trim() !== "" && cargo.site.trim() !== "" && cargo.position.trim() !== "";
  const toggle = (id: string) => setChosen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="coverage-box" role="group" aria-labelledby="turnos-act-h">
      <h3 id="turnos-act-h">{w.Many} en que se ejecuta</h3>
      <input type="hidden" name="shiftsTouched" value="1" />
      <label style={{ display: "block", marginBottom: 6 }}><input type="checkbox" name="allShifts" checked={all} onChange={(e) => setAll(e.target.checked)} disabled={disabled} /> <b>{ALL_SHIFTS}</b> <span className="muted">(incluye los que se agreguen después al cargo)</span></label>
      {!complete ? <p className="note" style={{ marginTop: 0 }}>Para elegir turnos concretos, indique primero el área, el centro de operaciones y el cargo responsable. Si la actividad se hace en todos los turnos, marque «{ALL_SHIFTS}».</p>
        : !mine ? <p className="note" style={{ marginTop: 0 }}>Este cargo aún no tiene turnos registrados, por eso solo puede marcar «{ALL_SHIFTS}» o dejarla sin turno. Para elegir turnos concretos, créelos en <b>Cargos y dotación</b> (editar el cargo → «Turnos de este cargo») y vuelva a esta actividad.</p>
        : (
          <>
            <p className="note" style={{ marginTop: 0 }}>Marque en qué {w.many} del cargo se hace esta actividad, o «{ALL_SHIFTS}». Si no marca nada, queda sin {w.one} asignado (no se asume que aplica a todos). Es informativo: no cambia las horas.</p>
            {mine.shifts.map((s) => (
              <label key={s.id} style={{ display: "block", marginBottom: 4, opacity: all ? 0.55 : 1 }}>
                <input type="checkbox" name="shift" value={s.id} checked={!all && chosen.has(s.id)} onChange={() => toggle(s.id)} disabled={disabled || all} /> {describeShift({ name: s.name, start: s.start, end: s.end, breakMin: s.breakMin, days: s.days, type: mine.type })}
              </label>
            ))}
          </>
        )}
    </div>
  );
}
