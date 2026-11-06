"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateSectionAction, saveSectionTextAction } from "@/app/resultados/informe/actions";

/**
 * Acciones de una sección de un borrador (D-106): editar el texto a mano y volver a redactarla con el agente. Lo editado a mano se verifica igual que el del agente: los números con
 * dígitos deben ser los de las cifras de la sección; si no, la sección queda «requiere revisión» y no se puede aprobar.
 */
export function SectionActions({ versionId, sectionId, title, text, canRegenerate, regenBlocked }: { versionId: string; sectionId: string; title: string; text: string; canRegenerate: boolean; regenBlocked: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false), [value, setValue] = useState(text), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setError(""); setNotice("");
    const r = await saveSectionTextAction(versionId, sectionId, value);
    if (r.ok) { setEditing(false); setNotice(r.status === "review" ? `Se guardó, pero requiere revisión: ${r.note ?? ""}` : "Texto guardado."); router.refresh(); } else setError(r.message);
  });
  const regen = () => start(async () => {
    setError(""); setNotice("");
    const r = await regenerateSectionAction(versionId, sectionId);
    if (r.ok) { setNotice("Sección redactada de nuevo."); router.refresh(); } else setError(r.message);
  });
  return (
    <div style={{ marginTop: 12 }}>
      {editing ? (
        <div>
          <label htmlFor={`ed-${sectionId}`} style={{ fontWeight: 600, fontSize: ".875rem" }}>Texto de «{title}» (separe los párrafos con una línea en blanco)</label>
          <textarea id={`ed-${sectionId}`} value={value} onChange={(e) => setValue(e.target.value)} rows={8} maxLength={6000} style={{ width: "100%", marginTop: 6, font: "inherit", padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "var(--card)", color: "var(--ink)" }} />
          <p className="note" style={{ margin: "4px 0 8px" }}>Si escribe números, deben ser los de las cifras de esta sección; si no, quedará «requiere revisión».</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn solid" onClick={save} disabled={pending}>{pending ? "Guardando…" : "Guardar el texto"}</button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setValue(text); setError(""); }} disabled={pending}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn" onClick={() => { setValue(text); setEditing(true); }} disabled={pending}>Editar el texto</button>
          <button type="button" className="btn" onClick={regen} disabled={pending || !canRegenerate} title={regenBlocked ?? undefined}>{pending ? "Redactando…" : "Redactar de nuevo esta sección"}</button>
        </div>
      )}
      {!editing && !canRegenerate && regenBlocked && <p className="note" style={{ margin: "6px 0 0" }}>{regenBlocked}</p>}
      <p className="sr-only" role="status" aria-live="polite">{notice}</p>
      {notice && <p className="note" style={{ margin: "6px 0 0" }}>{notice}</p>}
      {error && <div className="banner" role="alert" style={{ marginTop: 8, background: "var(--red-soft)", color: "var(--red-dark)" }}>{error}</div>}
    </div>
  );
}
