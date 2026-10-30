"use client";
import { useActionState, useState } from "react";
import { inviteAction, type InviteState } from "@/app/usuarios/actions";
import { AreaPicker } from "./AreaPicker";

/** Invitar a una persona: correo, rol y áreas. Al crearla muestra el enlace UNA sola vez (en la base solo queda su huella). */
export function InviteForm({ roles, areas }: { roles: { id: string; name: string; summary: string }[]; areas: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(state.link ?? ""); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* el enlace queda visible para copiarlo a mano */ } };
  return (
    <form action={action} className="entry-form">
      {state.error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{state.error}</div>}
      {state.ok && state.link && (
        <div className="banner invite-link" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
          <div><b>Invitación creada para {state.email}.</b> Envíele este enlace (sirve una sola vez y vence en 7 días). Por seguridad no se vuelve a mostrar: si lo pierde, cree otra invitación.</div>
          <div className="invite-row"><input readOnly value={state.link} aria-label="Enlace de invitación" onFocus={(e) => e.currentTarget.select()} /><button type="button" className="btn solid" onClick={copy}>{copied ? "Copiado" : "Copiar enlace"}</button></div>
        </div>
      )}
      <div className="form-grid">
        <div className="field span-two"><label htmlFor="inv-correo">Correo de la persona <span className="req" title="Obligatorio">*</span></label><input id="inv-correo" name="correo" type="email" required maxLength={254} placeholder="nombre@empresa.com" autoComplete="off" /><p className="hint">Debe ser el correo con el que la persona va a entrar.</p></div>
        <div className="field span-two"><label htmlFor="inv-rol">Rol <span className="req" title="Obligatorio">*</span></label>
          <select id="inv-rol" name="rol" required defaultValue=""><option value="" disabled>(elija un rol)</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.summary}</option>)}</select></div>
      </div>
      <AreaPicker areas={areas} />
      <div className="form-actions" style={{ position: "static", borderTop: 0, padding: 0 }}><button className="btn solid" type="submit" disabled={pending}>{pending ? "Creando…" : "Crear invitación y enlace"}</button></div>
    </form>
  );
}
