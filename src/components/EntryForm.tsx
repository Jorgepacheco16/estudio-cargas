"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveEntryAction, type FormState } from "@/app/entrada/actions";

export interface FormField { col: string; header: string; hint: string; group: string; control: string; options: string[]; required: boolean }
export interface FormComputed { col: string; header: string; value: string }
export interface Lookups { areas: string[]; sites: string[]; positions: string[]; activities: { code: string; name: string }[] }

export function EntryForm({ hoja, base, recId, version, fields, computed, initial, lookups, canWrite }: {
  hoja: string; base: string; recId?: string; version?: number; fields: FormField[]; computed: FormComputed[]; initial: Record<string, string>; lookups: Lookups; canWrite: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEntryAction, { errors: [], values: initial });
  const val = (col: string) => state.values[col] ?? "";
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <form action={action} style={{ display: "grid", gap: 16 }}>
      <input type="hidden" name="hoja" value={hoja} />
      {recId && <><input type="hidden" name="recId" value={recId} /><input type="hidden" name="version" value={version} /></>}
      {state.errors.length > 0 && (
        <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>
          <b>No se guardó:</b><ul style={{ margin: "4px 0 0 18px" }}>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {groups.map((g) => (
        <fieldset key={g} className="card" style={{ border: "1px solid var(--line, #ddd)" }}>
          <legend style={{ fontWeight: 600, padding: "0 6px" }}>{g}</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            {fields.filter((f) => f.group === g).map((f) => {
              const name = `c_${f.col}`, common = { name, id: name, defaultValue: val(f.col), required: false, title: f.hint || undefined };
              const options = f.control === "area" ? lookups.areas : f.control === "select" ? f.options : f.control === "yesno" ? ["Sí", "No"] : [];
              let input;
              if (options.length || f.control === "area" || f.control === "select" || f.control === "yesno") {
                input = <select {...common}><option value="">(sin definir)</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
              } else if (f.control === "activity") {
                input = <select {...common}><option value="">(elija)</option>{lookups.activities.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>;
              } else if (f.control === "textarea") {
                input = <textarea {...common} rows={3} maxLength={4000} placeholder={f.hint} />;
              } else if (f.control === "date") {
                input = <input {...common} type="date" />;
              } else {
                const list = f.control === "site" ? "dl_sites" : f.control === "position" ? "dl_positions" : undefined;
                input = <input {...common} list={list} maxLength={300} inputMode={f.control === "number" || f.control === "percent" ? "decimal" : undefined} placeholder={f.control === "percent" ? "Ej.: 15 %" : f.hint} />;
              }
              return (
                <label key={f.col} className="f" htmlFor={name}>
                  {f.header}{f.required ? " *" : ""}
                  {input}
                  {f.hint && <span className="muted" style={{ fontSize: 12 }}>{f.hint}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <datalist id="dl_sites">{lookups.sites.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="dl_positions">{lookups.positions.map((s) => <option key={s} value={s} />)}</datalist>
      {computed.length > 0 && (
        <section className="card" aria-label="Calculado por la hoja (no editable)">
          <h2>Calculado por la hoja (no editable)</h2>
          <p className="note">Estos valores los resuelve la fórmula del libro; la aplicación los muestra, no los captura. Se actualizan al guardar.</p>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 8 }}>
            {computed.map((c) => <div key={c.col}><dt className="muted" style={{ fontSize: 12 }}>{c.header}</dt><dd style={{ margin: 0 }}>{c.value === "" ? "—" : c.value}</dd></div>)}
          </dl>
        </section>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn solid" type="submit" disabled={!canWrite || pending}>{pending ? "Guardando…" : "Guardar"}</button>
        <Link className="btn" href={base}>Cancelar</Link>
      </div>
      {!canWrite && <div className="banner">Su rol es de solo lectura: no puede modificar este estudio.</div>}
    </form>
  );
}
