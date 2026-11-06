"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateReportAction } from "@/app/resultados/informe/actions";

/**
 * Diálogo de «Generar» o «Actualizar informe» (D-106): antes de gastar una redacción muestra qué cambió, qué secciones se vuelven a redactar y cuáles se reutilizan, exactamente qué se
 * enviará al agente, y cuántas redacciones lleva el día. Usa el elemento nativo <dialog> (Esc, foco atrapado, clic fuera para cerrar).
 */
export interface DialogSection { id: string; title: string }
export function GenerateDialog({ first, nextNumber, toWrite, toReuse, noData, changes, payloadJson, usage, limit, blocked }: {
  first: boolean; nextNumber: number; toWrite: DialogSection[]; toReuse: DialogSection[]; noData: DialogSection[];
  changes: { label: string; before: string; after: string }[]; payloadJson: string; usage: number; limit: number; blocked: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId(), router = useRouter();
  const [error, setError] = useState(""), [pending, start] = useTransition();
  const label = first ? "Generar el informe" : "Actualizar informe";
  const left = Math.max(0, limit - usage - (toWrite.length > 0 ? 1 : 0));
  const go = () => start(async () => {
    setError("");
    const r = await generateReportAction();
    if (r.ok) { ref.current?.close(); router.push(`/resultados/informe?v=${r.number}`); router.refresh(); }
    else setError(r.message);
  });
  return (
    <>
      <button type="button" className="btn solid" onClick={() => ref.current?.showModal()} aria-haspopup="dialog" disabled={blocked !== null} title={blocked ?? undefined}>{label}</button>
      <dialog ref={ref} className="day-dialog" aria-labelledby={id} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="dd-form">
          <h3 id={id}>{label}</h3>
          <p className="note" style={{ margin: "4px 0 0" }}>Se creará la <b>versión {nextNumber}</b> como borrador. {first ? "Una persona con Edición en Resultados la revisa y la aprueba." : "Las versiones anteriores se quedan guardadas tal como están."}</p>
          {!first && (
            <section style={{ marginTop: 12 }}>
              <h4 style={{ margin: "0 0 6px", fontSize: ".9375rem" }}>Qué cambió desde la versión anterior</h4>
              {changes.length === 0 ? <p className="note" style={{ margin: 0 }}>Ninguna de las cifras principales cambió.</p> : (
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Cifras que cambiaron">
                  <table style={{ minWidth: 0, fontSize: ".875rem" }}><thead><tr><th>Cifra</th><th className="num">Antes</th><th className="num">Ahora</th></tr></thead>
                    <tbody>{changes.map((c) => <tr key={c.label}><td>{c.label}</td><td className="num">{c.before}</td><td className="num"><b>{c.after}</b></td></tr>)}</tbody></table>
                </div>
              )}
            </section>
          )}
          <section style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div style={{ flex: "1 1 240px" }}><h4 style={{ margin: "0 0 4px", fontSize: ".9375rem" }}>Se redactan ({toWrite.length})</h4>
              {toWrite.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{toWrite.map((s) => <li key={s.id}>{s.title}</li>)}</ul> : <p className="note" style={{ margin: 0 }}>Ninguna: todo se reutiliza.</p>}</div>
            <div style={{ flex: "1 1 240px" }}><h4 style={{ margin: "0 0 4px", fontSize: ".9375rem" }}>Se reutilizan sin cambios ({toReuse.length})</h4>
              {toReuse.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{toReuse.map((s) => <li key={s.id}>{s.title}</li>)}</ul> : <p className="note" style={{ margin: 0 }}>Ninguna.</p>}
              {noData.length > 0 && <p className="note" style={{ margin: "6px 0 0" }}>Sin datos, no se redactan: {noData.map((s) => s.title).join(", ")}.</p>}</div>
          </section>
          <section style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 4px", fontSize: ".9375rem" }}>Qué se enviará al agente</h4>
            <p className="note" style={{ margin: 0 }}><b>Se envía:</b> cifras calculadas; nombres de áreas, cargos y actividades; la descripción de la operación y los turnos, con correos, teléfonos y números largos quitados. <b>No se envía:</b> nombres de personas, códigos de colaborador, correos ni notas libres de las actividades.</p>
            <details className="adv" style={{ marginTop: 6 }}><summary>Ver el texto exacto que se enviaría</summary><div className="adv-body"><pre style={{ margin: 0, maxHeight: 240, overflow: "auto", fontSize: ".75rem", whiteSpace: "pre-wrap" }}>{payloadJson}</pre></div></details>
          </section>
          <p className="note" style={{ marginTop: 12 }}><b>Redacciones de hoy:</b> {usage} de {limit}{usage < limit ? ` · después quedarían ${left}` : " · se alcanzó el tope"}.</p>
          {error && <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{error}</div>}
          <div className="dd-actions">
            <button type="button" className="btn" onClick={() => ref.current?.close()} disabled={pending} autoFocus>Cancelar</button>
            <button type="button" className="btn solid" onClick={go} disabled={pending || usage >= limit}>{pending ? "Redactando… puede tardar un minuto" : label}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
