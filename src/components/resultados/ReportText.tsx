import { ConfirmButton } from "@/components/ConfirmButton";
import { GenerateDialog } from "@/components/resultados/GenerateDialog";
import { SectionActions } from "@/components/resultados/SectionActions";
import { approveVersionAction, discardDraftAction } from "@/app/resultados/informe/actions";
import { SECTION_IDS, SECTION_TITLE, STATUS_ES, buildSectionPayload, canApprove, diffCatalog, joinParagraphs, planSections, type ReportSection } from "@/domain/report-text";
import type { ReportBasis, ReportVersion } from "@/server/report-version";

/**
 * Texto del informe (D-106): versiones, secciones con su estado, cifras citadas y las acciones de quien puede cambiar el informe. Las cifras de todo el tablero son siempre las de hoy; el
 * texto es el de la versión elegida, y si los datos cambiaron desde que se redactó se avisa.
 */
const PILL: Record<ReportSection["status"], string> = { verified: "ok", edited: "low", nodata: "nodata", review: "overload" };
const STATUS_VERSION = { draft: "Borrador", approved: "Aprobada", superseded: "Reemplazada" } as const;
const when = (d: Date | null) => (d ? d.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }) : "—");

export function ReportText({ versions, selected, basis, canManage, canGenerate, usage, limit }: {
  versions: ReportVersion[]; selected: ReportVersion | null; basis: ReportBasis; canManage: boolean; canGenerate: boolean; usage: number; limit: number;
}) {
  const draft = versions.find((v) => v.status === "draft") ?? null, latest = versions[0] ?? null;
  const first = versions.length === 0, nextNumber = (latest?.number ?? 0) + 1;
  const plan = planSections(basis.hashes, basis.hasData, latest?.sections ?? null);
  const titleOf = (id: (typeof SECTION_IDS)[number]) => ({ id, title: SECTION_TITLE[id] });
  const toWrite = SECTION_IDS.filter((id) => plan[id] === "write").map(titleOf), toReuse = SECTION_IDS.filter((id) => plan[id] === "reuse").map(titleOf), noData = SECTION_IDS.filter((id) => plan[id] === "nodata").map(titleOf);
  const payloadJson = JSON.stringify(SECTION_IDS.filter((id) => plan[id] === "write").map((id) => buildSectionPayload(id, basis.catalog[id], basis.context)), null, 1);
  const blocked = !canGenerate ? "Redactar con el agente exige Edición en Resultados y en Agente de IA, y acceso a todas las áreas." : draft ? `Hay un borrador sin aprobar (versión ${draft.number}): apruébelo o descártelo antes de crear otra.` : usage >= limit ? `Se alcanzó el tope diario de redacciones (${limit}).` : null;
  const stale = selected !== null && selected.status !== "superseded" && selected.inputHash !== basis.inputHash;
  const approval = selected?.status === "draft" ? canApprove(selected.sections) : null;
  const regenBlocked = !canGenerate ? "Redactar de nuevo exige Edición en Agente de IA y acceso a todas las áreas." : usage >= limit ? `Se alcanzó el tope diario de redacciones (${limit}).` : null;
  const editable = selected?.status === "draft" && canManage;

  return (
    <section aria-labelledby="texto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="head" style={{ margin: 0 }}>
        <div>
          <h2 id="texto" style={{ margin: 0 }}>Texto del informe</h2>
          <p className="note" style={{ margin: "4px 0 0", maxWidth: 720 }}>La aplicación calcula las cifras y el agente de IA redacta el análisis; cada cifra del texto se verifica contra el cálculo. Nada es oficial hasta que una persona con Edición en Resultados aprueba una versión.</p>
        </div>
        <div className="tools" style={{ alignItems: "flex-end" }}>
          {versions.length > 0 && (
            <form method="get" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <label className="f">Versión
                <select name="v" defaultValue={selected?.number}>{versions.map((v) => <option key={v.id} value={v.number}>Versión {v.number} · {STATUS_VERSION[v.status]} · {when(v.approvedAt ?? v.createdAt)}</option>)}</select>
              </label>
              <button className="btn" type="submit">Ver</button>
            </form>
          )}
          {canManage && <GenerateDialog first={first} nextNumber={nextNumber} toWrite={toWrite} toReuse={toReuse} noData={noData} changes={diffCatalog(latest?.catalog ?? null, basis.catalog)} payloadJson={payloadJson} usage={usage} limit={limit} blocked={blocked} />}
        </div>
      </div>

      {canManage && blocked && !first && !draft && <p className="note" style={{ margin: 0 }}>{blocked}</p>}
      {first && <div className="banner" role="status"><span>Todavía no hay ninguna versión del texto. {canManage ? (blocked ? blocked : "Pulse «Generar el informe» para que el agente redacte el primer borrador.") : "Quien tenga Edición en Resultados puede generarla."}</span></div>}
      {selected?.status === "approved" && <div className="banner" role="status" style={{ background: "var(--green-soft)", color: "var(--green-dark)" }}><span><b>Versión {selected.number} aprobada</b> el {when(selected.approvedAt)}. Es la versión oficial: no se modifica; para cambiar algo se crea una versión nueva.</span></div>}
      {selected?.status === "draft" && <div className="banner" role="status"><span><b>Versión {selected.number}: borrador.</b> {editable ? "Revise cada sección, edítela o redáctela de nuevo si hace falta, y apruébela." : "Solo quien tenga Edición en Resultados puede editarla y aprobarla."}</span></div>}
      {selected?.status === "superseded" && <div className="banner" role="status"><span><b>Versión {selected.number} reemplazada</b> por una versión aprobada más reciente. Se conserva como estaba.</span></div>}
      {stale && <div className="banner" role="status"><span><b>Los datos cambiaron desde esta versión.</b> El texto describe las cifras de cuando se redactó; las del tablero de arriba son las de hoy. {canManage ? "Pulse «Actualizar informe» para ver qué cambió." : ""}</span></div>}

      {selected && editable && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <form action={approveVersionAction}><input type="hidden" name="id" value={selected.id} />
            <ConfirmButton className="btn solid" title="¿Aprobar esta versión?" message={<>La versión {selected.number} será la versión oficial del informe y la anterior quedará como reemplazada.</>} confirmLabel="Aprobar" disabled={!approval?.ok}>Aprobar esta versión</ConfirmButton></form>
          <form action={discardDraftAction}><input type="hidden" name="id" value={selected.id} />
            <ConfirmButton className="btn" title="¿Descartar este borrador?" message={<>Se borrará el borrador de la versión {selected.number}. Las versiones aprobadas no se tocan.</>} confirmLabel="Descartar">Descartar el borrador</ConfirmButton></form>
          {approval && !approval.ok && <span className="note">{approval.reason}</span>}
        </div>
      )}

      {selected && selected.sections.map((s, i) => {
        const cited = (selected.catalog[s.id] ?? []).filter((c) => s.cites.includes(c.id));
        return (
          <article key={s.id} className="card" aria-label={s.title}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{i + 1}. {s.title}</h3>
              <span className={`pill ${PILL[s.status]}`}>{STATUS_ES[s.status]}{s.source === "reused" ? " · reutilizada" : ""}</span>
            </div>
            {s.status === "nodata" && <p className="note" style={{ margin: "8px 0 0" }}>No hay datos suficientes para esta sección: no se redacta ni se le envía nada al agente. Se redactará cuando existan.</p>}
            {s.status !== "nodata" && s.paragraphs.length === 0 && <p className="note" style={{ margin: "8px 0 0" }}>Esta sección no tiene texto todavía.</p>}
            {s.paragraphs.length > 0 && <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>{s.paragraphs.map((p, k) => <p key={k} style={{ margin: 0 }}>{p}</p>)}</div>}
            {s.status === "review" && <div className="banner" role="alert" style={{ marginTop: 10, background: "var(--red-soft)", color: "var(--red-dark)" }}><span><b>Requiere revisión.</b> {s.note ?? "Hay algo que corregir."} No se puede aprobar la versión hasta que se corrija o se redacte de nuevo.</span></div>}
            {cited.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span className="note" style={{ margin: 0, marginRight: 4 }}>Cifras citadas:</span>
                {cited.map((c) => <span key={c.id} className="pill ok" title={c.label}>{c.label}: {c.display}</span>)}
              </div>
            )}
            {editable && s.status !== "nodata" && <SectionActions versionId={selected.id} sectionId={s.id} title={s.title} text={joinParagraphs(s.paragraphs)} canRegenerate={regenBlocked === null} regenBlocked={regenBlocked} />}
          </article>
        );
      })}

      {versions.length > 0 && canGenerate && (
        <p className="note" style={{ margin: 0 }}>Redacciones de hoy: {usage} de {limit}. Cada «Generar», «Actualizar» o «Redactar de nuevo esta sección» cuenta una.{selected ? ` Modelo: ${selected.model}.` : ""}</p>
      )}
    </section>
  );
}
