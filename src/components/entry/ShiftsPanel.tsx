import { deleteShiftAction, saveShiftAction } from "@/app/entrada/shift-actions";
import { describeShift } from "@/domain/shifts";
import type { ShiftRow } from "@/server/shifts";

/** Turnos de un cargo (D-67), dentro del editor de «Cargos y dotación». Informativos: no cambian ningún cálculo. */
export function ShiftsPanel({ positionId, entryId, shifts, canWrite }: { positionId: string; entryId: string; shifts: ShiftRow[]; canWrite: boolean }) {
  const hidden = (shiftId?: string) => (
    <>
      <input type="hidden" name="positionId" value={positionId} />
      <input type="hidden" name="entryId" value={entryId} />
      {shiftId && <input type="hidden" name="shiftId" value={shiftId} />}
    </>
  );
  const fields = (id: string, s?: ShiftRow) => (
    <div className="form-grid">
      <div className="field span-two"><label htmlFor={`n-${id}`}>Nombre del turno <span className="req" title="Obligatorio">*</span></label><input id={`n-${id}`} name="name" defaultValue={s?.name ?? ""} maxLength={60} required disabled={!canWrite} placeholder="Ej.: Apertura" /></div>
      <div className="field span-one"><label htmlFor={`s-${id}`}>Hora de inicio</label><input id={`s-${id}`} name="start" type="time" defaultValue={s?.start ?? ""} disabled={!canWrite} /></div>
      <div className="field span-one"><label htmlFor={`e-${id}`}>Hora de fin</label><input id={`e-${id}`} name="end" type="time" defaultValue={s?.end ?? ""} disabled={!canWrite} /></div>
      <div className="field span-one"><label htmlFor={`b-${id}`}>Receso (minutos)</label><input id={`b-${id}`} name="breakMin" inputMode="numeric" defaultValue={s?.breakMin ?? ""} maxLength={3} disabled={!canWrite} placeholder="Ej.: 30" /></div>
    </div>
  );
  return (
    <section className="card" id="turnos" aria-labelledby="turnos-h">
      <h2 id="turnos-h">Turnos de este cargo ({shifts.length})</h2>
      <p className="note" style={{ marginTop: 0 }}>Registre los turnos en que se trabaja este cargo. Después, al crear una actividad, podrá elegir en cuáles se ejecuta o marcar «Todos los turnos». Es información para el estudio (y para el agente de IA): no cambia las horas ni la capacidad. Si la hora de fin es menor que la de inicio, el turno cruza la medianoche.</p>
      {shifts.length === 0 && <div className="empty">Este cargo aún no tiene turnos.</div>}
      {shifts.map((s) => (
        <div key={s.id} style={{ borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 12, marginTop: 12 }}>
          <p style={{ margin: "0 0 8px" }}><b>{describeShift({ name: s.name, start: s.start, end: s.end, breakMin: s.breakMin })}</b>{s.usedBy > 0 && <span className="muted"> · lo usan {s.usedBy} actividad(es)</span>}</p>
          {canWrite ? (
            <>
              <form action={saveShiftAction}>{hidden(s.id)}{fields(s.id, s)}<div className="form-actions"><button className="btn" type="submit">Guardar cambios del turno</button></div></form>
              <form action={deleteShiftAction} style={{ marginTop: 6 }}>
                {hidden(s.id)}
                {s.usedBy > 0 && <label style={{ marginRight: 12 }}><input type="checkbox" name="confirm" /> Confirmo: quitarlo también de las {s.usedBy} actividad(es) que lo usan</label>}
                <button className="btn danger" type="submit">Eliminar turno</button>
              </form>
            </>
          ) : null}
        </div>
      ))}
      {canWrite && (
        <form action={saveShiftAction} style={{ borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 12, marginTop: 16 }}>
          {hidden()}
          <h3 style={{ margin: "0 0 8px" }}>Agregar un turno</h3>
          {fields("nuevo")}
          <div className="form-actions"><button className="btn solid" type="submit">+ Agregar turno</button></div>
        </form>
      )}
    </section>
  );
}
