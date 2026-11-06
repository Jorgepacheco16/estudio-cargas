/**
 * Versiones del informe de resultados (D-106, parte C2). Las cifras las calcula la aplicación (report.ts); el agente de IA solo redacta el texto de cada sección y cada cifra del texto se
 * verifica contra las calculadas (report-text.ts). Una versión nace como borrador; solo una persona con «Resultados» en Edición la aprueba (regla 7: el agente propone, la persona decide).
 * Toda consulta pasa por RLS; el simulacro del agente se inyecta en las pruebas para no gastar tokens.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, max, ne, sql } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../db/client";
import { actionItems, activities, agentRuns, areas, auditLog, improvementOpportunities, measurabilityAssessments, positions, redesignProposals, reportVersions, riskAssessments, sites, suitabilityAssessments } from "../db/schema";
import { buildReportFacts, type ReportFacts } from "../domain/report";
import {
  REPORT_SYSTEM_PROMPT, SECTION_IDS, SECTION_TITLE, buildCatalog, buildSectionPayload, canApprove, checkAgentOutput, checkEditedText, planSections, scrubText, sectionCanonical, sectionHasData, splitParagraphs,
  type Catalog, type DiagnosticFacts, type FactItem, type ReportContextItem, type ReportSection, type SectionId, type SectionPayload,
} from "../domain/report-text";
import type { Mode } from "../domain/summary";
import { todayBogota } from "./dashboard-data";
import { loadSchedules } from "./schedule";
import { shiftLinesByPositionId } from "./shifts";

/** Redacciones del informe por día y por estudio (decisión del titular: es la única persona que las genera). */
export const REPORT_DAILY_LIMIT = Number(process.env.REPORT_DAILY_LIMIT ?? 5);
/** Tope de fichas (entrada + salida) de UNA redacción completa, reintentos incluidos. */
export const REPORT_MAX_TOKENS = Number(process.env.REPORT_MAX_TOKENS_PER_RUN ?? 80000);
export const reportModel = () => process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
/** El informe es del estudio real; la demostración no se redacta. */
const MODE: Mode = "real";
const MAX_CONTEXT_POSITIONS = 12;

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
export const versionHash = (hashes: Record<string, string>) => sha(JSON.stringify(SECTION_IDS.map((id) => [id, hashes[id]])));

/* ───────── Lo que se calcula ahora: cifras, contexto y huellas ───────── */
export interface ReportBasis {
  facts: ReportFacts; diag: DiagnosticFacts; context: ReportContextItem[]; catalog: Catalog;
  hashes: Record<SectionId, string>; hasData: Record<SectionId, boolean>; inputHash: string;
}

async function loadDiagnostic(tx: Tx, studyId: string, mode: Mode): Promise<DiagnosticFacts> {
  const kindOf = new Map((await tx.select({ id: activities.id, kind: activities.dataKind }).from(activities).where(eq(activities.studyId, studyId))).map((a) => [a.id, a.kind]));
  const keep = (k: string | undefined) => mode === "all" || k === mode;
  const [meas, suit, risks, opps, redesigns, actions] = await Promise.all([
    tx.select({ a: measurabilityAssessments.activityId }).from(measurabilityAssessments).where(eq(measurabilityAssessments.studyId, studyId)),
    tx.select({ a: suitabilityAssessments.activityId }).from(suitabilityAssessments).where(eq(suitabilityAssessments.studyId, studyId)),
    tx.select({ a: riskAssessments.activityId }).from(riskAssessments).where(eq(riskAssessments.studyId, studyId)),
    tx.select({ k: improvementOpportunities.dataKind, h: improvementOpportunities.recoverableHoursPerWeek }).from(improvementOpportunities).where(eq(improvementOpportunities.studyId, studyId)),
    tx.select({ k: redesignProposals.dataKind }).from(redesignProposals).where(eq(redesignProposals.studyId, studyId)),
    tx.select({ k: actionItems.dataKind }).from(actionItems).where(eq(actionItems.studyId, studyId)),
  ]);
  const oo = opps.filter((o) => keep(o.k));
  return {
    measured: meas.filter((r) => keep(kindOf.get(r.a))).length, suitability: suit.filter((r) => keep(kindOf.get(r.a))).length, risks: risks.filter((r) => keep(kindOf.get(r.a))).length,
    opportunities: oo.length, recoverableHours: oo.reduce((t, o) => t + (o.h === null ? 0 : Number(o.h)), 0), redesigns: redesigns.filter((r) => keep(r.k)).length, actions: actions.filter((r) => keep(r.k)).length,
  };
}

/** Descripción de la operación y turnos de los cargos con más uso, sin correos, teléfonos ni números largos. */
async function loadReportContext(tx: Tx, studyId: string, facts: ReportFacts): Promise<ReportContextItem[]> {
  const pos = await tx.select({ id: positions.id, name: positions.name, area: areas.name, site: sites.name, kind: positions.dataKind, op: positions.operationDescription }).from(positions)
    .innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(eq(positions.studyId, studyId));
  const lines = await shiftLinesByPositionId(tx, studyId);
  return facts.positions.slice(0, MAX_CONTEXT_POSITIONS).flatMap((w) => {
    const p = pos.find((x) => x.kind === w.dataKind && x.area === w.area && x.site === w.site && x.name === w.position);
    if (!p) return [];
    const operation = scrubText(p.op ?? "", 400), shifts = scrubText((lines.get(p.id) ?? "").replace(/\n/g, "; "), 240);
    return operation || shifts ? [{ area: p.area, position: p.name, operation, shifts }] : [];
  });
}

export async function loadReportBasis(db: Db, sub: string, studyId: string): Promise<ReportBasis> {
  const l = await loadSchedules(db, sub, studyId, MODE);
  const facts = buildReportFacts({ positions: l.positions, schedules: l.schedules, kpis: l.kpis, overload: l.overload, reservePct: l.params.reservePct, scenario: l.params.scenario });
  const { diag, context } = await withRls(db, { sub }, async (tx) => ({ diag: await loadDiagnostic(tx, studyId, MODE), context: await loadReportContext(tx, studyId, facts) }));
  const catalog = buildCatalog(facts, diag);
  const hashes = Object.fromEntries(SECTION_IDS.map((id) => [id, sha(sectionCanonical(id, catalog[id], context))])) as Record<SectionId, string>;
  const hasData = Object.fromEntries(SECTION_IDS.map((id) => [id, sectionHasData(id, facts, diag)])) as Record<SectionId, boolean>;
  return { facts, diag, context, catalog, hashes, hasData, inputHash: versionHash(hashes) };
}

/* ───────── El agente ───────── */
export type Writer = (payload: SectionPayload) => Promise<{ input: unknown; inputTokens: number; outputTokens: number }>;
const TOOL = {
  name: "write_section", description: "Entrega los párrafos de la sección del informe.",
  input_schema: { type: "object" as const, properties: { paragraphs: { type: "array", items: { type: "string" } } }, required: ["paragraphs"] },
};
export const callReportWriter: Writer = async (payload) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: reportModel(), max_tokens: 1400, system: REPORT_SYSTEM_PROMPT, tools: [TOOL], tool_choice: { type: "auto" }, // este modelo no admite tool_choice forzado (D-34): el sistema exige responder solo con la herramienta
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  return { input: block && block.type === "tool_use" ? block.input : null, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
};

/** Redacta UNA sección: la verifica y, si no cumple, lo intenta una vez más. Un fallo de la consulta deja la sección «requiere revisión»; nunca tumba todo el informe. */
async function writeSection(id: SectionId, basis: ReportBasis, write: Writer, spent: { tokens: number }): Promise<{ section: Omit<ReportSection, "id" | "title" | "hash">; failed: boolean }> {
  const items = basis.catalog[id], payload = buildSectionPayload(id, items, basis.context);
  let last: ReturnType<typeof checkAgentOutput> | null = null, failed = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (spent.tokens >= REPORT_MAX_TOKENS) { last = last ?? { ok: false, paragraphs: [], cites: [], problems: ["se alcanzó el tope de uso de esta redacción"] }; break; }
    try {
      const r = await write(payload);
      spent.tokens += r.inputTokens + r.outputTokens;
      last = checkAgentOutput(r.input, items); failed = false;
      if (last.ok) break;
    } catch { failed = true; last = { ok: false, paragraphs: [], cites: [], problems: ["no se pudo consultar al agente"] }; break; }
  }
  const ok = !!last?.ok;
  return { failed, section: { status: ok ? "verified" : "review", source: "agent", paragraphs: last?.paragraphs ?? [], cites: last?.cites ?? [], ...(ok ? {} : { note: (last?.problems ?? ["no se pudo redactar"]).join("; ") }) } };
}

/* ───────── Versiones guardadas ───────── */
export interface ReportVersion {
  id: string; number: number; status: "draft" | "approved" | "superseded"; catalog: Catalog; inputHash: string; sections: ReportSection[]; model: string;
  inputTokens: number | null; outputTokens: number | null; baseNumber: number | null; createdBy: string; createdAt: Date; editedAt: Date | null; approvedBy: string | null; approvedAt: Date | null;
}
type Row = typeof reportVersions.$inferSelect;
function toVersion(r: Row): ReportVersion {
  const sections = (Array.isArray(r.sections) ? r.sections : []).filter((s): s is ReportSection => !!s && typeof s === "object" && (SECTION_IDS as readonly string[]).includes((s as ReportSection).id));
  return { ...r, status: r.status as ReportVersion["status"], catalog: r.catalog as Catalog, sections };
}
export async function listVersions(db: Db, sub: string, studyId: string): Promise<ReportVersion[]> {
  return withRls(db, { sub }, async (tx) => (await tx.select().from(reportVersions).where(eq(reportVersions.studyId, studyId)).orderBy(desc(reportVersions.number))).map(toVersion));
}

/** Redacciones de hoy (hora de Bogotá). Las que fallaron por una caída del servicio no cuentan. */
export async function reportUsageToday(tx: Tx, studyId: string): Promise<number> {
  const start = new Date(`${todayBogota()}T00:00:00-05:00`);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(and(eq(agentRuns.studyId, studyId), eq(agentRuns.trigger, "report"), ne(agentRuns.status, "failed"), gte(agentRuns.createdAt, start)));
  return n;
}
export const reportUsage = (db: Db, sub: string, studyId: string) => withRls(db, { sub }, (tx) => reportUsageToday(tx, studyId));

const audit = (tx: Tx, studyId: string, sub: string, origin: "agent" | "app", action: string, entityId: string, diff: Record<string, { from: unknown; to: unknown }>) =>
  tx.insert(auditLog).values({ studyId, actorId: sub, origin, action, entity: "report_version", entityId, diff });

export type ReportResult = { ok: true; number: number; written: number; reused: number } | { ok: false; message: string };

/** Crea una versión nueva (borrador): redacta las secciones cuyas cifras cambiaron y reutiliza las demás de la versión anterior. */
const NO_PERMISSION = "No se pudo completar: verifique que su rol tenga Edición en Resultados y en Agente de IA, y acceso a todas las áreas.";
export async function generateVersion(db: Db, sub: string, studyId: string, write: Writer = callReportWriter): Promise<ReportResult> {
  try { return await generateVersionImpl(db, sub, studyId, write); } catch { return { ok: false, message: NO_PERMISSION }; }
}
async function generateVersionImpl(db: Db, sub: string, studyId: string, write: Writer): Promise<ReportResult> {
  if (write === callReportWriter && !process.env.ANTHROPIC_API_KEY) return { ok: false, message: "El agente no está configurado (falta ANTHROPIC_API_KEY)." };
  const basis = await loadReportBasis(db, sub, studyId);
  if (basis.facts.data.positions === 0) return { ok: false, message: "Aún no hay cargos ni actividades para redactar el informe." };
  type Prep = { error: string } | { error?: undefined; base: ReportVersion | null; runId: string };
  const prep: Prep = await withRls(db, { sub }, async (tx): Promise<Prep> => {
    const [draft] = await tx.select({ n: reportVersions.number }).from(reportVersions).where(and(eq(reportVersions.studyId, studyId), eq(reportVersions.status, "draft")));
    if (draft) return { error: `Hay un borrador sin aprobar (versión ${draft.n}): apruébelo o descártelo antes de crear otra.` };
    if ((await reportUsageToday(tx, studyId)) >= REPORT_DAILY_LIMIT) return { error: `Se alcanzó el tope diario de redacciones del informe (${REPORT_DAILY_LIMIT}).` };
    const [base] = await tx.select().from(reportVersions).where(eq(reportVersions.studyId, studyId)).orderBy(desc(reportVersions.number)).limit(1);
    const [run] = await tx.insert(agentRuns).values({ studyId, trigger: "report", model: reportModel() }).returning({ id: agentRuns.id });
    return { base: base ? toVersion(base) : null, runId: run.id };
  });
  if (prep.error !== undefined) return { ok: false, message: prep.error };

  const plan = planSections(basis.hashes, basis.hasData, prep.base?.sections ?? null);
  const spent = { tokens: 0 };
  const toWrite = SECTION_IDS.filter((id) => plan[id] === "write");
  const written = new Map(await Promise.all(toWrite.map(async (id) => [id, await writeSection(id, basis, write, spent)] as const)));
  if (toWrite.length > 0 && [...written.values()].every((w) => w.failed)) {
    await withRls(db, { sub }, (tx) => tx.update(agentRuns).set({ status: "failed", inputTokens: spent.tokens, outputTokens: 0 }).where(eq(agentRuns.id, prep.runId)));
    return { ok: false, message: "No se pudo consultar al agente. Intente de nuevo más tarde." };
  }

  const sections: ReportSection[] = SECTION_IDS.map((id) => {
    const base = { id, title: SECTION_TITLE[id], hash: basis.hashes[id] };
    if (plan[id] === "nodata") return { ...base, status: "nodata", source: "none", paragraphs: [], cites: [] };
    if (plan[id] === "reuse") { const p = prep.base!.sections.find((s) => s.id === id)!; return { ...base, status: p.status, source: "reused", paragraphs: p.paragraphs, cites: p.cites }; }
    return { ...base, ...written.get(id)!.section };
  });
  const result = await withRls(db, { sub }, async (tx): Promise<ReportResult> => {
    const [{ m }] = await tx.select({ m: max(reportVersions.number) }).from(reportVersions).where(eq(reportVersions.studyId, studyId));
    const number = (m ?? 0) + 1;
    const [v] = await tx.insert(reportVersions).values({
      studyId, number, status: "draft", catalog: basis.catalog, inputHash: versionHash(Object.fromEntries(sections.map((s) => [s.id, s.hash]))), sections, model: reportModel(),
      inputTokens: spent.tokens, outputTokens: 0, baseNumber: prep.base?.number ?? null, createdBy: sub,
    }).returning({ id: reportVersions.id });
    await tx.update(agentRuns).set({ status: "done", inputTokens: spent.tokens, outputTokens: 0 }).where(eq(agentRuns.id, prep.runId));
    await audit(tx, studyId, sub, "agent", "run", v.id, { version: { from: null, to: number }, written: { from: null, to: toWrite.length }, reused: { from: null, to: SECTION_IDS.filter((id) => plan[id] === "reuse").length } });
    return { ok: true, number, written: toWrite.length, reused: SECTION_IDS.filter((id) => plan[id] === "reuse").length };
  });
  return result;
}

async function draftOf(tx: Tx, studyId: string, versionId: string): Promise<ReportVersion | null> {
  const [r] = await tx.select().from(reportVersions).where(and(eq(reportVersions.id, versionId), eq(reportVersions.studyId, studyId)));
  return r && r.status === "draft" ? toVersion(r) : null;
}
const NOT_DRAFT = "Solo se puede cambiar un borrador; las versiones aprobadas no se modifican.";

/** Vuelve a redactar UNA sección de un borrador con las cifras de hoy. Cuenta como una redacción del día. */
export async function regenerateSection(db: Db, sub: string, studyId: string, versionId: string, sectionId: SectionId, write: Writer = callReportWriter): Promise<{ ok: true } | { ok: false; message: string }> {
  try { return await regenerateSectionImpl(db, sub, studyId, versionId, sectionId, write); } catch { return { ok: false, message: NO_PERMISSION }; }
}
async function regenerateSectionImpl(db: Db, sub: string, studyId: string, versionId: string, sectionId: SectionId, write: Writer): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(SECTION_IDS as readonly string[]).includes(sectionId)) return { ok: false, message: "La sección no existe." };
  if (write === callReportWriter && !process.env.ANTHROPIC_API_KEY) return { ok: false, message: "El agente no está configurado (falta ANTHROPIC_API_KEY)." };
  const basis = await loadReportBasis(db, sub, studyId);
  type Prep = { error: string } | { error?: undefined; runId: string | null };
  const prep: Prep = await withRls(db, { sub }, async (tx): Promise<Prep> => {
    const v = await draftOf(tx, studyId, versionId);
    if (!v) return { error: NOT_DRAFT };
    if (basis.hasData[sectionId] && (await reportUsageToday(tx, studyId)) >= REPORT_DAILY_LIMIT) return { error: `Se alcanzó el tope diario de redacciones del informe (${REPORT_DAILY_LIMIT}).` };
    const runId = basis.hasData[sectionId] ? (await tx.insert(agentRuns).values({ studyId, trigger: "report", model: reportModel() }).returning({ id: agentRuns.id }))[0].id : null;
    return { runId };
  });
  if (prep.error !== undefined) return { ok: false, message: prep.error };
  const spent = { tokens: 0 };
  const body = basis.hasData[sectionId]
    ? await writeSection(sectionId, basis, write, spent)
    : { failed: false, section: { status: "nodata", source: "none", paragraphs: [], cites: [] } as Omit<ReportSection, "id" | "title" | "hash"> };
  if (body.failed) { if (prep.runId) await withRls(db, { sub }, (tx) => tx.update(agentRuns).set({ status: "failed" }).where(eq(agentRuns.id, prep.runId!))); return { ok: false, message: "No se pudo consultar al agente. Intente de nuevo más tarde." }; }
  return withRls(db, { sub }, async (tx) => {
    const v = await draftOf(tx, studyId, versionId);
    if (!v) return { ok: false as const, message: NOT_DRAFT };
    const sections = v.sections.map((s) => (s.id === sectionId ? { id: sectionId, title: SECTION_TITLE[sectionId], hash: basis.hashes[sectionId], ...body.section } : s)) as ReportSection[];
    const catalog = { ...v.catalog, [sectionId]: basis.catalog[sectionId] };
    await tx.update(reportVersions).set({ sections, catalog, inputHash: versionHash(Object.fromEntries(sections.map((s) => [s.id, s.hash]))), editedAt: new Date(), inputTokens: (v.inputTokens ?? 0) + spent.tokens }).where(eq(reportVersions.id, versionId));
    if (prep.runId) await tx.update(agentRuns).set({ status: "done", inputTokens: spent.tokens, outputTokens: 0 }).where(eq(agentRuns.id, prep.runId));
    await audit(tx, studyId, sub, "agent", "regenerate", versionId, { section: { from: null, to: sectionId } });
    return { ok: true as const };
  });
}

/** Guarda el texto que una persona editó en un borrador. Los números con dígitos deben ser los de las cifras de la sección; si no, queda «requiere revisión» y no se puede aprobar. */
export async function saveSectionText(db: Db, sub: string, studyId: string, versionId: string, sectionId: SectionId, text: string): Promise<{ ok: true; status: ReportSection["status"]; note?: string } | { ok: false; message: string }> {
  if (!(SECTION_IDS as readonly string[]).includes(sectionId)) return { ok: false, message: "La sección no existe." };
  if (typeof text !== "string" || text.length > 6000) return { ok: false, message: "El texto es demasiado largo (máximo 6.000 caracteres)." };
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return { ok: false, message: "El texto no puede quedar vacío." };
  if (paragraphs.length > 10) return { ok: false, message: "Máximo 10 párrafos por sección." };
  try {
    return await withRls(db, { sub }, async (tx) => {
      const v = await draftOf(tx, studyId, versionId);
      if (!v) return { ok: false as const, message: NOT_DRAFT };
      const cur = v.sections.find((s) => s.id === sectionId);
      if (!cur || cur.status === "nodata") return { ok: false as const, message: "Esa sección no tiene datos: no se puede escribir." };
      const check = checkEditedText(paragraphs, v.catalog[sectionId] ?? []);
      const status: ReportSection["status"] = check.ok ? "edited" : "review", note = check.ok ? undefined : check.problems.join("; ");
      const sections = v.sections.map((s) => (s.id === sectionId ? { ...s, status, source: "person" as const, paragraphs: check.paragraphs, cites: check.cites, note } : s));
      await tx.update(reportVersions).set({ sections, editedAt: new Date() }).where(eq(reportVersions.id, versionId));
      await audit(tx, studyId, sub, "app", "edit", versionId, { section: { from: cur.status, to: `${sectionId}: ${status}` } });
      return { ok: true as const, status, note };
    });
  } catch { return { ok: false, message: "No se pudo guardar el texto. Verifique que su rol tenga Edición en Resultados." }; }
}

/** Aprueba un borrador: queda como la versión oficial (la anterior pasa a «reemplazada»). A nombre de quien aprueba y con constancia en el registro. */
export async function approveVersion(db: Db, sub: string, studyId: string, versionId: string): Promise<{ ok: true; number: number } | { ok: false; message: string }> {
  try {
    return await withRls(db, { sub }, async (tx) => {
      const v = await draftOf(tx, studyId, versionId);
      if (!v) return { ok: false as const, message: NOT_DRAFT };
      const can = canApprove(v.sections);
      if (!can.ok) return { ok: false as const, message: can.reason };
      const [prev] = await tx.select({ id: reportVersions.id, n: reportVersions.number }).from(reportVersions).where(and(eq(reportVersions.studyId, studyId), eq(reportVersions.status, "approved")));
      if (prev) await tx.update(reportVersions).set({ status: "superseded" }).where(eq(reportVersions.id, prev.id));
      await tx.update(reportVersions).set({ status: "approved", approvedBy: sub, approvedAt: new Date() }).where(eq(reportVersions.id, versionId));
      await audit(tx, studyId, sub, "app", "approve", versionId, { status: { from: "draft", to: "approved" }, version: { from: prev?.n ?? null, to: v.number } });
      return { ok: true as const, number: v.number };
    });
  } catch { return { ok: false, message: "No se pudo aprobar. Verifique que su rol tenga Edición en Resultados." }; }
}

/** Descarta un borrador (las versiones aprobadas no se borran). */
export async function discardDraft(db: Db, sub: string, studyId: string, versionId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    return await withRls(db, { sub }, async (tx) => {
      const v = await draftOf(tx, studyId, versionId);
      if (!v) return { ok: false as const, message: NOT_DRAFT };
      await tx.delete(reportVersions).where(eq(reportVersions.id, versionId));
      await audit(tx, studyId, sub, "app", "discard", versionId, { version: { from: v.number, to: null } });
      return { ok: true as const };
    });
  } catch { return { ok: false, message: "No se pudo descartar. Verifique que su rol tenga Edición en Resultados." }; }
}

/** Las cifras con sus etiquetas, para mostrar «Cifras citadas» de una sección. */
export const citedItems = (v: ReportVersion, s: ReportSection): FactItem[] => (v.catalog[s.id] ?? []).filter((i) => s.cites.includes(i.id));
