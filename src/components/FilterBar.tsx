"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { dependentOptions, type FacetOption, type Filters, type Triple } from "@/domain/filters";

export interface BarField { key: string; label: string; options: FacetOption[] }

/**
 * Barra de filtros de selección múltiple (D-74). Se envía por GET, así que los filtros quedan en la dirección de la página. Centro de operaciones, área y
 * cargo son DEPENDIENTES: al elegir un centro, el área y el cargo solo ofrecen lo que existe en él (`triples` trae las combinaciones reales).
 * `hidden` conserva otros parámetros de la página (modo de análisis, orden…).
 * Presentación: cada filtro es una lista desplegable con buscador, «Todos / Ninguno» y casillas; lo elegido se resume en el botón y aparece debajo como etiquetas que se quitan con un clic.
 */
export interface BarRange { fromKey: string; toKey: string; label: string; from: string; to: string }

const Funnel = () => <svg className="fb-ico" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 4h14l-5.2 6.2V16l-3.6-1.8v-4L3 4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
const Chevron = () => <svg className="fb-chev" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function FilterBar({ fields, triples, current, search, range, shown, total, hidden = {}, clearHref }: {
  fields: BarField[]; triples?: Triple[]; current: Filters; search?: boolean; range?: BarRange | null; shown: number; total: number; hidden?: Record<string, string>; clearHref: string;
}) {
  const [dates, setDates] = useState({ from: range?.from ?? "", to: range?.to ?? "" });
  const [sel, setSel] = useState<Filters>(current);
  const [q, setQ] = useState(current.q?.[0] ?? "");
  const [find, setFind] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const rootRef = useRef<HTMLDetailsElement>(null);

  const dep = useMemo(() => (triples ? dependentOptions(triples, { co: sel.co, area: sel.area }) : null), [triples, sel.co, sel.area]);
  const optionsOf = (f: BarField): FacetOption[] => {
    if (!dep || !(f.key === "co" || f.key === "area" || f.key === "cargo")) return f.options;
    const allowed = new Set(dep[f.key]);
    return f.options.filter((o) => allowed.has(o.value));
  };
  // Lo elegido que ya no existe en las opciones (p. ej. un área que no es del centro elegido) no se envía.
  const effective = (f: BarField) => { const ok = new Set(optionsOf(f).map((o) => o.value)); return (sel[f.key] ?? []).filter((v) => ok.has(v)); };
  const toggle = (key: string, value: string) => setSel((p) => { const cur = new Set(p[key] ?? []); if (cur.has(value)) cur.delete(value); else cur.add(value); return { ...p, [key]: [...cur] }; });
  const setAll = (f: BarField, on: boolean) => setSel((p) => ({ ...p, [f.key]: on ? optionsOf(f).map((o) => o.value) : [] }));

  const chips: { id: string; text: string; remove: () => void }[] = [];
  for (const f of fields) for (const v of effective(f)) chips.push({ id: `${f.key}|${v}`, text: `${f.label}: ${f.options.find((o) => o.value === v)?.label ?? v}`, remove: () => toggle(f.key, v) });
  if (q.trim()) chips.push({ id: "q", text: `Búsqueda: ${q.trim()}`, remove: () => setQ("") });
  if (range && (dates.from || dates.to)) chips.push({ id: "fecha", text: `${range.label}: ${dates.from || "…"} → ${dates.to || "…"}`, remove: () => setDates({ from: "", to: "" }) });
  const active = chips.length;

  // Cierra la lista abierta al hacer clic fuera de ella o al pulsar Escape.
  useEffect(() => {
    const close = (except?: Element | null) => rootRef.current?.querySelectorAll("details.ms[open]").forEach((d) => { if (d !== except) d.removeAttribute("open"); });
    const onDown = (e: MouseEvent) => close((e.target as Element | null)?.closest("details.ms"));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  const summaryOf = (f: BarField, chosen: string[]) => chosen.length === 0 ? "Todos" : chosen.length === 1 ? (f.options.find((o) => o.value === chosen[0])?.label ?? chosen[0]) : `${chosen.length} seleccionados`;
  // Quitar una etiqueta aplica el filtro de inmediato (después de que React actualice el formulario).
  const removeChip = (fn: () => void) => { fn(); setTimeout(() => formRef.current?.requestSubmit(), 0); };

  return (
    <details className="filters" open={active > 0} ref={rootRef}>
      <summary>
        <Funnel /><span className="fb-title">Filtros</span>
        {active > 0 && <span className="fb-badge" title="Filtros activos">{active}</span>}
        <span className="fb-count">Mostrando <b>{shown}</b> de {total}</span>
        <Chevron />
      </summary>
      <form method="get" className="filters-body" ref={formRef}>
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="fb-row">
          {search && (
            <label className="fb-field fb-search">
              <span className="fb-label">Buscar</span>
              <input name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} placeholder="Código, nombre o cargo" />
            </label>
          )}
          {fields.map((f) => {
            const opts = optionsOf(f), chosen = effective(f), term = (find[f.key] ?? "").trim().toLowerCase();
            const shownOpts = term ? opts.filter((o) => o.label.toLowerCase().includes(term)) : opts;
            return (
              <div key={f.key} className="fb-field">
                <span className="fb-label">{f.label}</span>
                <details className="ms" name="filtro-lista">
                  <summary className={chosen.length > 0 ? "has" : ""}>
                    <span className="ms-text">{summaryOf(f, chosen)}</span>
                    {chosen.length > 1 && <span className="fb-badge sm">{chosen.length}</span>}
                    <Chevron />
                  </summary>
                  <div className="ms-pop" role="group" aria-label={f.label}>
                    {opts.length > 8 && <input className="ms-find" type="search" placeholder="Buscar…" aria-label={`Buscar en ${f.label}`} value={find[f.key] ?? ""} onChange={(e) => setFind((p) => ({ ...p, [f.key]: e.target.value }))} />}
                    {opts.length > 1 && (
                      <div className="ms-tools">
                        <button type="button" onClick={() => setAll(f, true)}>Seleccionar todo</button>
                        <button type="button" onClick={() => setAll(f, false)} disabled={chosen.length === 0}>Ninguno</button>
                      </div>
                    )}
                    <div className="ms-list">
                      {opts.length === 0 && <span className="muted">Sin opciones</span>}
                      {opts.length > 0 && shownOpts.length === 0 && <span className="muted">Sin coincidencias</span>}
                      {shownOpts.map((o) => (
                        <label key={o.value} className={chosen.includes(o.value) ? "on" : ""}><input type="checkbox" name={f.key} value={o.value} checked={chosen.includes(o.value)} onChange={() => toggle(f.key, o.value)} /> <span>{o.label}</span></label>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
          {range && (
            <div className="fb-field fb-dates" role="group" aria-label={range.label}>
              <span className="fb-label">{range.label}</span>
              <div className="fb-daterow">
                <input type="date" name={range.fromKey} value={dates.from} aria-label={`${range.label} desde`} onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))} />
                <span aria-hidden="true">→</span>
                <input type="date" name={range.toKey} value={dates.to} aria-label={`${range.label} hasta`} onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))} />
              </div>
            </div>
          )}
          <div className="filters-actions">
            <button className="btn solid" type="submit">Aplicar filtros</button>
            <Link className="btn" href={clearHref}>Limpiar</Link>
          </div>
        </div>
        {chips.length > 0 && (
          <ul className="fb-chips" aria-label="Filtros activos">
            {chips.map((c) => <li key={c.id}><span>{c.text}</span><button type="button" aria-label={`Quitar ${c.text}`} onClick={() => removeChip(c.remove)}>×</button></li>)}
          </ul>
        )}
      </form>
    </details>
  );
}
