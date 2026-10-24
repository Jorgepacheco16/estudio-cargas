import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
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

export default async function Agente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getUser();
  const study = user ? await activeStudyId(user.id) : null;
  const proposals = user && study ? await listProposals(getDb(), user.id, study.id) : [];
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  const canWrite = !!study && study.role !== "viewer";

  return (
    <main>
      <div className="head">
        <div><h1>Agente de IA</h1><div className="sub">El agente solo propone; nada cambia sin aprobación humana registrada.</div></div>
        <div className="tools"><ExportButtons view="agente" mode="real" /></div>
      </div>
      {sp.ok && <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>{sp.ok}</div>}
      {sp.error && <div className="banner" style={{ background: "var(--red-soft)", color: "var(--red-dark)" }}>{sp.error}</div>}

      {!user || !study ? <div className="empty">Inicie sesión y seleccione un estudio para usar el agente.</div> : (
        <>
          <section className="card">
            <h2>Ejecutar análisis</h2>
            <form action={runAgentAction} style={{ marginTop: 12 }}>
              <button className="btn solid" type="submit" disabled={!configured || !canWrite}>Pedir propuestas al agente</button>
            </form>
            <p className="note">
              {configured ? `Modelo: ${agentModel()} · tope de ${AGENT_DAILY_LIMIT} ejecuciones por día y estudio.` : "Agente sin configurar: falta ANTHROPIC_API_KEY."}{" "}
              Al agente solo llegan resúmenes seudonimizados (cifras, estados de captura, códigos e identificadores internos); nunca nombres, correos ni textos libres. Cada propuesta cita su evidencia.
            </p>
          </section>

          <section className="card">
            <h2>Propuestas ({proposals.length})</h2>
            {proposals.length === 0 ? <div className="empty">Sin propuestas.</div> : (
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
                <table>
                  <thead><tr><th>Tipo</th><th>Resumen</th><th>Cambio</th><th>Evidencia</th><th>Estado</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {proposals.map((p) => {
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
                                <button className="btn" name="decision" value="reject" type="submit" disabled={!canWrite}>Rechazar</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
