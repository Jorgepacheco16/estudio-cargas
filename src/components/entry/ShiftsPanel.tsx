import { deleteShiftAction, saveShiftAction } from "@/app/entrada/shift-actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DAY_NAMES, daysOf, describeShift, shiftNoun, type ShiftType } from "@/domain/shifts";
import type { ShiftRow } from "@/server/shifts";

/** Turnos de un cargo (D-67), dentro del editor de «Cargos y dotación». Informativos: no cambian ningún cálculo. Si el tipo de turno del cargo es Variable, se registran FRANJAS horarias. */
export function ShiftsPanel({ positionId, entryId, shifts, canWrite, ok, error, type }: { type: ShiftType | null; ok?: string; error?: string; positionId: string; entryId: string; shifts: ShiftRow[]; canWrite: boolean }) {
  const w = shiftNoun(type);
  const variable = type === "variable";
  const hidden = (shiftId?: string) => (
    <>
      <input type="hidden" name="positionId" value={positionId} />
      <input type="hidden" name="entryId" value={entryId} />
      {shiftId && <input type="hidden" name="shiftId" value={shiftId} />}
    </>
  );
  const fields = (id: string, s?: ShiftRow) => (
    <div className="form-grid">
      <div className="field span-two"><label htmlFor={`n-${id}`}>Nombre {variable ? "de la franja" : "del turno"} <span className="req" title="Obligatorio">*</span></label><input id={`n-${id}`} name="name" defaultValue={s?.name ?? ""} maxLength={60} required disabled={!canWrite} placeholder={variable ? "Ej.: Franja de la mañana" : "Ej.: Apertura"} /></div>
      <div className="field span-one"><label htmlFor={`s-${id}`}>{variable ? "Hora de inicio de la franja" : "Hora de inicio"}</label><input id={`s-${id}`} name="start" type="time" defaultValue={s?.start ?? ""} disabled={!canWrite} /></div>
      <div className="field span-one"><label htmlFor={`e-${id}`}>{variable ? "Hora de fin de la franja" : "Hora de fin"}</label><input id={`e-${id}`} name="end" type="time" defaultValue={s?.end ?? ""} disabled={!canWrite} /></div>
      <div className="field span-full"><span className="lbl" id={`d-${id}`}>Días en que aplica {variable ? "la franja" : "el turno"} <span className="req" title="Obligatorio">*</span></span><div role="group" aria-labelledby={`d-${id}`} style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>{DAY_NAMES.map((n, i) => <label key={n} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" name="days" value={i} defaultChecked={s ? daysOf(s.days).includes(i) : true} disabled={!canWrite} /> {n}</label>)}</div></div>
      <div className="field span-one"><label htmlFor={`b-${id}`}>Receso (minutos)</label><input id={`b-${id}`} name="breakMin" inputMode="numeric" defaultValue={s?.breakMin ?? ""} maxLength={3} disabled={!canWrite} placeholder="Ej.: 30" /></div>
    </div>
  );
  return (
    <section className="card" id="turnos" aria-labelledby="turnos-h">
      <h2 id="turnos-h">{w.Many} de este cargo ({shifts.length})</h2>
      {ok && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)", marginBottom: 12 }}>{ok}</div>}
      {error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)", marginBottom: 12 }}>{error}</div>}
      {variable
        ? <p className="note" style={{ marginTop: 0 }}>Este cargo tiene <b>turno variable</b>: no registre todos los horarios posibles, sino las <b>franjas horarias</b> dentro de las que se distribuyen los turnos de sus colaboradores (por ejemplo, «Mañana 06:00–14:00»). El agente de IA lo interpreta así: en cada franja se distribuyen los turnos del cargo. Después, al crear una actividad, podrá elegir en cuáles franjas se ejecuta o marcar «Todas las franjas». Es información: no cambia las horas ni la capacidad.</p>
        : <p className="note" style={{ marginTop: 0 }}>{type === "fixed" ? "Este cargo tiene turno fijo. " : "El tipo de turno de este cargo aún no está definido (Fijo o Variable): elíjalo en el bloque «Tipo de turno» del formulario de arriba y guarde. Mientras tanto se registran turnos con horario. "}Registre los turnos en que se trabaja este cargo. Después, al crear una actividad, podrá elegir en cuáles se ejecuta o marcar «Todos los turnos». Es información para el estudio (y para el agente de IA): no cambia las horas ni la capacidad. Si la hora de fin es menor que la de inicio, el turno cruza la medianoche.</p>}
      {shifts.length === 0 && <div className="empty">Este cargo aún no tiene {w.many}.</div>}
      {shifts.map((s) => (
        <div key={s.id} style={{ borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 12, marginTop: 12 }}>
          <p style={{ margin: "0 0 8px" }}><b>{describeShift({ name: s.name, start: s.start, end: s.end, breakMin: s.breakMin, days: s.days, type })}</b>{s.usedBy > 0 && <span className="muted"> · lo usan {s.usedBy} actividad(es)</span>}</p>
          {canWrite ? (
            <>
              <form action={saveShiftAction}>{hidden(s.id)}{fields(s.id, s)}<div className="form-actions"><button className="btn" type="submit">Guardar cambios {variable ? "de la franja" : "del turno"}</button></div></form>
              <form action={deleteShiftAction} style={{ marginTop: 6 }}>
                {hidden(s.id)}
                {s.usedBy > 0 && <label style={{ marginRight: 12 }}><input type="checkbox" name="confirm" /> Confirmo: quitarlo también de las {s.usedBy} actividad(es) que lo usan</label>}
                <ConfirmButton title={`¿Eliminar ${variable ? "esta franja" : "este turno"}?`} message={`Se eliminará ${variable ? "la franja" : "el turno"} de este cargo.`}>{variable ? "Eliminar franja" : "Eliminar turno"}</ConfirmButton>
              </form>
            </>
          ) : null}
        </div>
      ))}
      {canWrite && (
        <form action={saveShiftAction} style={{ borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 12, marginTop: 16 }}>
          {hidden()}
          <h3 style={{ margin: "0 0 8px" }}>{variable ? "Agregar una franja" : "Agregar un turno"}</h3>
          {fields("nuevo")}
          <div className="form-actions"><button className="btn solid" type="submit">{variable ? "+ Agregar franja" : "+ Agregar turno"}</button></div>
        </form>
      )}
    </section>
  );
}
