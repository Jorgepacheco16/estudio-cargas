"use client";
import { useActionState } from "react";
import { saveParamsAction } from "@/app/datos/actions";
import type { FormState } from "@/app/datos/actions";

export interface ParamField { key: string; label: string; kind: string; options: { code: string; label: string }[] }

export function ParamsForm({ fields, initial, version, canWrite }: { fields: ParamField[]; initial: Record<string, string>; version: number; canWrite: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveParamsAction, { errors: [], values: initial });
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="version" value={version} />
      {state.errors.length > 0 && (
        <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>
          <b>No se guardó:</b><ul style={{ margin: "4px 0 0 18px" }}>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {fields.map((f) => (
          <label key={f.key} className="f">{f.label}
            {f.kind === "list" ? <select name={f.key} defaultValue={state.values[f.key] ?? ""}>{f.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
              : f.kind === "bool" ? <select name={f.key} defaultValue={state.values[f.key] ?? ""}><option value="yes">Sí</option><option value="no">No</option></select>
              : <input name={f.key} defaultValue={state.values[f.key] ?? ""} inputMode="decimal" />}
          </label>
        ))}
      </div>
      <div><button className="btn solid" type="submit" disabled={!canWrite || pending}>{pending ? "Guardando…" : "Guardar parámetros"}</button></div>
    </form>
  );
}
