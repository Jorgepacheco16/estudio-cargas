/**
 * Reglas de cálculo de las hojas 5 a 10 del Excel (columnas grises). Funciones puras: reciben las columnas de ENTRADA con
 * los códigos de enum de la base y devuelven los mismos resultados y textos que las fórmulas del libro.
 * Cada fórmula literal está en docs/brief (Anexo C) y en el libro de referencia.
 */
import { LABELS } from "./labels";

type Tri = "yes" | "partial" | "no" | null;
type Lvl = "high" | "medium" | "low" | null;

/** Etiqueta en español de un código de enum (inverso de LABELS). */
export function labelOf(list: keyof typeof LABELS, code: string | null | undefined): string | null {
  if (!code) return null;
  const map = LABELS[list].map as Record<string, string>;
  return Object.keys(map).find((k) => map[k] === code) ?? null;
}

/* ───────── Hoja 5 · Medibilidad ───────── */
export interface MeasInput { direct: Tri; hasIndicators: boolean | null; hasHistory: Tri; hasTimeStandard: boolean | null; reliability: Lvl; external: Lvl; verifiable: Tri; proposedIndicator: string | null; qualitativeCriterion: string | null }
export interface MeasResult { score: number | null; level: "Alta" | "Media" | "Baja" | "Evaluación incompleta"; recommendation: string }

/** Indicador sugerido por tipo de actividad (hoja Parametros, tabla TblIndic). */
export const SUGGESTED_INDICATORS: Record<string, string> = {
  operational: "Unidades procesadas por hora; tiempo de ciclo",
  administrative: "% de cumplimiento de plazos; exactitud del registro",
  control: "Cumplimiento de controles; % de errores detectados",
  coordination: "Tiempo de respuesta; criterio cualitativo verificable",
  service: "Nivel de servicio; tiempo de respuesta",
  support: "% de cumplimiento de plazos; tasa de reprocesos",
  occasional: "Tiempo de respuesta; criterio cualitativo verificable",
};

/** ROUND(x;0) de Excel: redondea sobre 15 cifras significativas, mitad hacia arriba. (23/40*100 da 57,49999999999999 en coma flotante; Excel devuelve 58.) */
export const excelRound = (x: number) => { const y = Number(x.toPrecision(15)); return y < 0 ? -Math.round(-y) : Math.round(y); };

const tri = (v: Tri, yes: number, partial: number) => (v === "yes" ? yes : v === "partial" ? partial : 0);

export function computeMeasurability(m: MeasInput): MeasResult {
  const incomplete = [m.direct, m.hasIndicators, m.hasHistory, m.hasTimeStandard, m.reliability, m.verifiable].some((x) => x === null);
  const score = incomplete ? null
    : tri(m.direct, 20, 10) + (m.hasIndicators ? 15 : 0) + tri(m.hasHistory, 15, 7) + (m.hasTimeStandard ? 15 : 0) + (m.reliability === "high" ? 15 : m.reliability === "medium" ? 8 : 0) + tri(m.verifiable, 20, 10);
  const level = score === null ? "Evaluación incompleta" : score >= 70 ? "Alta" : score >= 40 ? "Media" : "Baja";
  let recommendation: string;
  if (level === "Evaluación incompleta") recommendation = "Complete los seis criterios de medibilidad";
  else if (level === "Baja") recommendation = !m.qualitativeCriterion ? "No fuerce una métrica numérica: defina un criterio cualitativo verificable" : "Use el criterio cualitativo registrado";
  else if (!m.proposedIndicator) recommendation = "Seleccione un indicador";
  else if (m.external === "high") recommendation = "Medible, pero sensible a factores externos";
  else recommendation = `Medible: ${labelOf("L_Indicador", m.proposedIndicator) ?? m.proposedIndicator}`;
  return { score, level, recommendation };
}

/* ───────── Hoja 6 · Pertinencia ───────── */
export interface SuitInput { gaps: string | null; trainingPossible: Tri; reassignmentPossible: "yes" | "conditional" | "no" | null; specializationNeeded: boolean | null; situation: string | null; sensitiveResponsibility: boolean | null; separationEvaluated: boolean | null }
export interface SuitResult { alert: string; reading: string }

export function computeSuitability(s: SuitInput): SuitResult {
  let alert: string;
  if ((s.reassignmentPossible === "yes" || s.reassignmentPossible === "conditional") && s.sensitiveResponsibility === true && s.separationEvaluated !== true) alert = "Evalúe separación de funciones y autorizaciones antes de reasignar";
  else if (s.situation === "s3_specialization" && s.specializationNeeded !== true) alert = "Situación 3 sin necesidad de especialización registrada";
  else if (s.gaps && s.trainingPossible === null) alert = "Registre si la brecha se puede cerrar con formación";
  else if (!s.situation) alert = "Falta clasificar la situación";
  else alert = "OK";
  const reading = !s.situation ? "" : s.situation === "s1_train" ? "Mantener en el cargo y capacitar" : s.situation === "s2_not_in_purpose" ? "Evaluar reasignación (sujeta a validación)"
    : s.situation === "s3_specialization" ? "Evaluar necesidad de especialización" : s.situation === "s4_simplify_automate" ? "Evaluar simplificar, estandarizar o automatizar" : "Sin cambios propuestos";
  return { alert, reading };
}

/* ───────── Hoja 7 · Riesgos ───────── */
export interface RiskInput { impOperational: number | null; impEconomic: number | null; impLabor: number | null; impLegal: number | null; impService: number | null; probability: number | null; peopleWhoCanExecute: number | null }
export interface RiskResult { maxImpact: number | null; criticality: "Crítica" | "Alta" | "Media" | "Baja" | "Evaluación incompleta"; concentration: string; backup: string }

export function computeRisk(r: RiskInput): RiskResult {
  const imps = [r.impOperational, r.impEconomic, r.impLabor, r.impLegal, r.impService].filter((x): x is number => x !== null);
  const maxImpact = imps.length ? Math.max(...imps) : null;
  let criticality: RiskResult["criticality"];
  if (maxImpact === null || r.probability === null) criticality = "Evaluación incompleta";
  else { const p = maxImpact * r.probability; criticality = p >= 15 ? "Crítica" : p >= 8 ? "Alta" : p >= 4 ? "Media" : "Baja"; }
  const q = r.peopleWhoCanExecute;
  const concentration = q === null ? "Sin dato" : q <= 1 ? "Alta concentración" : q === 2 ? "Media" : "Baja";
  const backup = q === null ? "Registre cuántas personas la saben ejecutar" : (criticality === "Crítica" || criticality === "Alta") && q <= 1 ? "Requiere respaldo prioritario" : q <= 1 ? "Evaluar respaldo" : "No indicada";
  return { maxImpact, criticality, concentration, backup };
}

/* ───────── Hoja 8 · Oportunidades ───────── */
export interface OppInput { findingClass: string | null; evidence: string | null; hoursPerWeek: number | null; impact: number | null; ease: number | null; effort: number | null; cost: number | null; risk: number | null }
export interface OppParams { weeksPerYear: number; hourlyCost: number | null; wImpact: number; wEase: number; wEffort: number; wCost: number; wRisk: number }
export interface OppResult { annualImpact: number | string | null; score: number | null; priority: string; implementation: string | null; control: string }

export function computeOpportunity(o: OppInput, p: OppParams): OppResult {
  const annualImpact = o.hoursPerWeek === null ? null : p.hourlyCost === null ? "Defina costo/hora en Parametros" : o.hoursPerWeek * p.weeksPerYear * p.hourlyCost;
  const scores = [o.impact, o.ease, o.effort, o.cost, o.risk];
  const score = scores.some((x) => x === null) ? null
    : excelRound(((o.impact! * p.wImpact + o.ease! * p.wEase + (6 - o.effort!) * p.wEffort + (6 - o.cost!) * p.wCost + (6 - o.risk!) * p.wRisk) / (5 * (p.wImpact + p.wEase + p.wEffort + p.wCost + p.wRisk))) * 100);
  const priority = score === null ? "Falta calificar" : score >= 70 ? "Alta" : score >= 50 ? "Media" : "Baja";
  const implementation = o.effort === null || o.cost === null ? null : o.effort <= 2 && o.cost <= 2 ? "Rápida implementación" : "Requiere proyecto";
  const control = !o.findingClass ? "Falta clasificar el hallazgo" : o.findingClass === "confirmed" ? (!o.evidence ? "Confirmado sin evidencia registrada" : "OK") : "Pendiente de validación: no presentar como hallazgo confirmado";
  return { annualImpact, score, priority, implementation, control };
}

/* ───────── Hoja 9 · Rediseño ───────── */
export interface RedesignInput { currentLoad: number; capacity: number; hoursOut: number | null; hoursIn: number | null; hoursRecovered: number | null; receivingPosition: string | null }
export interface RedesignResult { currentPct: number | null; proposedLoad: number; proposedPct: number | null; alert: string }

export function computeRedesign(r: RedesignInput, overloadThreshold: number): RedesignResult {
  const out = r.hoursOut ?? 0, inn = r.hoursIn ?? 0, rec = r.hoursRecovered ?? 0;
  const proposedLoad = r.currentLoad - out + inn - rec;
  const currentPct = r.capacity === 0 || r.currentLoad === 0 ? null : r.currentLoad / r.capacity;
  const proposedPct = r.capacity === 0 ? null : proposedLoad / r.capacity;
  let alert: string;
  if (r.capacity === 0) alert = "Falta capacidad (hoja 2)";
  else if (proposedLoad / r.capacity > overloadThreshold) alert = "El rediseño deja el cargo sobre su capacidad: traslada el problema";
  else if (out > 0 && !r.receivingPosition) alert = "Indique el cargo que recibe lo trasladado";
  else alert = "OK";
  return { currentPct, proposedLoad, proposedPct, alert };
}

/* ───────── Hoja 10 · Plan de acción ───────── */
export interface PlanInput { start: string | null; end: string | null; target: number | null; actual: number | null; status: string | null }
export interface PlanResult { durationDays: number | null; difference: number | null; compliancePct: number | null; deadlineAlert: string }

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** `today` = fecha de corte (FechaCorte del Excel es la fecha actual al consultar). */
export function computePlan(p: PlanInput, today: string): PlanResult {
  const durationDays = p.start && p.end ? dayNumber(p.end) - dayNumber(p.start) : null;
  const both = p.target !== null && p.actual !== null;
  const difference = both ? p.actual! - p.target! : null;
  const compliancePct = both && p.target !== 0 ? p.actual! / p.target! : null;
  const deadlineAlert = p.end && p.end < today && p.status !== "completed" && p.status !== "cancelled" ? "Plazo vencido sin completar" : !p.start || !p.end ? "Falta registrar fechas" : "OK";
  return { durationDays, difference, compliancePct, deadlineAlert };
}
