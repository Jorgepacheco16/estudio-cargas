import Link from "next/link";
import { FilterBar, type BarField } from "@/components/FilterBar";
import { getDb } from "@/db/server";
import { filterQuery, type FacetOption } from "@/domain/filters";
import { ACTION_LABEL, KIND_LABEL, ORIGIN_LABEL, SECTIONS, actionLabel, diffLines, originLabel, sectionOf } from "@/domain/changelog";
import { actorLabel, changeFacets, queryChanges, readChangeFilters } from "@/server/changelog";

/**
 * Registro de cambios (D-96): quién cambió qué, cuándo y sobre qué área, cargo o registro. Solo consulta. Los filtros viajan en la dirección de la página, así que se puede
 * compartir o volver a una búsqueda; la descarga a Excel usa los mismos filtros.
 */
const when = (d: Date) => d.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
const opts = (m: Record<string, string>): FacetOption[] => Object.entries(m).map(([value, label]) => ({ value, label }));

export async function CambiosView({ userId, studyId, sp }: { userId: string; studyId: string; sp: Record<string, string | undefined> }) {
  const db = getDb();
  const { current, filters, desde, hasta } = readChangeFilters(sp);
  const page = Number(sp.pagina) || 1;
  const [result, facets] = await Promise.all([queryChanges(db, userId, studyId, filters, page), changeFacets(db, userId, studyId)]);
  const fields: BarField[] = [
    { key: "tipo", label: "Tipo de cambio", options: opts(KIND_LABEL) },
    { key: "seccion", label: "Sección", options: SECTIONS.map((s) => ({ value: s, label: s })) },
    { key: "usuario", label: "Usuario", options: facets.users },
    { key: "area", label: "Área", options: facets.areas.map((a) => ({ value: a, label: a })) },
    { key: "cargo", label: "Cargo", options: facets.positions.map((a) => ({ value: a, label: a })) },
    { key: "accion", label: "Acción", options: opts(Object.fromEntries(Object.keys(ACTION_LABEL).map((a) => [a, actionLabel(a)]))) },
    { key: "origen", label: "Origen", options: opts(ORIGIN_LABEL) },
  ];
  // Los filtros de selección múltiple repiten la clave (area=A&area=B): se arma con URLSearchParams para no perder ningún valor.
  const base = new URLSearchParams(filterQuery(current));
  if (desde) base.set("desde", desde);
  if (hasta) base.set("hasta", hasta);
  const link = (p: number) => { const u = new URLSearchParams(base); u.set("vista", "cambios"); u.set("pagina", String(p)); return `/historia?${u.toString()}`; };
  const download = `/api/cambios/export?${base.toString()}`;

  return (
    <>
      <FilterBar
        key={`${filterQuery(current)}|${desde}|${hasta}`} fields={fields} current={current} search searchPlaceholder="Persona, área, cargo, código, detalle…"
        range={{ fromKey: "desde", toKey: "hasta", label: "Fecha", from: desde, to: hasta }} shown={result.total} total={result.all} hidden={{ vista: "cambios" }} clearHref="/historia?vista=cambios"
      />
      <section className="card" aria-label="Registro de cambios">
        <div className="head" style={{ marginBottom: 8 }}>
          <div>
            <h2>Registro de cambios ({result.total})</h2>
            <p className="note">Todo lo que se crea, modifica o elimina en las secciones y en la administración, con la persona que lo hizo. Es de solo consulta: nadie puede modificar ni borrar este registro.</p>
          </div>
          <a className="btn" href={download} download>Descargar Excel</a>
        </div>
        {result.rows.length === 0 ? (
          <div className="empty">{result.all === 0 ? "Aún no hay cambios registrados." : "Ningún cambio cumple los filtros."}</div>
        ) : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Registro de cambios (tabla desplazable)">
            <table>
              <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Sección</th><th>Acción</th><th>Registro</th><th>Área</th><th>Cargo</th><th>Detalle</th><th>Origen</th></tr></thead>
              <tbody>
                {result.rows.map((r) => {
                  const lines = diffLines(r.action, r.diff);
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td>
                      <td><b>{actorLabel(r)}</b>{r.actor && r.email && <div className="muted">{r.email}</div>}</td>
                      <td>{sectionOf(r.entity)}</td>
                      <td>{actionLabel(r.action)}</td>
                      <td>{r.subject ?? "—"}</td>
                      <td>{r.area ?? "—"}</td>
                      <td>{r.position ?? "—"}</td>
                      <td>
                        {lines.length === 0 ? "—" : (
                          <details>
                            <summary>{lines[0].field}{lines.length > 1 ? ` y ${lines.length - 1} más` : ""}</summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                              {lines.map((l) => <li key={l.field}><b>{l.field}:</b> {l.from !== null && l.to !== null ? <>{l.from} → {l.to}</> : (l.to ?? l.from)}</li>)}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td>{originLabel(r.origin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {result.pages > 1 && (
          <nav aria-label="Páginas del registro" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 10 }}>
            {result.page > 1 ? <Link className="btn" href={link(result.page - 1)}>← Anterior</Link> : <span className="btn" aria-disabled="true" style={{ opacity: 0.4 }}>← Anterior</span>}
            <span className="muted">Página {result.page} de {result.pages}</span>
            {result.page < result.pages ? <Link className="btn" href={link(result.page + 1)}>Siguiente →</Link> : <span className="btn" aria-disabled="true" style={{ opacity: 0.4 }}>Siguiente →</span>}
          </nav>
        )}
      </section>
    </>
  );
}
