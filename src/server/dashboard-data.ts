/** Carga de lo necesario para el tablero (hoja 11): resultados de 4a/4b más las hojas 5–10, siempre con RLS. */
import { eq } from "drizzle-orm";
import { withRls, type Db, type Tx } from "../db/client";
import {
  actionItems, activities, areas, improvementOpportunities, measurabilityAssessments, riskAssessments, studyParameters, suitabilityAssessments,
} from "../db/schema";
import { computeMeasurability, computeOpportunity, computePlan, computeRisk } from "../domain/calculators";
import { buildDashboard, type ActivityMeta, type Dashboard } from "../domain/dashboard";
import type { Params } from "../domain/engine";
import { withRisks } from "../domain/drill";
import { analyze, type ActivityRisk, type Analysis, type Mode, type Thresholds } from "../domain/summary";
import { loadStudyDataTx } from "./studies";

const num = (x: string | number | null) => (x === null ? null : Number(x));
const level = (v: string | null) => (v === "high" || v === "medium" || v === "low" ? v : null);
const tri = (v: string | null) => (v === "yes" || v === "partial" || v === "no" ? v : null);

/** Fecha de corte del tablero: hoy en la zona horaria del estudio (D-24). */
export const todayBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

export interface StudyDashboard { analysis: Analysis; params: Params; thresholds: Thresholds; dashboard: Dashboard }

export async function loadDashboardTx(tx: Tx, studyId: string, mode: Mode): Promise<StudyDashboard> {
  const d = await loadStudyDataTx(tx, studyId);
  const analysis0 = analyze(d.staff, d.acts, d.params, d.thresholds, mode);
  const [p] = await tx.select().from(studyParameters).where(eq(studyParameters.studyId, studyId));
  const areaNames = (await tx.select({ name: areas.name }).from(areas).where(eq(areas.studyId, studyId)).orderBy(areas.sortOrder)).map((a) => a.name);

  const acts = await tx.select().from(activities).where(eq(activities.studyId, studyId)).orderBy(activities.code);
  const kindById = new Map(acts.map((a) => [a.id, a.dataKind]));
  const meta: ActivityMeta[] = acts.map((a) => ({
    code: a.code, name: a.name, source: a.dataSource, confidence: a.confidence, valueClass: a.valueClass, activityType: a.activityType,
    autoPotential: a.automationPotential, stdPotential: a.standardizationPotential, simplPotential: a.simplificationPotential,
  }));

  const m = await tx.select().from(measurabilityAssessments).where(eq(measurabilityAssessments.studyId, studyId));
  const meas = m.map((x) => ({ kind: kindById.get(x.activityId) ?? "real", level: computeMeasurability({
    direct: tri(x.directMeasurement), hasIndicators: x.hasIndicators, hasHistory: tri(x.hasHistory), hasTimeStandard: x.hasTimeStandard, reliability: level(x.sourceReliability),
    external: level(x.externalDependency), verifiable: tri(x.resultVerifiable), proposedIndicator: x.proposedIndicator, qualitativeCriterion: x.qualitativeCriterion,
  }).level }));
  const s = await tx.select().from(suitabilityAssessments).where(eq(suitabilityAssessments.studyId, studyId));
  const suit = s.map((x) => ({ kind: kindById.get(x.activityId) ?? "real", situation: x.situation }));
  const r = await tx.select().from(riskAssessments).where(eq(riskAssessments.studyId, studyId));
  const risks = r.map((x) => { const c = computeRisk({ impOperational: x.impactOperational, impEconomic: x.impactEconomic, impLabor: x.impactLabor, impLegal: x.impactLegal, impService: x.impactService, probability: x.probability, peopleWhoCanExecute: x.peopleWhoCanExecute }); return { kind: kindById.get(x.activityId) ?? "real", criticality: c.criticality, backup: c.backup }; });

  const codeById = new Map(acts.map((a) => [a.id, a.code]));
  const byCode = new Map<string, ActivityRisk>();
  for (const x of r) {
    const c = computeRisk({ impOperational: x.impactOperational, impEconomic: x.impactEconomic, impLabor: x.impactLabor, impLegal: x.impactLegal, impService: x.impactService, probability: x.probability, peopleWhoCanExecute: x.peopleWhoCanExecute });
    const code = codeById.get(x.activityId);
    if (code && c.criticality !== "Evaluación incompleta") byCode.set(code, { criticality: c.criticality, concentration: c.concentration, backup: c.backup });
  }
  const analysis = withRisks(analysis0, byCode);

  const hourlyCost = num(p.hourlyCostCop);
  const oppParams = { weeksPerYear: p.weeksPerYear, hourlyCost, wImpact: p.weightImpact, wEase: p.weightEase, wEffort: p.weightEffort, wCost: p.weightCost, wRisk: p.weightRisk };
  const o = await tx.select().from(improvementOpportunities).where(eq(improvementOpportunities.studyId, studyId));
  const opps = o.map((x) => {
    const hours = num(x.recoverableHoursPerWeek);
    const c = computeOpportunity({ findingClass: x.findingClass, evidence: x.evidence, hoursPerWeek: hours, impact: x.impactScore, ease: x.easeScore, effort: x.effortScore, cost: x.costScore, risk: x.riskScore }, oppParams);
    return { kind: x.dataKind, findingClass: x.findingClass, hours, annualImpact: c.annualImpact };
  });
  const today = todayBogota();
  const pl = await tx.select().from(actionItems).where(eq(actionItems.studyId, studyId));
  const plans = pl.map((x) => ({ kind: x.dataKind, alert: computePlan({ start: x.startDate, end: x.endDate, target: num(x.target), actual: num(x.actualResult), status: x.status }, today).deadlineAlert }));

  const dashboard = buildDashboard({ mode, analysis, params: d.params, thresholds: d.thresholds, areaNames, assumptionsValidated: p.assumptionsValidated, hourlyCost, meta, meas, suit, risks, opps, plans });
  return { analysis, params: d.params, thresholds: d.thresholds, dashboard };
}

export async function loadDashboard(db: Db, sub: string, studyId: string, mode: Mode): Promise<StudyDashboard> {
  return withRls(db, { sub }, (tx) => loadDashboardTx(tx, studyId, mode));
}
