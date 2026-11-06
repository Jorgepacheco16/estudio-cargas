"use client";
import { useId, useRef, useState } from "react";
import { formatMinutes, moveTask, type Cell } from "@/domain/schedule";

/**
 * Celda «persona × día» del reparto semanal (D-102, D-103): muestra el resumen del día y, al pulsarla, abre las tareas de esa persona ese día en orden, con el tiempo de cada una
 * (sin horas del día: no se sabe a qué hora ocurre cada tarea). El orden se puede cambiar con las flechas para ver cómo quedaría el día; el cambio NO se guarda y no altera los tiempos
 * ni el reparto. Usa el elemento nativo <dialog>: se cierra con Esc, con «Cerrar» o pulsando fuera, y el foco queda atrapado mientras está abierto.
 */
export function DayCell({ person, day, position, week, cell }: { person: number; day: string; position: string; week: string; cell: Cell }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  // Orden elegido por la persona (códigos); vacío = el sugerido. Se guarda como códigos para que, si los datos cambian, lo que ya no existe simplemente se ignore.
  const [order, setOrder] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const rank = (code: string, fallback: number) => { const i = order.indexOf(code); return i < 0 ? 1e6 + fallback : i; };
  const shown = order.length === 0 ? cell.tasks : [...cell.tasks].sort((a, b) => rank(a.code, cell.tasks.indexOf(a)) - rank(b.code, cell.tasks.indexOf(b)));
  const changed = shown.some((t, i) => t.code !== cell.tasks[i]?.code);
  const over = cell.totalMin > cell.toleranceMin + 0.5, free = cell.capacityMin - cell.totalMin;
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const move = (i: number, dir: -1 | 1) => {
    const next = moveTask(shown, i, dir);
    setOrder(next.map((t) => t.code));
    setNotice(`«${shown[i].code}» ahora es la tarea ${i + 1 + dir} de ${shown.length}.`);
  };
  const reset = () => { setOrder([]); setNotice("Se restableció el orden sugerido."); };
  const lines = shown.filter((t) => t.kind === "task"), reserve = shown.find((t) => t.kind === "reserve");
  return (
    <>
      <button type="button" className="day-cell" onClick={open} aria-haspopup="dialog" aria-label={`Ver las tareas de la persona ${person} el ${day.toLowerCase()}: ${formatMinutes(cell.totalMin)} de ${formatMinutes(cell.capacityMin)}`}>
        {lines.map((t) => <span key={t.code} className="dc-line"><b>{t.code}</b> · {formatMinutes(t.minutes)}</span>)}
        {reserve && <span className="dc-line muted">Imprevistos · {formatMinutes(reserve.minutes)}</span>}
        {shown.length === 0 && <span className="dc-line muted">—</span>}
        <span className="dc-total muted">{over ? <span className="pill overload">Pasa la jornada</span> : null} {formatMinutes(cell.totalMin)} de {formatMinutes(cell.capacityMin)}</span>
      </button>
      <dialog ref={ref} className="day-dialog" aria-labelledby={id} onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className="dd-form">
          <h3 id={id}>Persona {person} · {day}</h3>
          <p className="note" style={{ margin: "4px 0 0" }}>{position} · {week}</p>
          {shown.length === 0 ? <p className="empty" style={{ marginTop: 12 }}>Esta persona no tiene tareas este día.</p> : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`Tareas de la persona ${person} el ${day.toLowerCase()}`}>
              <table style={{ minWidth: 420 }}>
                <thead><tr><th>#</th><th>Tarea</th><th className="num">Tiempo</th><th>Orden</th></tr></thead>
                <tbody>
                  {shown.map((t, i) => (
                    <tr key={t.code} className={t.kind === "task" ? undefined : "dd-soft"}>
                      <td>{i + 1}</td>
                      <td><b>{t.code}</b><div className="muted">{t.name}</div></td>
                      <td className="num">{formatMinutes(t.minutes)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="btn dd-move" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${t.code}`} title="Subir"><span aria-hidden="true">↑</span></button>{" "}
                        <button type="button" className="btn dd-move" onClick={() => move(i, 1)} disabled={i === shown.length - 1} aria-label={`Bajar ${t.code}`} title="Bajar"><span aria-hidden="true">↓</span></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}><b>Trabajo del día</b></td><td className="num"><b>{formatMinutes(cell.totalMin)}</b></td><td /></tr></tfoot>
              </table>
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">{notice}</p>
          <p className="note" style={{ marginTop: 12 }}>
            Jornada útil del día: {formatMinutes(cell.capacityMin)}.{" "}
            {over ? `Pasa la jornada aceptada (${formatMinutes(cell.toleranceMin)}) en ${formatMinutes(cell.totalMin - cell.toleranceMin)}.` : free > 0.5 ? `Disponibilidad sin tareas: ${formatMinutes(free)}.` : cell.totalMin > cell.capacityMin + 0.5 ? `Sobrecarga dentro de lo aceptado: ${formatMinutes(cell.totalMin - cell.capacityMin)}.` : "Jornada completa."}
          </p>
          <p className="note">El orden es una sugerencia: primero lo diario, luego lo semanal y lo periódico, al final los imprevistos. No hay horas del día porque no se sabe a qué hora ocurre cada tarea en la operación. Use las flechas para ver cómo quedaría el día con otro orden; el cambio no se guarda.</p>
          <div className="dd-actions">
            {changed && <button type="button" className="btn" onClick={reset}>Restablecer el orden sugerido</button>}
            <button type="button" className="btn solid" onClick={close} autoFocus>Cerrar</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
