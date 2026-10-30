import { Purpose } from "@/components/Purpose";
import { PagedTable } from "@/components/PagedTable";
import { CoveragePanel } from "@/components/CoveragePanel";
import { COVERAGE_DAILY_LIMIT, listCoverageCargos } from "@/server/coverage";
import { redirect } from "next/navigation";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { canEdit, requireRead } from "@/lib/access";
import { activeStudyId } from "@/data/source";
import { ExportButtons } from "@/components/Tools";
import { AGENT_DAILY_LIMIT, agentModel, listProposals } from "@/server/agent";
import { KIND_ES, TUNABLE } from "@/domain/agent";
import { decideAction, runAgentAction } from "./actions";

const STATUS_ES: Record<string, string> = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", applied: "Aplicada" };
const PILL: Record<string, string> = { pending: "low", approved: "ok", applied: "ok", rejected: "nodata" };

function describe(kind: string, change: Record<string, unknown>): string {
  if (kind === "parameter") { const t = (TUNABLE as Record<string, { label: string }>)[String(change.key)]; return `${t?.label ?? String(change.key)} → ${String(change.value)}`; }
  if (kind === "list_value") return `Agregar a la lista de áreas: «${String(change.value)}»`;
  return "";
}

export const maxDuration = 60; // la validación de cobertura llama a la IA desde esta pantalla
export const metadata = { title: "Agente de IA" };
export default async function Agente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");
  const study = await activeStudyId(user.id);
  requireRead(study, "agente");
  const proposals = study ? await listProposals(getDb(), user.id, study.id) : [];
  const cargos = study ? await listCoverageCargos(getDb(), user.id, study.id) : [];
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  const canWrite = !!study && canEdit(study, "agente");
  const blocked = !configured ? "El agente no está configurado (falta ANTHROPIC_API_KEY)." : study && !study.access?.allAreas && study.access ? "El agente analiza todo el estudio: requiere acceso a todas las áreas." : !canWrite ? "Su rol es de solo lectura." : null;

  return (
    <main>
      <div className="head">
        <div><h1>Agente de IA</h1><Purpose k="agente" /><div className="sub">El agente solo propone; nada cambia sin aprobación humana registrada.</div></div>
        <div className="tools"><ExportButtons view="agente" mode="real" /></div>
      </div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}

      {!study ? <div className="empty">Cree o seleccione un estudio en la sección Estudio.</div> : (
        <>
          {blocked && <div className="banner">{blocked}</div>}
          <section className="card">
            <h2>Ejecutar análisis</h2>
            <form action={runAgentAction} style={{ marginTop: 12 }}>
              <button className="btn solid" type="submit" disabled={!!blocked} title={blocked ?? undefined}>Pedir propuestas al agente</button>
            </form>
            <p className="note">
              {configured ? `Modelo: ${agentModel()} · tope de ${AGENT_DAILY_LIMIT} ejecuciones por día y estudio.` : "Agente sin configurar: falta ANTHROPIC_API_KEY."}{" "}
              Al agente solo llegan resúmenes seudonimizados (cifras, estados de captura, códigos e identificadores internos); nunca nombres, correos ni textos libres. Cada propuesta cita su evidencia.
            </p>
          </section>

          <section className="card" aria-label="Validar cobertura de un cargo">
            <h2>Validar cobertura de un cargo</h2>
            <p className="note" style={{ marginTop: 0 }}>Compara las funciones formalmente asignadas al cargo (su perfil) con las actividades creadas para ese mismo cargo y avisa si alguna función no tiene actividad. Úsela al terminar de ingresar las actividades. Solo lee: no cambia ningún dato.</p>
            {cargos.length === 0 ? <div className="empty">Aún no hay cargos. Regístrelos en Cargos y dotación.</div> : <CoveragePanel options={cargos} />}
            <p className="note">A la IA se envía únicamente el texto de las funciones del perfil y el código, nombre y descripción de las actividades de ese cargo; nunca nombres de personas ni documentos. Se valida un cargo concreto (área, centro de operaciones y nombre), sin unir cargos de otras sedes. Tope de {COVERAGE_DAILY_LIMIT} validaciones por día y estudio.</p>
          </section>

          <section className="card">
            <h2>Propuestas ({proposals.length})</h2>
            {proposals.length === 0 ? <div className="empty">Sin propuestas.</div> : (
              <PagedTable head={<tr><th>Tipo</th><th>Resumen</th><th>Cambio</th><th>Evidencia</th><th>Estado</th><th>Acciones</th></tr>} rows={proposals.map((p) => {
                      const pl = p.payload as { change?: Record<string, unknown>; evidence?: { entity: string; id: string }[] };
                      return (
                        <tr key={p.id}>
                          <td>{KIND_ES[p.kind] ?? p.kind}</td><td>{p.summary}</td><td>{describe(p.kind, pl.change ?? {}) || "—"}</td>
                          <td className="muted">{(pl.evidence ?? []).map((e) => `${e.entity}:${e.id.slice(0, 8)}`).join(", ")}</td>
                          <td><span className={`pill ${PILL[p.status] ?? "nodata"}`}>{STATUS_ES[p.status] ?? p.status}</span></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {p.status === "pending" && (
                              <form action={decideAction} style={{ display: "inline-flex", gap: 6 }}>
                                <input type="hidden" name="id" value={p.id} />
                                <button className="btn solid" name="decision" value="approve" type="submit" disabled={!canWrite}>Aprobar</button>
                                <button className="btn danger" name="decision" value="reject" type="submit" disabled={!canWrite}>Rechazar</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })} />
            )}
          </section>
        </>
      )}
    </main>
  );
}
