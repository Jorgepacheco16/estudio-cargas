"use client";
import { useState, useTransition } from "react";
import { validateCoverageAction } from "@/app/agente/actions";
import type { CoverageOutcome } from "@/server/coverage";
import { STATUS_ES } from "@/domain/coverage";

export interface CargoOption { id: string; label: string; hasFunctions: boolean; activities: number }

const STATUS_PILL = { none: "overload", partial: "low", covered: "ok" } as const;
const STATUS_ICON = { none: "✖", partial: "⚠", covered: "✔" } as const;

/**
 * Botón + resultado de la validación de cobertura. Con `cargoId` valida ese cargo (detalle del cargo); con `options` ofrece un selector (Agente de IA).
 * Ambas vías llaman a la MISMA acción de servidor. Mientras espera muestra el avance; si falla, el error trae su botón para reintentar.
 */
export function CoveragePanel({ cargoId, options }: { cargoId?: string; options?: CargoOption[] }) {
  const [sel, setSel] = useState(options?.[0]?.id ?? "");
  const [outcome, setOutcome] = useState<CoverageOutcome | null>(null);
  const [pending, start] = useTransition();
  const id = cargoId ?? sel;
  const run = () => start(async () => {
    setOutcome(null);
    try { setOutcome(await validateCoverageAction(id)); }
    catch { setOutcome({ ok: false, code: "error", message: "No se pudo contactar al servidor. Puede reintentar." }); }
  });
  const chosen = options?.find((o) => o.id === sel);
  return (
    <div className="coverage" aria-live="polite">
      <div className="coverage-bar">
        {options && (
          <label className="f" style={{ flex: "1 1 320px" }}>Cargo
            <select value={sel} onChange={(e) => { setSel(e.target.value); setOutcome(null); }} disabled={pending}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        )}
        <button className="btn solid" type="button" onClick={run} disabled={pending || !id}>{pending ? "Validando…" : "Validar cobertura de funciones"}</button>
      </div>
      {chosen && (!chosen.hasFunctions || chosen.activities === 0) && !outcome && <p className="note">{!chosen.hasFunctions ? "Este cargo aún no tiene funciones registradas en su perfil." : "Este cargo aún no tiene actividades creadas."}</p>}
      {!cargoId ? null : <p className="note">Se valida lo que está guardado del cargo. Si cambió el texto de las funciones, guarde antes de validar.</p>}
      {pending && <div className="banner" role="status" style={{ background: "var(--blue-soft)", color: "var(--blue)", marginTop: 12 }}>La IA está comparando las funciones con las actividades. Puede tardar hasta un minuto.</div>}
      {outcome && !outcome.ok && (
        <div className="banner" role="alert" style={{ background: outcome.code === "error" ? "var(--red-soft)" : undefined, color: outcome.code === "error" ? "var(--red-dark)" : undefined, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 320px" }}>{outcome.message}</span>
          {outcome.code === "error" && <button className="btn" type="button" onClick={run} disabled={pending}>Reintentar</button>}
        </div>
      )}
      {outcome?.ok && <CoverageResultView outcome={outcome} />}
    </div>
  );
}

function CoverageResultView({ outcome }: { outcome: Extract<CoverageOutcome, { ok: true }> }) {
  const r = outcome.result;
  const banner = r.level === "alert"
    ? { style: { background: "var(--red-soft)", color: "var(--red-dark)" }, text: `Alerta: ${r.counts.none} función(es) del perfil no tienen ninguna actividad asociada.` }
    : r.level === "warning"
      ? { style: undefined, text: `Advertencia: ${r.counts.partial} función(es) están cubiertas solo en parte o no permiten confirmar la cobertura.` }
      : { style: { background: "var(--green-soft)", color: "var(--green-dark)" }, text: "Todas las funciones del perfil están cubiertas por al menos una actividad." };
  return (
    <section className="coverage-result" aria-label="Resultado de la validación de cobertura">
      <h3>Cobertura de funciones · {outcome.cargo}</h3>
      <p className="coverage-summary"><b>{r.summary}</b></p>
      <div className="banner" role={r.level === "alert" ? "alert" : "status"} style={banner.style}>{banner.text}</div>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
        <table>
          <thead><tr><th>Función</th><th>Estado</th><th>Actividades que la cubren</th><th>Observación</th></tr></thead>
          <tbody>{r.functions.map((f) => (
            <tr key={f.n}>
              <td style={{ minWidth: 260 }}>{f.text}</td>
              <td><span className={`pill ${STATUS_PILL[f.status]}`}><span aria-hidden="true">{STATUS_ICON[f.status]} </span>{STATUS_ES[f.status]}</span></td>
              <td>{f.activities.length ? f.activities.map((a) => <div key={a.code}><b>{a.code}</b> <span className="muted">{a.name}</span></div>) : <span className="muted">Ninguna</span>}</td>
              <td>{f.note || <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <details className="adv" style={{ marginTop: 16 }} open>
        <summary>Funciones identificadas en el perfil ({r.functions.length})</summary>
        <div className="adv-body"><p className="note" style={{ marginTop: 0 }}>Así interpretó la IA el texto del perfil. Compruebe que no unió ni dividió funciones de forma incorrecta.</p>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>{[...r.functions].map((f) => <li key={f.n}>{f.text}</li>)}</ol></div>
      </details>
      <details className="adv" open={r.unrelated.length > 0}>
        <summary>Actividades no relacionadas con ninguna función ({r.unrelated.length})</summary>
        <div className="adv-body"><p className="note" style={{ marginTop: 0 }}>Es solo información, no una alerta: puede haber actividades legítimas que no figuren en el texto del perfil.</p>
          {r.unrelated.length ? <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{r.unrelated.map((a) => <li key={a.code}><b>{a.code}</b> <span className="muted">{a.name}</span></li>)}</ul> : <p>Todas las actividades se relacionaron con alguna función.</p>}</div>
      </details>
      <p className="note" style={{ fontWeight: 600 }}>Resultado generado por IA como apoyo; verifícalo antes de decidir.</p>
    </section>
  );
}
