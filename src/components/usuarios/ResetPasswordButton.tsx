"use client";
import { useActionState, useId, useRef, useState } from "react";
import { resetPasswordAction, type PasswordState } from "@/app/usuarios/actions";

/**
 * «Cambiar clave» de otra persona (D-94). Abre una ventana: al confirmar, la aplicación genera una clave temporal y la muestra UNA vez para copiarla.
 * Al cerrar la ventana la clave desaparece de la pantalla y no se puede volver a ver.
 */
export function ResetPasswordButton({ userId, label }: { userId: string; label: string }) {
  // Al cerrar la ventana se vuelve a montar el formulario: así la clave temporal (que vive en su estado) desaparece de la memoria de la página y no se puede volver a ver.
  const [round, setRound] = useState(0);
  return <ResetPasswordDialog key={round} userId={userId} label={label} onClosed={() => setRound((n) => n + 1)} />;
}

function ResetPasswordDialog({ userId, label, onClosed }: { userId: string; label: string; onClosed: () => void }) {
  const id = useId();
  const dlg = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<PasswordState, FormData>(resetPasswordAction, {});
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(state.temp ?? ""); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* la clave queda visible para copiarla a mano */ } };
  return (
    <>
      <button type="button" className="btn" aria-haspopup="dialog" onClick={() => dlg.current?.showModal()}>Cambiar clave</button>
      <dialog ref={dlg} className="confirm" aria-labelledby={id} onClose={onClosed} onClick={(e) => { if (e.target === dlg.current && !pending) dlg.current?.close(); }}>
        <h2 id={id}>Cambiar la clave de {label}</h2>
        {state.ok && state.temp ? (
          <>
            <p>Clave temporal de <b>{state.email ?? label}</b>. <b>Se muestra una sola vez</b>: cópiela y pásela a la persona por un medio seguro. Sus sesiones abiertas ya se cerraron.</p>
            <div className="invite-row"><input readOnly value={state.temp} aria-label="Clave temporal" onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: "monospace" }} /><button type="button" className="btn solid" onClick={copy}>{copied ? "Copiada" : "Copiar clave"}</button></div>
            <p className="note">Pídale que la cambie por una propia en «Mi cuenta» apenas entre.</p>
            <div className="confirm-actions"><button type="button" className="btn solid" onClick={() => dlg.current?.close()}>Listo, ya la copié</button></div>
          </>
        ) : (
          <form action={action}>
            <input type="hidden" name="persona" value={userId} />
            <p>La aplicación generará una clave temporal para <b>{label}</b> y la mostrará una sola vez. La clave anterior dejará de servir y sus sesiones abiertas se cerrarán.</p>
            {state.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{state.error}</div>}
            <div className="confirm-actions">
              <button type="button" className="btn" autoFocus onClick={() => dlg.current?.close()} disabled={pending}>Cancelar</button>
              <button type="submit" className="btn solid" disabled={pending}>{pending ? "Generando…" : "Generar clave temporal"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
