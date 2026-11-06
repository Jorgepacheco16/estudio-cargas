"use client";
import { useId, useRef } from "react";
import { formatMinutes, type Cell } from "@/domain/schedule";

/**
 * Celda «persona × día» del reparto semanal (D-102): muestra el resumen del día y, al pulsarla, abre el horario de esa persona ese día con cada tarea en orden, su tiempo y las
 * horas sugeridas. Es de consulta. Usa el elemento nativo <dialog>: se cierra con Esc, con «Cerrar» o pulsando fuera, y el foco queda atrapado mientras está abierto.
 */
export function DayCell({ person, day, position, week, cell }: { person: number; day: string; position: string; week: string; cell: Cell }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  const over = cell.totalMin > cell.toleranceMin + 0.5, free = cell.capacityMin - cell.totalMin;
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const hasClock = cell.startClock !== null;
  return (
    <>
      <button type="button" className="day-cell" onClick={open} aria-haspopup="dialog" aria-label={`Ver el horario de la persona ${person} el ${day.toLowerCase()}: ${formatMinutes(cell.totalMin)} de ${formatMinutes(cell.capacityMin)}`}>
        {cell.items.map((it) => <span key={it.code} className="dc-line"><b>{it.code}</b> · {formatMinutes(it.minutes)}</span>)}
        {cell.reserveMin > 0.5 && <span className="dc-line muted">Imprevistos · {formatMinutes(cell.reserveMin)}</span>}
        {cell.items.length === 0 && cell.reserveMin <= 0.5 && <span className="dc-line muted">—</span>}
        <span className="dc-total muted">{over ? <span className="pill overload">Pasa la jornada</span> : null} {formatMinutes(cell.totalMin)} de {formatMinutes(cell.capacityMin)}</span>
      </button>
      <dialog ref={ref} className="day-dialog" aria-labelledby={id} onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className="dd-form">
          <h3 id={id}>Persona {person} · {day}</h3>
          <p className="note" style={{ margin: "4px 0 0" }}>{position} · {week}{cell.shiftName ? ` · turno «${cell.shiftName}»${hasClock ? ` (${cell.startClock}–${cell.endClock} sugerido)` : ""}` : ""}</p>
          {cell.timeline.length === 0 ? <p className="empty" style={{ marginTop: 12 }}>Esta persona no tiene tareas este día.</p> : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`Horario de la persona ${person} el ${day.toLowerCase()}`}>
              <table style={{ minWidth: 420 }}>
                <thead><tr><th>#</th><th>Hora</th><th>Tarea</th><th className="num">Tiempo</th></tr></thead>
                <tbody>
                  {cell.timeline.map((r, i) => (
                    <tr key={i} className={r.kind === "task" ? undefined : "dd-soft"}>
                      <td>{r.kind === "break" ? "" : cell.timeline.slice(0, i + 1).filter((x) => x.kind !== "break").length}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.from ? `${r.from} – ${r.to}` : "—"}</td>
                      <td>{r.kind === "task" ? <><b>{r.code}</b><div className="muted">{r.name}</div></> : <>{r.kind === "reserve" ? <b>{r.code}</b> : r.code}<div className="muted">{r.name}</div></>}</td>
                      <td className="num">{formatMinutes(r.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}><b>Trabajo del día</b></td><td className="num"><b>{formatMinutes(cell.totalMin)}</b></td></tr></tfoot>
              </table>
            </div>
          )}
          <p className="note" style={{ marginTop: 12 }}>
            Jornada útil del día: {formatMinutes(cell.capacityMin)}.{" "}
            {over ? `Pasa la jornada aceptada (${formatMinutes(cell.toleranceMin)}) en ${formatMinutes(cell.totalMin - cell.toleranceMin)}.` : free > 0.5 ? `Disponibilidad sin tareas: ${formatMinutes(free)}.` : cell.totalMin > cell.capacityMin + 0.5 ? `Sobrecarga dentro de lo aceptado: ${formatMinutes(cell.totalMin - cell.capacityMin)}.` : "Jornada completa."}
          </p>
          <p className="note">El orden y las horas son una sugerencia: primero lo diario, luego lo semanal y lo periódico, al final los imprevistos{hasClock ? ", contando desde el inicio del turno y con el descanso a la mitad del trabajo" : ". El turno no tiene hora de inicio registrada, por eso no hay horas sugeridas"}. No se sabe a qué hora ocurre cada tarea en la operación.</p>
          <div className="dd-actions"><button type="button" className="btn solid" onClick={close} autoFocus>Cerrar</button></div>
        </div>
      </dialog>
    </>
  );
}
