"use client";
import { useId, useRef, useState, useTransition } from "react";
import { applyOrder, formatMinutes, moveTask, type Cell, type WeekKind } from "@/domain/schedule";
import { saveDayOrderAction } from "@/app/resultados/reparto/actions";

/**
 * Celda «persona × día» del reparto semanal (D-102, D-103, D-104): muestra el resumen del día y, al pulsarla, abre las tareas de esa persona ese día en orden, con el tiempo de cada una
 * (sin horas del día: no se sabe a qué hora ocurre cada tarea). El orden se puede cambiar con las flechas; quien tiene «Resultados» en Edición puede GUARDARLO, y entonces lo ve todo el
 * estudio. El orden guardado es solo una preferencia de esta vista: no cambia tiempos, totales, actividades ni ninguna otra sección. Usa el elemento nativo <dialog>: se cierra con Esc,
 * con «Cerrar» o pulsando fuera, y el foco queda atrapado mientras está abierto.
 */
export interface DayTarget { positionKey: string; kind: WeekKind; weekday: number }
export function DayCell({ person, day, position, week, cell, target, canSave }: { person: number; day: string; position: string; week: string; cell: Cell; target: DayTarget; canSave: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  const [saved, setSaved] = useState<string[]>(cell.saved?.codes ?? []); // lo que está guardado (se actualiza al guardar)
  const [order, setOrder] = useState<string[]>(cell.saved?.codes ?? []); // el orden que se está viendo (borrador hasta guardarlo)
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [pending, start] = useTransition();
  const joined = (xs: readonly { code: string }[]) => xs.map((t) => t.code).join("|");
  const shown = applyOrder(cell.tasks, order);
  const isSuggested = joined(shown) === joined(cell.tasks), changed = joined(shown) !== joined(applyOrder(cell.tasks, saved)), hasSaved = saved.length > 0;
  const over = cell.totalMin > cell.toleranceMin + 0.5, free = cell.capacityMin - cell.totalMin;
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const move = (i: number, dir: -1 | 1) => {
    setOrder(moveTask(shown, i, dir).map((t) => t.code)); setError("");
    setNotice(`«${shown[i].code}» ahora es la tarea ${i + 1 + dir} de ${shown.length}.`);
  };
  const reset = () => { setOrder([]); setError(""); setNotice("Se restableció el orden sugerido."); };
  const save = () => start(async () => {
    const codes = isSuggested ? [] : shown.map((t) => t.code); // volver al sugerido = quitar lo guardado
    const r = await saveDayOrderAction({ positionKey: target.positionKey, week: target.kind, person, weekday: target.weekday, codes });
    if (r.ok) { setSaved(codes); setOrder(codes); setError(""); setNotice(r.removed ? "Se quitó el orden guardado: vuelve el orden sugerido." : "Orden guardado. Lo verá quien tenga Resultados."); }
    else setError(r.error);
  });
  const lines = shown.filter((t) => t.kind === "task"), reserve = shown.find((t) => t.kind === "reserve");
  if (cell.rest) return <div className="day-cell" role="group" aria-label={`Persona ${person}: descanso el ${day.toLowerCase()}`}><span className="dc-line"><b>Descanso</b></span><span className="dc-total muted">Sin tareas este día</span></div>;
  return (
    <>
      <button type="button" className="day-cell" onClick={open} aria-haspopup="dialog" aria-label={`Ver las tareas de la persona ${person} el ${day.toLowerCase()}: ${formatMinutes(cell.totalMin)} de ${formatMinutes(cell.capacityMin)}${hasSaved ? ", con orden guardado" : ""}`}>
        {lines.map((t) => <span key={t.code} className="dc-line"><b>{t.code}</b> · {formatMinutes(t.minutes)}</span>)}
        {reserve && <span className="dc-line muted">Imprevistos · {formatMinutes(reserve.minutes)}</span>}
        {shown.length === 0 && <span className="dc-line muted">—</span>}
        <span className="dc-total muted">{over ? <span className="pill overload">Pasa la jornada</span> : null} {formatMinutes(cell.totalMin)} de {formatMinutes(cell.capacityMin)}{hasSaved ? " · orden guardado" : ""}</span>
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
          {error && <div className="banner" role="alert" style={{ marginTop: 12, background: "var(--red-soft)", color: "var(--red-dark)" }}>{error}</div>}
          <p className="note" style={{ marginTop: 12 }}>
            Jornada útil del día: {formatMinutes(cell.capacityMin)}.{" "}
            {over ? `Pasa la jornada aceptada (${formatMinutes(cell.toleranceMin)}) en ${formatMinutes(cell.totalMin - cell.toleranceMin)}.` : free > 0.5 ? `Disponibilidad sin tareas: ${formatMinutes(free)}.` : cell.totalMin > cell.capacityMin + 0.5 ? `Sobrecarga dentro de lo aceptado: ${formatMinutes(cell.totalMin - cell.capacityMin)}.` : "Jornada completa."}
          </p>
          <p className="note">
            {changed ? "Orden sin guardar. " : hasSaved ? "Este día tiene un orden guardado. " : "Es el orden sugerido: primero lo diario, luego lo semanal y lo periódico, al final los imprevistos. "}
            No hay horas del día porque no se sabe a qué hora ocurre cada tarea en la operación. El orden es solo una sugerencia de esta vista: guardarlo no cambia tiempos, actividades ni ninguna otra sección.
            {!canSave && " Con su rol puede ver el orden guardado y probar otros, pero no guardarlos (hace falta Edición en Resultados)."}
          </p>
          <div className="dd-actions">
            {!isSuggested && <button type="button" className="btn" onClick={reset} disabled={pending}>Restablecer el orden sugerido</button>}
            {canSave && <button type="button" className="btn solid" onClick={save} disabled={!changed || pending}>{pending ? "Guardando…" : isSuggested && hasSaved ? "Guardar (quitar el orden guardado)" : "Guardar este orden"}</button>}
            <button type="button" className="btn" onClick={close} autoFocus>Cerrar</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
