"use client";
import { useActionState } from "react";
import { saveParamsAction } from "@/app/entrada/actions";
import type { FormState } from "@/app/entrada/actions";

export interface ParamField { key: string; label: string; kind: string; hint?: string; options: { code: string; label: string }[] }

export function ParamsForm({ fields, initial, version, canWrite }: { fields: ParamField[]; initial: Record<string, string>; version: number; canWrite: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveParamsAction, { errors: [], values: initial });
  return (
    <form action={action} className="entry-form" style={{ marginTop: 16 }}>
      <input type="hidden" name="version" value={version} />
      {state.errors.length > 0 && (
        <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>
          <div><b>No se guardó:</b><ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
        </div>
      )}
      <div className="form-grid">
        {fields.map((f) => (
          <div key={f.key} className="field span-one">
            <label htmlFor={`p_${f.key}`}>{f.label}</label>
            {f.kind === "list" ? <select id={`p_${f.key}`} name={f.key} defaultValue={state.values[f.key] ?? ""}>{f.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
              : f.kind === "bool" ? <select id={`p_${f.key}`} name={f.key} defaultValue={state.values[f.key] ?? ""}><option value="yes">Sí</option><option value="no">No</option></select>
              : <input id={`p_${f.key}`} name={f.key} defaultValue={state.values[f.key] ?? ""} inputMode="decimal" />}
            <p className="hint">{f.hint}</p>
          </div>
        ))}
      </div>
      <div className="form-actions" style={{ position: "static", borderTop: 0, padding: 0 }}>
        <button className="btn solid" type="submit" disabled={!canWrite || pending}>{pending ? "Guardando…" : "Guardar parámetros"}</button>
      </div>
    </form>
  );
}
