/**
 * Agente de IA (Fase 9). Solo PROPONE: guarda propuestas en estado pending; aplicarlas lo hace esta capa tras la aprobación
 * de una persona, en una transacción con auditoría. A la API salen únicamente resúmenes seudonimizados (§14.3).
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, max, ne, sql } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../db/client";
import { activities, agentProposals, agentRuns, areas, auditLog, positions, sites, studyParameters } from "../db/schema";
import { screenProposals, SYSTEM_PROMPT, TUNABLE, type StudyDigest, type TunableKey } from "../domain/agent";
import { loadDashboardTx } from "./dashboard-data";

export const AGENT_DAILY_LIMIT = Number(process.env.AGENT_DAILY_LIMIT ?? 5);
export const agentModel = () => process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const MAX_FINDINGS = 40;
/** Tope de costo por ejecución (entrada + salida, reintento incluido). Si el primer intento ya consumió más de la mitad, no se reintenta: así el tope es una garantía y no solo una medición. */
export const AGENT_MAX_TOKENS_PER_RUN = Number(process.env.AGENT_MAX_TOKENS_PER_RUN ?? 8000);

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const key = (a: string, s: string, p: string, k: string) => [k, a, s, p].join("|");

/** Resumen estadístico: parámetros, cifras, estados de captura, códigos e identificadores internos. Sin nombres de personas ni texto libre. */
export async function buildDigest(tx: Tx, studyId: string): Promise<StudyDigest> {
  const d = await loadDashboardTx(tx, studyId, "all");
  const [p] = await tx.select().from(studyParameters).where(eq(studyParameters.studyId, studyId));
  const pos = await tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name, kind: positions.dataKind }).from(positions)
    .innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(eq(positions.studyId, studyId));
  const posId = new Map(pos.map((x) => [key(x.area, x.site, x.name, x.kind), x.id]));
  const acts = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.studyId, studyId));
  const actId = new Map(acts.map((a) => [a.code, a.id]));
  const k = d.analysis.kpis;

  const findings: StudyDigest["findings"] = [{
    entity: "study", id: studyId,
    note: `Actividades ${k.activities}, completas ${k.complete}, horas ${round(k.hours)} h/sem, capacidad ${round(k.capacity)} h/sem, sobrecargados ${k.overload}, carga baja ${k.low}`,
  }];
  for (const r of d.analysis.positions) {
    if (r.level === "ok") continue;
    const id = posId.get(key(r.area, r.site, r.position, r.dataKind));
    if (id) findings.push({ entity: "positions", id, note: `Área ${r.area}: ${round(r.hours)} h/sem de ${round(r.capacity)} h de capacidad (${r.pct === null ? "sin %" : round(r.pct * 100, 1) + "%"}), ${r.activities} actividades, ${r.complete} completas, nivel ${r.level}` });
  }
  for (const a of d.analysis.activities) {
    if (a.complete) continue;
    const id = actId.get(a.code);
    if (id) findings.push({ entity: "activities", id, note: `${a.code}: ${a.status}` });
  }
  return {
    studyId,
    parameters: {
      workDaysPerWeek: Number(p.workDaysPerWeek), reservePct: Number(p.reservePct), overloadThreshold: Number(p.overloadThreshold), lowLoadThreshold: Number(p.lowLoadThreshold),
      weeksPerYear: p.weeksPerYear, scenario: p.scenario, assumptionsValidated: p.assumptionsValidated,
    },
    findings: findings.slice(0, MAX_FINDINGS),
  };
}

export type RunResult = { ok: true; runId: string; created: number; discarded: number } | { ok: false; message: string };

const TOOL = {
  name: "submit_proposals", description: "Entrega propuestas de actualización para revisión humana.",
  input_schema: {
    type: "object" as const,
    properties: { proposals: { type: "array", items: { type: "object", properties: {
      kind: { type: "string", enum: ["parameter", "list_value", "validation_rule", "report"] }, summary: { type: "string" }, payload: { type: "object" },
      evidence: { type: "array", items: { type: "object", properties: { entity: { type: "string" }, id: { type: "string" } }, required: ["entity", "id"] } },
    }, required: ["kind", "summary", "payload", "evidence"] } } },
    required: ["proposals"],
  },
};

/** Llama a la API con herramienta forzada y devuelve la entrada cruda de la herramienta (se valida aparte). */
export async function callModel(digest: StudyDigest): Promise<{ input: unknown; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: agentModel(), max_tokens: 2500, system: SYSTEM_PROMPT, tools: [TOOL], // Este modelo no admite tool_choice forzado (error 400, D-34): se usa "auto" y el sistema exige responder solo con la herramienta; si no la usa, se trata como lista vacía.
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: JSON.stringify(digest) }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  return { input: block && block.type === "tool_use" ? block.input : { proposals: [] }, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
}

/** Llama al modelo y valida; si la salida no cumple el contrato (p. ej. sin «proposals»), reintenta UNA vez. Suma los tokens de ambos intentos. */
export async function proposeWithRetry(digest: StudyDigest) {
  let inputTokens = 0, outputTokens = 0;
  for (let attempt = 1; ; attempt++) {
    const r = await callModel(digest);
    inputTokens += r.inputTokens; outputTokens += r.outputTokens;
    const screened = screenProposals(r.input, digest);
    if (attempt >= 2 || (inputTokens + outputTokens) * 2 > AGENT_MAX_TOKENS_PER_RUN || !screened.discarded.some((x) => x.reason.startsWith("salida fuera de contrato"))) return { ...screened, inputTokens, outputTokens, attempts: attempt };
  }
}

/** Quién redacta las propuestas. Por defecto es el modelo real; las pruebas del flujo (estado pendiente, tope diario, auditoría) inyectan uno propio para no gastar tokens. */
export type Proposer = (digest: StudyDigest) => Promise<Awaited<ReturnType<typeof proposeWithRetry>>>;

export async function runAgent(db: Db, sub: string, studyId: string, trigger = "manual", propose: Proposer = proposeWithRetry): Promise<RunResult> {
  if (propose === proposeWithRetry && !process.env.ANTHROPIC_API_KEY) return { ok: false, message: "El agente no está configurado (falta ANTHROPIC_API_KEY)." };
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const prep = await withRls(db, { sub }, async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(and(eq(agentRuns.studyId, studyId), ne(agentRuns.trigger, "coverage"), gte(agentRuns.createdAt, startOfDay))); // las validaciones de cobertura tienen su propio límite
    if (n >= AGENT_DAILY_LIMIT) return null;
    const digest = await buildDigest(tx, studyId);
    const [run] = await tx.insert(agentRuns).values({ studyId, trigger, model: agentModel() }).returning({ id: agentRuns.id });
    return { digest, runId: run.id };
  });
  if (!prep) return { ok: false, message: `Se alcanzó el tope diario de ejecuciones del agente (${AGENT_DAILY_LIMIT}).` };

  let out: Awaited<ReturnType<typeof proposeWithRetry>>;
  try { out = await propose(prep.digest); }
  catch {
    await withRls(db, { sub }, (tx) => tx.update(agentRuns).set({ status: "failed" }).where(eq(agentRuns.id, prep.runId)));
    return { ok: false, message: "No se pudo consultar al agente. Intente de nuevo más tarde." };
  }
  const { accepted, discarded } = out;
  await withRls(db, { sub }, async (tx) => {
    if (accepted.length) await tx.insert(agentProposals).values(accepted.map((p) => ({ studyId, runId: prep.runId, kind: p.kind, summary: p.summary, payload: { change: p.payload, evidence: p.evidence } })));
    await tx.update(agentRuns).set({ status: "done", inputTokens: out.inputTokens, outputTokens: out.outputTokens }).where(eq(agentRuns.id, prep.runId));
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "agent", action: "run", entity: "agent_run", entityId: prep.runId, diff: { proposals: { from: null, to: accepted.length }, discarded: { from: null, to: discarded.length } } });
  });
  return { ok: true, runId: prep.runId, created: accepted.length, discarded: discarded.length };
}

export async function listProposals(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, (tx) => tx.select().from(agentProposals).where(eq(agentProposals.studyId, studyId)).orderBy(desc(agentProposals.createdAt)));
}

export type DecisionResult = "applied" | "approved" | "rejected" | "not_pending";

/** Aprobar o rechazar. Aprobar aplica el cambio (si es aplicable) en la MISMA transacción, con auditoría. El agente nunca llega aquí. */
export async function decideProposal(db: Db, sub: string, studyId: string, id: string, approve: boolean): Promise<DecisionResult> {
  return withRls(db, { sub }, async (tx) => {
    const [p] = await tx.select().from(agentProposals).where(and(eq(agentProposals.id, id), eq(agentProposals.studyId, studyId), eq(agentProposals.status, "pending")));
    if (!p) return "not_pending";
    const now = new Date();
    let status: "applied" | "approved" | "rejected" = approve ? "approved" : "rejected";
    let diff: Record<string, { from: unknown; to: unknown }> = {};
    if (approve) {
      const change = (p.payload as { change?: Record<string, unknown> }).change ?? {};
      if (p.kind === "parameter") {
        const k = String(change.key) as TunableKey, v = Number(change.value);
        if (!(k in TUNABLE) || !Number.isFinite(v)) throw new Error("La propuesta ya no es aplicable");
        const [cur] = await tx.select().from(studyParameters).where(eq(studyParameters.studyId, studyId));
        await tx.update(studyParameters).set({ [k]: v.toFixed(4) }).where(eq(studyParameters.studyId, studyId));
        diff = { [k]: { from: cur[k], to: v.toFixed(4) } }; status = "applied";
      } else if (p.kind === "list_value") {
        const name = String(change.value).trim();
        const [{ m }] = await tx.select({ m: max(areas.sortOrder) }).from(areas).where(eq(areas.studyId, studyId));
        await tx.insert(areas).values({ studyId, name, sortOrder: (m ?? -1) + 1 });
        diff = { area: { from: null, to: name } }; status = "applied";
      } else if (p.kind === "report") status = "applied"; // informativa: no hay nada que ejecutar
      // validation_rule: queda aprobada; el motor de reglas aún no existe (D-34), así que no se marca como aplicada.
    }
    await tx.update(agentProposals).set({ status, reviewedBy: sub, reviewedAt: now, appliedAt: status === "applied" ? now : null }).where(eq(agentProposals.id, id));
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "agent", action: approve ? "approve" : "reject", entity: "agent_proposal", entityId: id, diff });
    return status;
  });
}
