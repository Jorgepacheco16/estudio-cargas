/**
 * Carga del libro en un estudio (§10.2 del brief): una sola transacción con RLS, informe y verificación.
 * Si algo no cuadra con el oráculo del Excel, `dryRun` revierte y `commit` también (no se confirma una carga que no verifica).
 */
import { eq } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../../db/client";
import {
  actionItems, activities, areas, auditLog, improvementOpportunities, measurabilityAssessments, positions, redesignProposals, riskAssessments, sites, staffingEntries,
  suitabilityAssessments, validationIssues, studyParameters,
} from "../../db/schema";
import { computeActivity, occupantsOf, STATUS_ES, type ActivityInput } from "../../domain/engine";
import { analyze } from "../../domain/summary";
import { loadStudyDataTx } from "../studies";
import { key, type Issue } from "./normalize";
import { FIELDS, hasAnyInput, type Parsed, type Row } from "./parse";

export interface SheetCount { rows: number; inserted: number; skipped: number; rejected: number }
export interface Diff { code: string; field: string; app: number | string | null; excel: number | string | null }
export interface ImportResult {
  committed: boolean;
  counts: Record<string, SheetCount>;
  issues: Issue[];
  verification: { countsOk: boolean; recompute: { compared: number; activities: number; notCompared: string[]; diffs: Diff[] } };
}

class Rollback extends Error { constructor(readonly result: ImportResult) { super("rollback"); } }

const S = (n: number | null) => (n === null ? null : String(n));
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

export async function importWorkbook(db: Db, sub: string, studyId: string, p: Parsed, opts: { dryRun: boolean }): Promise<ImportResult> {
  try {
    return await withRls(db, { sub }, async (tx) => {
      const result = await run(tx, sub, studyId, p);
      const ok = result.verification.countsOk && result.verification.recompute.diffs.length === 0;
      if (opts.dryRun || !ok) throw new Rollback({ ...result, committed: false });
      return { ...result, committed: true };
    });
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}

async function run(tx: Tx, sub: string, studyId: string, p: Parsed): Promise<ImportResult> {
  const rep = p.report;
  const counts: Record<string, SheetCount> = {};
  const c = (sheet: string): SheetCount => (counts[sheet] ??= { rows: p.keyed[sheet] ?? 0, inserted: 0, skipped: 0, rejected: 0 });
  const issue = (sheet: string, row: number, field: string, rule: string, severity: Issue["severity"], message: string) => rep.add({ sheet, row, field }, rule, severity, message);

  /* Parámetros del estudio (hoja Parametros) */
  if (p.params) {
    const q = p.params; const set: Record<string, unknown> = {};
    if (q.workDaysPerWeek !== null) set.workDaysPerWeek = String(q.workDaysPerWeek);
    if (q.weeksPerMonth !== null) set.weeksPerMonth = q.weeksPerMonth.toFixed(12);
    if (q.weeksPerYear !== null) set.weeksPerYear = q.weeksPerYear;
    if (q.reservePct !== null) set.reservePct = String(q.reservePct);
    if (q.overload !== null) set.overloadThreshold = String(q.overload);
    if (q.low !== null) set.lowLoadThreshold = String(q.low);
    if (q.hourlyCost !== null) set.hourlyCostCop = String(q.hourlyCost);
    if (q.scenario !== null) set.scenario = q.scenario;
    if (q.validated !== null) set.assumptionsValidated = q.validated;
    (["weightImpact", "weightEase", "weightEffort", "weightCost", "weightRisk"] as const).forEach((f, i) => { if (q.weights[i] !== null) set[f] = q.weights[i]; });
    if (Object.keys(set).length) await tx.update(studyParameters).set(set as never).where(eq(studyParameters.studyId, studyId));
  }

  /* Áreas, sedes y cargos: se reutilizan los existentes por su clave (sin distinguir mayúsculas) */
  const areaIds = new Map((await tx.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.studyId, studyId))).map((a) => [key(a.name), a.id]));
  const siteIds = new Map((await tx.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.studyId, studyId))).map((a) => [key(a.name), a.id]));
  let areaOrder = areaIds.size;
  const areaId = async (name: string, ctx?: { sheet: string; row: number }) => {
    const k = key(name); const hit = areaIds.get(k); if (hit) return hit;
    const [a] = await tx.insert(areas).values({ studyId, name, sortOrder: areaOrder++ }).returning({ id: areas.id });
    areaIds.set(k, a.id);
    if (ctx) issue(ctx.sheet, ctx.row, "area", "AREA_CREATED", "info", `Área '${name.slice(0, 60)}' no estaba en la lista; se creó`);
    return a.id;
  };
  const siteId = async (name: string, regional: string | null) => {
    const k = key(name); const hit = siteIds.get(k); if (hit) return hit;
    const [s] = await tx.insert(sites).values({ studyId, name, regional }).returning({ id: sites.id });
    siteIds.set(k, s.id); return s.id;
  };

  type Pos = { id: string; boss: string | null; objective: string | null; functions: string | null };
  const posIds = new Map<string, Pos>();
  const existingPos = await tx.select({ id: positions.id, name: positions.name, kind: positions.dataKind, area: areas.name, site: sites.name, boss: positions.boss, objective: positions.objective, functions: positions.formalFunctions })
    .from(positions).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId)).where(eq(positions.studyId, studyId));
  for (const x of existingPos) posIds.set(key(x.kind, x.area, x.site, x.name), { id: x.id, boss: x.boss, objective: x.objective, functions: x.functions });
  const withStaff = new Set((await tx.select({ id: staffingEntries.positionId }).from(staffingEntries).where(eq(staffingEntries.studyId, studyId))).map((x) => x.id));
  const autoWarned = new Set<string>();

  const ensurePosition = async (kind: "real" | "demo", area: string, site: string, name: string, extra: Partial<Pos> & { regional?: string | null }, auto: boolean, at: { sheet: string; row: number }) => {
    const k = key(kind, area, site, name); const hit = posIds.get(k);
    if (hit) return hit;
    const [aId, sId] = [await areaId(area, at), await siteId(site, extra.regional ?? null)];
    const [ins] = await tx.insert(positions).values({ studyId, areaId: aId, siteId: sId, name, dataKind: kind, boss: extra.boss ?? null, objective: extra.objective ?? null, formalFunctions: extra.functions ?? null, autoCreated: auto }).returning({ id: positions.id });
    const pos: Pos = { id: ins.id, boss: extra.boss ?? null, objective: extra.objective ?? null, functions: extra.functions ?? null };
    posIds.set(k, pos);
    if (auto && !autoWarned.has(k)) { autoWarned.add(k); issue(at.sheet, at.row, "position", "POSITION_AUTO_CREATED", "warning", `El cargo '${name.slice(0, 60)}' no estaba en la hoja 2; se creó sin dotación (D-08). Falta registrar cantidad y jornada`); }
    return pos;
  };

  /* Hoja 2: cargos y dotación */
  const SH2 = "2_Caracterizacion"; const kindOf = (r: Row, sheet: string) => { const k = r.s("kind"); if (!k) { issue(sheet, r.row, "kind", "MISSING_KIND", "warning", "Sin 'Tipo de dato'; se asumió REAL"); return "real" as const; } return k as "real" | "demo"; };
  const staffRows: (typeof staffingEntries.$inferInsert)[] = [];
  for (const r of p.staff) {
    const [area, site, name] = [r.s("area"), r.s("site"), r.s("position")];
    if (!area || !site || !name) { c(SH2).rejected++; issue(SH2, r.row, "clave", "MISSING_KEY", "error", `Falta ${[!area && "área", !site && "sede", !name && "cargo"].filter(Boolean).join(", ")}; la fila no se puede identificar y no se importó`); continue; }
    const kind = kindOf(r, SH2);
    const pos = await ensurePosition(kind, area, site, name, { regional: r.s("regional"), boss: r.s("boss"), objective: r.s("objective"), functions: r.s("functions") }, false, { sheet: SH2, row: r.row });
    for (const f of [["boss", "boss"], ["objective", "objective"], ["functions", "functions"]] as const) {
      const incoming = r.s(f[0]); const current = pos[f[1]];
      if (incoming && current && key(incoming) !== key(current)) issue(SH2, r.row, f[0], "POSITION_TEXT_CONFLICT", "warning", "Dos filas del mismo cargo traen texto distinto; prevalece la primera (D-07)");
    }
    if (withStaff.has(pos.id)) { c(SH2).skipped++; continue; }
    staffRows.push({ studyId, positionId: pos.id, headcount: r.n("headcount"), employeeCode: r.s("employeeCode"), weeklyHours: S(r.n("weeklyHours")), surveyDate: r.s("surveyDate"), surveyor: r.s("surveyor"), infoSource: r.s("infoSource") as never, notes: r.s("notes") });
    c(SH2).inserted++;
  }
  for (const part of chunk(staffRows, 100)) await tx.insert(staffingEntries).values(part);

  /* Hoja 3: actividades */
  const SH3 = "3_Actividades";
  const actIds = new Map((await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.studyId, studyId))).map((a) => [key(a.code), a.id]));
  const seen = new Set<string>(); const newActs: { code: string; values: typeof activities.$inferInsert }[] = [];
  for (const r of p.activities) {
    const code = r.s("code")!; const k = key(code);
    if (seen.has(k)) { c(SH3).rejected++; issue(SH3, r.row, "code", "DUPLICATE_CODE", "error", `Código '${code.slice(0, 30)}' repetido: no se fusiona ni se borra; esta fila no se importó`); continue; }
    seen.add(k);
    if (actIds.has(k)) { c(SH3).skipped++; issue(SH3, r.row, "code", "ALREADY_IMPORTED", "info", "La actividad ya existía en el estudio; se omitió (D-11)"); continue; }
    const [area, site, pos, name] = [r.s("area"), r.s("site"), r.s("position"), r.s("name")];
    if (!area || !site || !pos) { c(SH3).rejected++; issue(SH3, r.row, "clave", "MISSING_KEY", "error", `Falta ${[!area && "área", !site && "sede", !pos && "cargo"].filter(Boolean).join(", ")}; sin cargo no se puede guardar la actividad`); continue; }
    if (!name) { c(SH3).rejected++; issue(SH3, r.row, "name", "MISSING_NAME", "error", "La actividad no tiene nombre; no se inventa uno y no se importó"); continue; }
    const kind = kindOf(r, SH3);
    const primary = await ensurePosition(kind, area, site, pos, {}, true, { sheet: SH3, row: r.row });
    const sec = r.s("secondaryPosition");
    const secondary = sec ? await ensurePosition(kind, area, site, sec, {}, true, { sheet: SH3, row: r.row }) : null;
    newActs.push({ code, values: {
      studyId, dataKind: kind, code, positionId: primary.id, employeeCode: r.s("employeeCode"), name, description: r.s("description"), process: r.s("process"), objectiveResult: r.s("objective"),
      otherPositions: r.s("otherPositions"), formallyDocumented: r.s("documented") as never, frequency: r.s("frequency") as never, calcMode: r.s("calcMode") as never, executionsPerPeriod: S(r.n("executions")),
      period: r.s("period") as never, scope: r.s("scope") as never, unitsPerExecution: S(r.n("units")), timeAvgMin: S(r.n("timeAvg")), timeMinMin: S(r.n("timeMin")), timeMaxMin: S(r.n("timeMax")),
      seasonHighFactor: S(r.n("seasonHigh")), seasonLowFactor: S(r.n("seasonLow")), dataSource: r.s("source") as never, confidence: r.s("confidence") as never, simultaneousPeople: r.n("simultaneous"),
      loadSharePct: S(r.n("loadShare")), secondaryPositionId: secondary?.id ?? null, planning: r.s("planning") as never, tools: r.s("tools"), inputs: r.s("inputs"), deliverable: r.s("deliverable"),
      dependencies: r.s("dependencies"), waitMin: S(r.n("waitMin")), waitOccupiesPerson: r.b("waitOccupies"), travelMin: S(r.n("travelMin")), reworkPct: S(r.n("reworkPct")), reworkMin: S(r.n("reworkMin")),
      consequences: r.s("consequences"), controls: r.s("controls"), activityType: r.s("activityType") as never, valueClass: r.s("valueClass") as never, mandatory: r.b("mandatory"),
      standardizationPotential: r.s("stdPotential") as never, simplificationPotential: r.s("simplPotential") as never, automationPotential: r.s("autoPotential") as never,
      integrationPossible: r.s("integration") as never, evidence: r.s("evidence"), notes: r.s("notes"), pendingValidation: r.s("pending"),
    } });
    c(SH3).inserted++;
  }
  for (const part of chunk(newActs, 50)) {
    const ins = await tx.insert(activities).values(part.map((x) => x.values)).returning({ id: activities.id, code: activities.code });
    for (const x of ins) actIds.set(key(x.code), x.id);
  }

  /* Hojas 5, 6 y 7: una evaluación por actividad (D-10). Una fila con solo el código no es una evaluación: se omite. */
  const assess = async (sheet: string, rows: Row[], fields: string[], table: typeof measurabilityAssessments | typeof suitabilityAssessments | typeof riskAssessments, build: (r: Row, activityId: string) => Record<string, unknown>) => {
    const have = new Set((await tx.select({ id: table.activityId }).from(table).where(eq(table.studyId, studyId))).map((x) => x.id));
    const seenCodes = new Set<string>(); const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const code = r.s("code")!; const k = key(code); const id = actIds.get(k);
      if (!id) { c(sheet).rejected++; issue(sheet, r.row, "code", "ORPHAN_REFERENCE", "error", `La actividad '${code.slice(0, 30)}' no existe en la hoja 3; la fila no se importó`); continue; }
      if (seenCodes.has(k)) { c(sheet).rejected++; issue(sheet, r.row, "code", "DUPLICATE_ASSESSMENT", "error", "Más de una evaluación para la misma actividad; se conserva la primera (D-10)"); continue; }
      seenCodes.add(k);
      if (!hasAnyInput(r, fields)) { c(sheet).skipped++; issue(sheet, r.row, "code", "EMPTY_ASSESSMENT", "info", "Solo trae el código, sin criterios evaluados; no se creó una evaluación vacía"); continue; }
      if (have.has(id)) { c(sheet).skipped++; continue; }
      out.push(build(r, id)); c(sheet).inserted++;
    }
    for (const part of chunk(out, 100)) await tx.insert(table).values(part as never);
  };
  await assess("5_Medibilidad", p.meas, FIELDS.MEAS, measurabilityAssessments, (r, activityId) => ({
    studyId, activityId, directMeasurement: r.s("direct"), hasIndicators: r.b("hasIndicators"), hasHistory: r.s("hasHistory"), hasTimeStandard: r.b("hasStandard"), sourceReliability: r.s("reliability"),
    externalDependency: r.s("external"), resultVerifiable: r.s("verifiable"), recommendedUnit: r.s("unit"), proposedIndicator: r.s("indicator"), qualitativeCriterion: r.s("criterion"),
  }));
  await assess("6_Pertinencia", p.suit, FIELDS.SUIT, suitabilityAssessments, (r, activityId) => ({
    studyId, activityId, correspondence: r.s("correspondence"), technicalKnowledge: r.s("knowledge"), training: r.s("training"), experience: r.s("experience"), technicalCompetencies: r.s("techComp"),
    behavioralCompetencies: r.s("behavComp"), authorizations: r.s("authorizations"), autonomy: r.s("autonomy"), compatibility: r.s("compatibility"), currentCompetencies: r.s("currentComp"), gaps: r.s("gaps"),
    trainingPossible: r.s("trainingPossible"), reassignmentPossible: r.s("reassign"), specializationNeeded: r.b("specialization"), situation: r.s("situation"), sensitiveResponsibility: r.b("sensitive"), separationEvaluated: r.b("separation"),
  }));
  await assess("7_Riesgos", p.risk, FIELDS.RISK, riskAssessments, (r, activityId) => ({
    studyId, activityId, risk: r.s("risk"), consequences: r.s("consequences"), impactOperational: r.n("impOp"), impactEconomic: r.n("impEco"), impactLabor: r.n("impLab"), impactLegal: r.n("impLegal"),
    impactService: r.n("impService"), probability: r.n("probability"), controls: r.s("controls"), evidence: r.s("evidence"), dependencies: r.s("dependencies"), peopleWhoCanExecute: r.n("people"),
    duplications: r.s("duplications"), functionIncompatibility: r.b("incompat"),
  }));

  /* Hoja 8: oportunidades */
  const SH8 = "8_Oportunidades";
  const haveOpp = new Set((await tx.select({ code: improvementOpportunities.code }).from(improvementOpportunities).where(eq(improvementOpportunities.studyId, studyId))).map((x) => key(x.code)));
  const oppRows: Record<string, unknown>[] = []; const seenOpp = new Set<string>();
  for (const r of p.opp) {
    const code = r.s("code")!; const k = key(code);
    if (seenOpp.has(k)) { c(SH8).rejected++; issue(SH8, r.row, "code", "DUPLICATE_CODE", "error", "ID de oportunidad repetido; la fila no se importó"); continue; }
    seenOpp.add(k);
    if (haveOpp.has(k)) { c(SH8).skipped++; continue; }
    const act = r.s("activityCode"); const aId = act ? actIds.get(key(act)) ?? null : null;
    if (act && !aId) issue(SH8, r.row, "activityCode", "ORPHAN_REFERENCE", "warning", `La actividad relacionada '${act.slice(0, 30)}' no existe; el vínculo quedó vacío`);
    const area = r.s("area"); const arId = area ? areaIds.get(key(area)) ?? null : null;
    if (area && !arId) issue(SH8, r.row, "area", "NOT_IN_LIST", "warning", `Área '${area.slice(0, 50)}' no registrada; el vínculo quedó vacío`);
    oppRows.push({
      studyId, dataKind: kindOf(r, SH8), code, type: r.s("type"), findingClass: r.s("finding"), problem: r.s("problem"), relatedActivityId: aId, evidence: r.s("evidence"), probableCause: r.s("cause"), proposal: r.s("proposal"),
      areaId: arId, positionName: r.s("position"), expectedBenefit: r.s("benefit"), recoverableHoursPerWeek: S(r.n("hours")), impactAssumptions: r.s("assumptions"), implementationRisks: r.s("risks"),
      impactScore: r.n("impact"), easeScore: r.n("ease"), effortScore: r.n("effort"), costScore: r.n("cost"), riskScore: r.n("riskScore"), owner: r.s("owner"), dueDate: r.s("due"), followUpIndicator: r.s("indicator"), validationStatus: r.s("validation"),
    });
    c(SH8).inserted++;
  }
  for (const part of chunk(oppRows, 100)) await tx.insert(improvementOpportunities).values(part as never);

  /* Hoja 9: rediseño (clave: tipo, área, cargo actual) */
  const SH9 = "9_Rediseno"; const redRows: Record<string, unknown>[] = []; const seenRed = new Set<string>();
  const haveRed = new Set((await tx.select({ kind: redesignProposals.dataKind, area: redesignProposals.areaId, pos: redesignProposals.currentPositionName }).from(redesignProposals).where(eq(redesignProposals.studyId, studyId))).map((x) => `${x.kind}|${x.area}|${key(x.pos)}`));
  for (const r of p.redesign) {
    const [area, pos] = [r.s("area"), r.s("position")];
    if (!area || !pos) { c(SH9).rejected++; issue(SH9, r.row, "clave", "MISSING_KEY", "error", "Falta el área; la fila no se puede identificar y no se importó"); continue; }
    const kind = kindOf(r, SH9); const arId = await areaId(area, { sheet: SH9, row: r.row }); const k = `${kind}|${arId}|${key(pos)}`;
    if (seenRed.has(k)) { c(SH9).rejected++; issue(SH9, r.row, "clave", "DUPLICATE_KEY", "error", "Rediseño repetido para el mismo cargo; la fila no se importó"); continue; }
    seenRed.add(k);
    if (haveRed.has(k)) { c(SH9).skipped++; continue; }
    redRows.push({
      studyId, dataKind: kind, areaId: arId, currentPositionName: pos, currentObjective: r.s("objective"), currentFunctions: r.s("functions"), keptActivities: r.s("kept"), modifiedActivities: r.s("modified"),
      removedActivities: r.s("removed"), transferredActivities: r.s("transferred"), receivingPositionName: r.s("receiving"), newResponsibilities: r.s("newResp"), limitsAndAuthority: r.s("limits"),
      requiredCompetencies: r.s("competencies"), trainingNeeds: r.s("training"), performanceIndicators: r.s("indicators"), reportingLines: r.s("reporting"), hoursOutPerWeek: S(r.n("hoursOut")),
      hoursInPerWeek: S(r.n("hoursIn")), hoursRecoveredPerWeek: S(r.n("hoursRecovered")), justification: r.s("justification"), expectedBenefits: r.s("benefits"), risksAndConditions: r.s("risks"),
      ...(r.s("approval") ? { approvalStatus: r.s("approval") } : {}),
    });
    c(SH9).inserted++;
  }
  for (const part of chunk(redRows, 100)) await tx.insert(redesignProposals).values(part as never);

  /* Hoja 10: plan de acción */
  const SH10 = "10_Plan_accion"; const planRows: Record<string, unknown>[] = []; const seenPlan = new Set<string>();
  const havePlan = new Set((await tx.select({ code: actionItems.code }).from(actionItems).where(eq(actionItems.studyId, studyId))).map((x) => key(x.code)));
  for (const r of p.plan) {
    const code = r.s("code")!; const k = key(code);
    if (seenPlan.has(k)) { c(SH10).rejected++; issue(SH10, r.row, "code", "DUPLICATE_CODE", "error", "ID de acción repetido; la fila no se importó"); continue; }
    seenPlan.add(k);
    if (havePlan.has(k)) { c(SH10).skipped++; continue; }
    if (!r.s("action")) { c(SH10).rejected++; issue(SH10, r.row, "action", "MISSING_FIELD", "error", "La acción no tiene descripción; no se inventa y no se importó"); continue; }
    const area = r.s("area"); const arId = area ? areaIds.get(key(area)) ?? null : null;
    if (area && !arId) issue(SH10, r.row, "area", "NOT_IN_LIST", "warning", `Área '${area.slice(0, 50)}' no registrada; el vínculo quedó vacío`);
    const [start, end] = [r.s("start"), r.s("end")];
    const badDates = start && end && end < start;
    if (badDates) issue(SH10, r.row, "end", "DATE_ORDER", "warning", "La fecha de fin es anterior a la de inicio; ambas fechas quedaron vacías");
    planRows.push({
      studyId, dataKind: kindOf(r, SH10), code, finding: r.s("finding"), action: r.s("action"), areaId: arId, positionName: r.s("position"), resources: r.s("resources"), estimatedCost: S(r.n("cost")),
      priority: r.s("priority"), initiativeType: r.s("initiative"), startDate: badDates ? null : start, endDate: badDates ? null : end, dependencies: r.s("dependencies"), risks: r.s("risks"),
      resultIndicator: r.s("indicator"), target: S(r.n("target")), status: r.s("status"), actualResult: S(r.n("actual")),
    });
    c(SH10).inserted++;
  }
  for (const part of chunk(planRows, 100)) await tx.insert(actionItems).values(part as never);

  /* Verificación 1: conteo por hoja (filas con clave = insertadas + omitidas + rechazadas) */
  const sheets = ["2_Caracterizacion", "3_Actividades", "5_Medibilidad", "6_Pertinencia", "7_Riesgos", "8_Oportunidades", "9_Rediseno", "10_Plan_accion"];
  for (const s of sheets) c(s);
  const countsOk = sheets.every((s) => counts[s].rows === counts[s].inserted + counts[s].skipped + counts[s].rejected);

  /* Verificación 2: recálculo del motor contra las columnas guardadas de la hoja 4a (tolerancia 1e-9) */
  const d = await loadStudyDataTx(tx, studyId);
  const byCode = new Map(d.acts.map((a) => [key(a.code), a]));
  const diffs: Diff[] = []; const notCompared: string[] = []; let compared = 0, nActs = 0;
  for (const [code, exp] of p.expected4a) {
    const a: ActivityInput | undefined = byCode.get(code);
    if (!a) { notCompared.push(code); continue; }
    nActs++;
    const res = computeActivity(a, d.params, occupantsOf(d.staff, a));
    compared++;
    const status = STATUS_ES[res.status];
    if (exp.status !== null && status !== exp.status) diffs.push({ code, field: "status", app: status, excel: exp.status });
    if (res.status !== "OK") continue;
    const mine: Record<string, number | undefined> = { ...(res as unknown as Record<string, number | undefined>), occupants: occupantsOf(d.staff, a) };
    for (const [f, ev] of Object.entries(exp.v)) {
      const av = mine[f] ?? 0, xv = ev ?? 0; compared++;
      if (!close(av, xv)) diffs.push({ code, field: f, app: av, excel: xv });
    }
  }

  /* Verificación 3: consolidados de la hoja 4b (por área, modo REAL como CritModo; por cargo y sede) */
  const cmp = (code: string, field: string, mine: number | null, excel: number | null) => {
    compared++;
    if (mine === null || excel === null ? mine !== excel : !close(mine, excel)) diffs.push({ code, field, app: mine, excel });
  };
  const anReal = analyze(d.staff, d.acts, d.params, d.thresholds, "real"), anAll = analyze(d.staff, d.acts, d.params, d.thresholds, "all");
  for (const x of p.expected4b.areas) {
    const mine = anReal.areas.find((z) => key(z.area) === key(x.area));
    if (!mine && !areaIds.has(key(x.area))) continue; // fila de totales u otra que no es un área del estudio
    if (!mine && x.acts === 0 && x.capacity === 0) continue;
    const code = `4b:área:${x.area}`;
    cmp(code, "actividades", mine?.activities ?? 0, x.acts); cmp(code, "completas", mine?.complete ?? 0, x.complete); cmp(code, "horas", mine?.hours ?? 0, x.hours);
    cmp(code, "capacidad", mine?.capacity ?? 0, x.capacity); cmp(code, "pct", mine?.pct ?? null, x.pct);
  }
  for (const x of p.expected4b.positions) {
    const mine = anAll.positions.find((z) => key(z.dataKind, z.area, z.site, z.position) === key(x.kind.toLowerCase(), x.area, x.site, x.position));
    const code = `4b:cargo:${x.position}`;
    if (!mine) { diffs.push({ code, field: "existe", app: null, excel: x.position }); continue; }
    cmp(code, "ocupantes", mine.occupants, x.occupants); cmp(code, "capacidad", mine.capacity, x.capacity); cmp(code, "horas", mine.hours, x.hours); cmp(code, "pct", mine.pct, x.pct);
  }

  /* Informe y auditoría */
  const stored = rep.issues.slice(0, 1000);
  if (stored.length) await tx.insert(validationIssues).values(stored.map((i) => ({ studyId, entity: i.sheet, field: `fila ${i.row}${i.field ? `: ${i.field}` : ""}`, ruleCode: i.rule, severity: i.severity, autoFixable: i.rule === "LABEL_AUTOFIXED", status: i.rule === "LABEL_AUTOFIXED" ? "auto_fixed" : "open" })));
  await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "import", action: "import", entity: "study", entityId: studyId, diff: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { from: null, to: v }])) });
  return { committed: false, counts, issues: rep.issues, verification: { countsOk, recompute: { compared, activities: nActs, notCompared, diffs } } };
}
