/**
 * Validación de cobertura de funciones del cargo (nueva capacidad del agente de IA). UNA sola lógica: la usan el botón del detalle del cargo y el
 * bloque «Validar cobertura de un cargo» del Agente de IA. Es de solo lectura sobre los datos del estudio: no crea, modifica ni elimina funciones ni
 * actividades. Solo deja constancia de la ejecución en `agent_runs` (tabla existente) para el límite diario propio, sin guardar el resultado.
 * A la IA salen únicamente el texto de las funciones y el código, nombre y descripción de las actividades: nunca nombres de personas ni documentos.
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, sql } from "drizzle-orm";
import { withRls, type Db } from "../db/client";
import { activities, agentRuns, areas, auditLog, positions, sites } from "../db/schema";
import { COVERAGE_SYSTEM, buildCoverage, splitProfile, type CoverageActivity, type CoverageInput, type CoverageResult } from "../domain/coverage";
import { agentModel } from "./agent";

export const COVERAGE_DAILY_LIMIT = Number(process.env.COVERAGE_DAILY_LIMIT ?? 20);
const TOTAL_BUDGET_MS = 50_000;   // la acción de servidor tiene un tope de 60 s: nunca se deja la pantalla cargando sin fin
const CALL_TIMEOUT_MS = 40_000;
export const COVERAGE_TRIGGER = "coverage";

export type CoverageFailure = "no_functions" | "no_activities" | "limit" | "forbidden" | "not_found" | "error";
export type CoverageOutcome =
  | { ok: true; result: CoverageResult; cargo: string }
  | { ok: false; code: CoverageFailure; message: string };

export interface ModelCall { raw: unknown; inputTokens: number; outputTokens: number }
/** Quién clasifica. Por defecto es el modelo real; las pruebas inyectan uno propio para no gastar tokens. */
export type CoverageProposer = (functionsText: string, activities: CoverageActivity[], timeoutMs: number) => Promise<ModelCall>;

const TOOL = {
  name: "submit_coverage", description: "Entrega la cobertura de cada función del perfil frente a las actividades del cargo.",
  input_schema: {
    type: "object" as const,
    properties: { functions: { type: "array", items: { type: "object", properties: {
      text: { type: "string", description: "La función tal como aparece en el perfil" },
      status: { type: "string", enum: ["covered", "partial", "none"] },
      activities: { type: "array", items: { type: "string" }, description: "Códigos de las actividades que la cubren" },
      note: { type: "string", description: "Qué falta o cuál es la duda (obligatorio si no es covered)" },
    }, required: ["text", "status", "activities", "note"] } } },
    required: ["functions"],
  },
};

/** Llama a la API de Claude con la misma credencial y el mismo modelo del agente. */
export const callCoverageModel: CoverageProposer = async (functionsText, acts, timeoutMs) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 0 });
  const content = JSON.stringify({ funciones_del_perfil: functionsText, actividades_del_cargo: acts.map((a) => ({ codigo: a.code, nombre: a.name.slice(0, 300), descripcion: (a.description ?? "").slice(0, 700) })) });
  const base = { model: agentModel(), max_tokens: 6000, system: COVERAGE_SYSTEM, tools: [TOOL], tool_choice: { type: "auto" as const }, messages: [{ role: "user" as const, content }] };
  // Este modelo no admite fijar la temperatura: la consistencia entre ejecuciones se favorece con instrucciones estrictas, una herramienta con contrato y validación posterior.
  const msg = await client.messages.create(base);
  const block = msg.content.find((b) => b.type === "tool_use");
  return { raw: block && block.type === "tool_use" ? block.input : {}, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
};

const label = (p: { area: string; site: string; name: string; kind: string }) => `${p.name} · ${p.area} · ${p.site}${p.kind === "demo" ? " · DEMO" : ""}`;

/** Cargos para el selector del Agente de IA, con lo necesario para anticipar los casos sin funciones o sin actividades. */
export async function listCoverageCargos(db: Db, sub: string, studyId: string) {
  return withRls(db, { sub }, async (tx) => {
    const rows = await tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name, kind: positions.dataKind, fns: positions.formalFunctions, acts: sql<number>`(select count(*)::int from ${activities} x where x.position_id = ${positions.id})` })
      .from(positions).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(eq(positions.studyId, studyId));
    return rows.map((r) => ({ id: r.id, label: label(r), hasFunctions: !!r.fns?.trim(), activities: r.acts })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  });
}

export async function validateCoverage(db: Db, sub: string, studyId: string, positionId: string, propose: CoverageProposer = callCoverageModel): Promise<CoverageOutcome> {
  if (propose === callCoverageModel && !process.env.ANTHROPIC_API_KEY) return { ok: false, code: "error", message: "El agente no está configurado (falta ANTHROPIC_API_KEY)." };
  // 1) Datos actuales del cargo (siempre se leen de nuevo: nunca se reutiliza un resultado anterior)
  const data = await withRls(db, { sub }, async (tx) => {
    const [p] = await tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name, kind: positions.dataKind, fns: positions.formalFunctions }).from(positions)
      .innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(and(eq(positions.id, positionId), eq(positions.studyId, studyId)));
    if (!p) return null;
    const acts = await tx.select({ code: activities.code, name: activities.name, description: activities.description }).from(activities).where(and(eq(activities.studyId, studyId), eq(activities.positionId, positionId))).orderBy(activities.code);
    return { p, acts };
  });
  if (!data) return { ok: false, code: "not_found", message: "No se encontró el cargo en este estudio." };
  const cargo = label(data.p), text = (data.p.fns ?? "").trim();
  if (!text) return { ok: false, code: "no_functions", message: "Este cargo no tiene funciones registradas en el perfil. Regístrelas en «Funciones formalmente asignadas (perfil)» para poder validar la cobertura." };
  if (data.acts.length === 0) return { ok: false, code: "no_activities", message: "Este cargo no tiene actividades creadas. Cree sus actividades en la sección Actividades para poder validar la cobertura." };

  // 2) Límite propio de validaciones por día y constancia de la ejecución
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  let runId: string;
  try {
    const prep = await withRls(db, { sub }, async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(and(eq(agentRuns.studyId, studyId), eq(agentRuns.trigger, COVERAGE_TRIGGER), gte(agentRuns.createdAt, startOfDay)));
      if (n >= COVERAGE_DAILY_LIMIT) return null;
      const [run] = await tx.insert(agentRuns).values({ studyId, trigger: COVERAGE_TRIGGER, model: agentModel() }).returning({ id: agentRuns.id });
      return run.id;
    });
    if (!prep) return { ok: false, code: "limit", message: `Se alcanzó el límite de ${COVERAGE_DAILY_LIMIT} validaciones de cobertura por día para este estudio. Intente mañana.` };
    runId = prep;
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    return { ok: false, code: code === "42501" ? "forbidden" : "error", message: code === "42501" ? "Su rol es de solo lectura: no puede ejecutar el agente." : "No se pudo iniciar la validación. Intente de nuevo." };
  }

  // 3) IA: tramos del perfil (si es muy largo), respuesta validada; si no cumple el contrato se reintenta UNA vez. Nunca se muestra un resultado parcial.
  const input: CoverageInput = { functionsText: text, activities: data.acts };
  const chunks = splitProfile(text);
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let tokensIn = 0, tokensOut = 0, outcome: CoverageOutcome | null = null, reason = "";
  try {
    for (let attempt = 1; attempt <= 2 && !outcome; attempt++) {
      const raws: unknown[] = [];
      for (const chunk of chunks) {
        const left = deadline - Date.now();
        if (left < 5_000) throw new Error("tiempo agotado");
        const r = await propose(chunk, data.acts, Math.min(CALL_TIMEOUT_MS, left));
        tokensIn += r.inputTokens; tokensOut += r.outputTokens; raws.push(r.raw);
      }
      const built = buildCoverage(raws, input);
      if (built.ok) outcome = { ok: true, result: built.result, cargo };
      else { reason = built.reason; if (deadline - Date.now() < 15_000) break; }
    }
  } catch {
    outcome = { ok: false, code: "error", message: "La IA no respondió a tiempo o no estuvo disponible. Puede reintentar." };
  }
  outcome ??= { ok: false, code: "error", message: "La respuesta de la IA llegó incompleta o con un formato inválido, así que no se muestra ningún resultado parcial. Puede reintentar." };
  void reason;
  await withRls(db, { sub }, async (tx) => {
    await tx.update(agentRuns).set({ status: outcome!.ok ? "done" : "failed", inputTokens: tokensIn, outputTokens: tokensOut }).where(eq(agentRuns.id, runId));
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "agent", action: "run", entity: "coverage_run", entityId: runId, diff: null });
  }).catch(() => undefined);
  return outcome;
}
