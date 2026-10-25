"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveEntryAction, type FormState } from "@/app/entrada/actions";
import { CoveragePanel } from "@/components/CoveragePanel";

export interface FormField { col: string; header: string; hint: string; group: string; control: string; options: string[]; required: boolean }
export interface FormComputed { col: string; header: string; value: string }
export interface Lookups { areas: string[]; sites: string[]; positions: string[]; activities: { code: string; name: string }[] }

/** Cuánto ancho ocupa cada campo: los textos largos ocupan toda la fila, los nombres y cargos dos columnas, el resto una. */
const spanOf = (f: FormField): "full" | "two" | "one" => {
  if (f.control === "textarea") return "full";
  if (f.control === "text" || f.control === "position" || f.control === "site") return f.header.length > 34 || /nombre|cargo|proceso|otros|responsable|indicador/i.test(f.header) ? "two" : "one";
  return "one";
};

export function EntryForm({ hoja, base, recId, version, fields, computed, initial, lookups, canWrite, coverage }: {
  coverage?: { cargoId: string; afterCol: string }; hoja: string; base: string; recId?: string; version?: number; fields: FormField[]; computed: FormComputed[]; initial: Record<string, string>; lookups: Lookups; canWrite: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEntryAction, { errors: [], values: initial });
  const val = (col: string) => state.values[col] ?? "";
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <form action={action} className="entry-form">
      <input type="hidden" name="hoja" value={hoja} />
      {recId && <><input type="hidden" name="recId" value={recId} /><input type="hidden" name="version" value={version} /></>}
      {state.errors.length > 0 && (
        <div className="banner" role="alert" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>
          <div><b>No se guardó:</b><ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
        </div>
      )}
      {groups.map((g, gi) => (
        <section key={g} className="card" role="group" aria-labelledby={`g${gi}`}>
          <h2 id={`g${gi}`}>{g}</h2>
          <div className="form-grid">
            {fields.filter((f) => f.group === g).map((f) => {
              const name = `c_${f.col}`, hint = `${name}-h`;
              const common = { name, id: name, defaultValue: val(f.col), "aria-describedby": f.hint ? hint : undefined };
              const options = f.control === "area" ? lookups.areas : f.control === "select" ? f.options : f.control === "yesno" ? ["Sí", "No"] : [];
              let input;
              if (options.length || f.control === "area" || f.control === "select" || f.control === "yesno") {
                input = <select {...common}><option value="">(sin definir)</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
              } else if (f.control === "activity") {
                input = <select {...common}><option value="">(elija)</option>{lookups.activities.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>;
              } else if (f.control === "textarea") {
                input = <textarea {...common} rows={4} maxLength={4000} />;
              } else if (f.control === "date") {
                input = <input {...common} type="date" />;
              } else {
                const list = f.control === "site" ? "dl_sites" : f.control === "position" ? "dl_positions" : undefined;
                input = <input {...common} list={list} maxLength={300} inputMode={f.control === "number" || f.control === "percent" ? "decimal" : undefined} placeholder={f.control === "percent" ? "Ej.: 15 %" : undefined} />;
              }
              return (
                <div key={f.col} className={`field span-${spanOf(f)}`}>
                  <label htmlFor={name}>{f.header}{f.required && <span className="req" title="Obligatorio"> *</span>}</label>
                  {input}
                  <p className="hint" id={hint}>{f.hint}</p>
                </div>
              );
            })}
          </div>
          {coverage && fields.some((f) => f.group === g && f.col === coverage.afterCol) && (
            <div className="coverage-box">
              <h3>Cobertura de las funciones del perfil</h3>
              <p className="note" style={{ marginTop: 0 }}>Al terminar de ingresar las actividades de este cargo, pida a la IA que compruebe que ninguna función del perfil quedó sin actividad.</p>
              <CoveragePanel cargoId={coverage.cargoId} />
            </div>
          )}
        </section>
      ))}
      <datalist id="dl_sites">{lookups.sites.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="dl_positions">{lookups.positions.map((s) => <option key={s} value={s} />)}</datalist>
      {computed.length > 0 && (
        <section className="card calc-card" aria-label="Calculado por la hoja (no editable)">
          <h2>Calculado por la hoja (no editable)</h2>
          <p className="note">🔒 Estos valores los resuelve la fórmula del libro; la aplicación los muestra, no los captura. Se actualizan al guardar.</p>
          <dl className="calc-grid">
            {computed.map((c) => <div key={c.col}><dt>{c.header}</dt><dd>{c.value === "" ? "—" : c.value}</dd></div>)}
          </dl>
        </section>
      )}
      {!canWrite && <div className="banner">Su rol es de solo lectura: no puede modificar este estudio.</div>}
      <div className="form-actions">
        <button className="btn solid" type="submit" disabled={!canWrite || pending}>{pending ? "Guardando…" : "Guardar"}</button>
        <Link className="btn" href={base}>Cancelar</Link>
      </div>
    </form>
  );
}
