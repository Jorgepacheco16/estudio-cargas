"use client";
import { useId, useRef, type ReactNode } from "react";

/**
 * Botón de envío que antes pide confirmación en una ventana (para no perder un registro por un clic accidental).
 * Va dentro de un <form>: al confirmar envía ese formulario; al cancelar (botón, Escape o clic fuera) no pasa nada.
 * El foco empieza en «Cancelar», así que pulsar Enter por reflejo no elimina.
 */
export function ConfirmButton({ children, title = "¿Eliminar este registro?", message, confirmLabel = "Eliminar", className = "btn danger", disabled, ariaLabel }: {
  children: ReactNode; title?: string; message?: ReactNode; confirmLabel?: string; className?: string; disabled?: boolean; ariaLabel?: string;
}) {
  const id = useId();
  const dlg = useRef<HTMLDialogElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className={className} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" onClick={() => dlg.current?.showModal()}>{children}</button>
      <dialog
        ref={dlg}
        className="confirm"
        aria-labelledby={id}
        onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}
      >
        <h2 id={id}>{title}</h2>
        {message && <p>{message}</p>}
        <p className="confirm-warn">Esta acción no se puede deshacer.</p>
        <div className="confirm-actions">
          <button type="button" className="btn" autoFocus onClick={() => dlg.current?.close()}>Cancelar</button>
          <button type="button" className="btn solid danger-solid" onClick={() => { dlg.current?.close(); btn.current?.form?.requestSubmit(); }}>{confirmLabel}</button>
        </div>
      </dialog>
    </>
  );
}
