"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { dependentOptions, type FacetOption, type Filters, type Triple } from "@/domain/filters";

export interface BarField { key: string; label: string; options: FacetOption[] }

/**
 * Barra de filtros de selección múltiple (D-74). Se envía por GET, así que los filtros quedan en la dirección de la página. Centro de operaciones, área y
 * cargo son DEPENDIENTES: al elegir un centro, el área y el cargo solo ofrecen lo que existe en él (`triples` trae las combinaciones reales).
 * `hidden` conserva otros parámetros de la página (modo de análisis, orden…).
 */
export interface BarRange { fromKey: string; toKey: string; label: string; from: string; to: string }
export function FilterBar({ fields, triples, current, search, range, shown, total, hidden = {}, clearHref }: {
  fields: BarField[]; triples?: Triple[]; current: Filters; search?: boolean; range?: BarRange | null; shown: number; total: number; hidden?: Record<string, string>; clearHref: string;
}) {
  const [dates, setDates] = useState({ from: range?.from ?? "", to: range?.to ?? "" });
  const [sel, setSel] = useState<Filters>(current);
  const [q, setQ] = useState(current.q?.[0] ?? "");
  const active = Object.entries(sel).filter(([k, v]) => k !== "q" && v.length > 0).length + (q.trim() ? 1 : 0) + (dates.from || dates.to ? 1 : 0);

  const dep = useMemo(() => (triples ? dependentOptions(triples, { co: sel.co, area: sel.area }) : null), [triples, sel.co, sel.area]);
  const optionsOf = (f: BarField): FacetOption[] => {
    if (!dep || !(f.key === "co" || f.key === "area" || f.key === "cargo")) return f.options;
    const allowed = new Set(dep[f.key]);
    return f.options.filter((o) => allowed.has(o.value));
  };
  // Lo elegido que ya no existe en las opciones (p. ej. un área que no es del centro elegido) no se envía.
  const effective = (f: BarField) => { const ok = new Set(optionsOf(f).map((o) => o.value)); return (sel[f.key] ?? []).filter((v) => ok.has(v)); };
  const toggle = (key: string, value: string) => setSel((p) => { const cur = new Set(p[key] ?? []); if (cur.has(value)) cur.delete(value); else cur.add(value); return { ...p, [key]: [...cur] }; });

  return (
    <details className="filters" open={active > 0}>
      <summary>Filtros{active > 0 && <span className="pill ok" style={{ marginLeft: 8 }}>{active} activo(s)</span>} <span className="muted">· Mostrando {shown} de {total}</span></summary>
      <form method="get" className="filters-body">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {search && (
          <label className="f" style={{ minWidth: 220 }}>Buscar
            <input name="q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} placeholder="Código, nombre o cargo" />
          </label>
        )}
        {fields.map((f) => {
          const opts = optionsOf(f), chosen = effective(f);
          return (
            <details key={f.key} className="ms" name="filtro-lista">
              <summary>{f.label}{chosen.length > 0 && <span className="pill ok" style={{ marginLeft: 6 }}>{chosen.length}</span>}</summary>
              <div className="ms-list" role="group" aria-label={f.label}>
                {opts.length === 0 && <span className="muted">Sin opciones</span>}
                {opts.map((o) => (
                  <label key={o.value}><input type="checkbox" name={f.key} value={o.value} checked={chosen.includes(o.value)} onChange={() => toggle(f.key, o.value)} /> {o.label}</label>
                ))}
              </div>
            </details>
          );
        })}
        {range && (
          <div className="f" role="group" aria-label={range.label} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label className="f">{range.label} (desde)<input type="date" name={range.fromKey} value={dates.from} onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))} /></label>
            <label className="f">hasta<input type="date" name={range.toKey} value={dates.to} onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))} /></label>
          </div>
        )}
        <div className="filters-actions">
          <button className="btn solid" type="submit">Aplicar filtros</button>
          <Link className="btn" href={clearHref}>Limpiar</Link>
        </div>
      </form>
    </details>
  );
}
