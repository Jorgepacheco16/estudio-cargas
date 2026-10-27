"use client";
import { Children, isValidElement, useState, type CSSProperties, type ReactNode } from "react";

const SIZES = [10, 25, 50];

/** Tabla con paginación (10 filas por página por defecto) para que el desplazamiento sea corto y los títulos no se pierdan de vista. Las filas llegan ya dibujadas por el servidor; aquí solo se muestra la porción de la página. */
export function PagedTable({ head, rows, foot, minWidth, label = "Tabla desplazable", style }: { head: ReactNode; rows: ReactNode; foot?: ReactNode; minWidth?: number; label?: string; style?: CSSProperties }) {
  const all = Children.toArray(rows);
  const total = all.length;
  // Firma del contenido: si cambian los filtros o los datos, vuelve a la página 1.
  const keyOf = (n: ReactNode) => (isValidElement(n) ? String(n.key ?? "") : "");
  const sig = `${total}|${keyOf(all[0])}|${keyOf(all[total - 1])}`;
  const [st, setSt] = useState({ sig, page: 0, size: SIZES[0] });
  const size = st.size;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = st.sig === sig ? Math.min(st.page, pages - 1) : 0;
  const go = (p: number) => setSt({ sig, page: Math.max(0, Math.min(pages - 1, p)), size });
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={label}>
        <table style={{ ...(minWidth ? { minWidth } : null), ...style }}>
          <thead>{head}</thead>
          <tbody>{all.slice(page * size, (page + 1) * size)}</tbody>
          {foot}
        </table>
      </div>
      {total > SIZES[0] && (
        <div className="pager" role="navigation" aria-label="Paginación de la tabla">
          <label>Filas por página:{" "}
            <select value={size} onChange={(e) => setSt({ sig, page: 0, size: Number(e.target.value) })}>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <span aria-live="polite">{from}–{to} de {total}</span>
          <button type="button" className="pager-btn" onClick={() => go(page - 1)} disabled={page === 0} aria-label="Página anterior">‹</button>
          <button type="button" className="pager-btn" onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="Página siguiente">›</button>
        </div>
      )}
    </>
  );
}
