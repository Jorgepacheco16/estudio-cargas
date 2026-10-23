import { computeMeasurability, computeOpportunity, computePlan, computeRedesign, computeRisk, computeSuitability, labelOf } from "../src/domain/calculators";
import { check, summary } from "./helpers";

/** Tablas de verdad derivadas de las fórmulas literales de las hojas 5–10 (límites incluidos). Un oráculo con LibreOffice sobre libros de casos límite queda para el CI (§17, F5). */
const eq = <T,>(got: T, want: T, what: string) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); };
const base = { direct: "no", hasIndicators: false, hasHistory: "no", hasTimeStandard: false, reliability: "low", external: null, verifiable: "no", proposedIndicator: null, qualitativeCriterion: null } as const;

async function main() {
  await check("Hoja 5: puntaje 0–100, niveles en los límites 70 y 40 y evaluación incompleta", () => {
    eq(computeMeasurability({ ...base, direct: "yes", hasIndicators: true, hasHistory: "yes", hasTimeStandard: true, reliability: "high", verifiable: "yes" }).score, 100, "máximo");
    eq(computeMeasurability({ ...base }).score, 0, "mínimo");
    const s70 = computeMeasurability({ ...base, direct: "yes", hasHistory: "yes", hasTimeStandard: true, verifiable: "yes" });
    eq([s70.score, s70.level], [70, "Alta"], "límite 70 = Alta");
    const s40 = computeMeasurability({ ...base, direct: "yes", verifiable: "yes" });
    eq([s40.score, s40.level], [40, "Media"], "límite 40 = Media");
    const s39 = computeMeasurability({ ...base, direct: "yes", hasHistory: "partial", reliability: "medium", verifiable: "no" }); // 20+7+8 = 35
    eq([s39.score, s39.level], [35, "Baja"], "35 = Baja");
    eq(computeMeasurability({ ...base, hasIndicators: null }).level, "Evaluación incompleta", "falta un criterio");
    eq(computeMeasurability({ ...base, reliability: null }).score, null, "sin confiabilidad no hay puntaje");
  });

  await check("Hoja 5: recomendación según nivel, criterio cualitativo, indicador y dependencia externa", () => {
    eq(computeMeasurability({ ...base, hasIndicators: null }).recommendation, "Complete los seis criterios de medibilidad", "incompleta");
    eq(computeMeasurability({ ...base }).recommendation, "No fuerce una métrica numérica: defina un criterio cualitativo verificable", "baja sin criterio");
    eq(computeMeasurability({ ...base, qualitativeCriterion: "Revisión mensual" }).recommendation, "Use el criterio cualitativo registrado", "baja con criterio");
    const alta = { ...base, direct: "yes", hasIndicators: true, hasHistory: "yes", hasTimeStandard: true, reliability: "high", verifiable: "yes" } as const;
    eq(computeMeasurability(alta).recommendation, "Seleccione un indicador", "alta sin indicador");
    eq(computeMeasurability({ ...alta, proposedIndicator: "cycle_time" }).recommendation, "Medible: Tiempo de ciclo", "alta con indicador");
    eq(computeMeasurability({ ...alta, proposedIndicator: "cycle_time", external: "high" }).recommendation, "Medible, pero sensible a factores externos", "dependencia externa alta");
  });

  await check("Hoja 6: alertas de control interno en el orden de la fórmula y lectura por situación", () => {
    const s = { gaps: null, trainingPossible: null, reassignmentPossible: null, specializationNeeded: null, situation: "s1_train", sensitiveResponsibility: null, separationEvaluated: null } as const;
    eq(computeSuitability({ ...s, reassignmentPossible: "yes", sensitiveResponsibility: true, separationEvaluated: false }).alert, "Evalúe separación de funciones y autorizaciones antes de reasignar", "reasignar con responsabilidad sensible");
    eq(computeSuitability({ ...s, reassignmentPossible: "conditional", sensitiveResponsibility: true, separationEvaluated: null }).alert, "Evalúe separación de funciones y autorizaciones antes de reasignar", "condicionada");
    eq(computeSuitability({ ...s, reassignmentPossible: "yes", sensitiveResponsibility: true, separationEvaluated: true }).alert, "OK", "separación evaluada");
    eq(computeSuitability({ ...s, situation: "s3_specialization", specializationNeeded: null }).alert, "Situación 3 sin necesidad de especialización registrada", "situación 3");
    eq(computeSuitability({ ...s, gaps: "Falta formación", trainingPossible: null }).alert, "Registre si la brecha se puede cerrar con formación", "brecha sin respuesta");
    eq(computeSuitability({ ...s, situation: null }).alert, "Falta clasificar la situación", "sin situación");
    const reads: [string | null, string][] = [[null, ""], ["s1_train", "Mantener en el cargo y capacitar"], ["s2_not_in_purpose", "Evaluar reasignación (sujeta a validación)"], ["s3_specialization", "Evaluar necesidad de especialización"], ["s4_simplify_automate", "Evaluar simplificar, estandarizar o automatizar"], ["none", "Sin cambios propuestos"]];
    for (const [sit, text] of reads) eq(computeSuitability({ ...s, situation: sit, specializationNeeded: true }).reading, text, `lectura ${sit}`);
  });

  await check("Hoja 7: impacto máximo, criticidad (15/8/4), concentración y respaldo", () => {
    const r = { impOperational: null, impEconomic: null, impLabor: null, impLegal: null, impService: null, probability: null, peopleWhoCanExecute: null } as const;
    eq(computeRisk(r).maxImpact, null, "sin impactos");
    eq(computeRisk({ ...r, impLegal: 5, impLabor: 2 }).maxImpact, 5, "máximo");
    const crit = (imp: number, prob: number) => computeRisk({ ...r, impOperational: imp, probability: prob }).criticality;
    eq([crit(5, 3), crit(4, 3), crit(4, 2), crit(3, 2), crit(2, 2), crit(1, 3)], ["Crítica", "Alta", "Alta", "Media", "Media", "Baja"], "15 / 12 / 8 / 6 / 4 / 3");
    eq(computeRisk({ ...r, impOperational: 5 }).criticality, "Evaluación incompleta", "sin probabilidad");
    const w = (q: number | null, imp = 5, prob = 3) => { const x = computeRisk({ ...r, impOperational: imp, probability: prob, peopleWhoCanExecute: q }); return [x.concentration, x.backup]; };
    eq(w(null), ["Sin dato", "Registre cuántas personas la saben ejecutar"], "sin dato");
    eq(w(1), ["Alta concentración", "Requiere respaldo prioritario"], "crítica con una persona");
    eq(w(1, 1, 3), ["Alta concentración", "Evaluar respaldo"], "baja con una persona");
    eq(w(2), ["Media", "No indicada"], "dos personas");
    eq(w(5), ["Baja", "No indicada"], "cinco personas");
  });

  await check("Hoja 8: puntaje con pesos 3-2-1-1-1, prioridad (70/50), implementación, impacto económico y control del hallazgo", () => {
    const p = { weeksPerYear: 52, hourlyCost: 10000, wImpact: 3, wEase: 2, wEffort: 1, wCost: 1, wRisk: 1 };
    const o = { findingClass: "confirmed", evidence: "Registro", hoursPerWeek: 2, impact: 5, ease: 5, effort: 1, cost: 1, risk: 1 };
    eq([computeOpportunity(o, p).score, computeOpportunity(o, p).priority], [100, "Alta"], "máximo");
    eq([computeOpportunity({ ...o, impact: 3, ease: 3, effort: 3, cost: 3, risk: 3 }, p).score, computeOpportunity({ ...o, impact: 3, ease: 3, effort: 3, cost: 3, risk: 3 }, p).priority], [60, "Media"], "todo 3");
    eq(computeOpportunity({ ...o, impact: 1, ease: 1, effort: 5, cost: 5, risk: 5 }, p).priority, "Baja", "mínimo");
    eq(computeOpportunity({ ...o, risk: null }, p).priority, "Falta calificar", "faltan calificaciones");
    eq(computeOpportunity(o, p).annualImpact, 2 * 52 * 10000, "impacto económico");
    eq(computeOpportunity(o, { ...p, hourlyCost: null }).annualImpact, "Defina costo/hora en Parametros", "sin costo/hora");
    eq(computeOpportunity({ ...o, hoursPerWeek: null }, p).annualImpact, null, "sin horas");
    eq([computeOpportunity({ ...o, effort: 2, cost: 2 }, p).implementation, computeOpportunity({ ...o, effort: 3, cost: 1 }, p).implementation, computeOpportunity({ ...o, cost: null }, p).implementation], ["Rápida implementación", "Requiere proyecto", null], "implementación");
    eq(computeOpportunity({ ...o, findingClass: null }, p).control, "Falta clasificar el hallazgo", "sin clasificar");
    eq(computeOpportunity({ ...o, evidence: null }, p).control, "Confirmado sin evidencia registrada", "confirmado sin evidencia");
    eq(computeOpportunity(o, p).control, "OK", "confirmado con evidencia");
    eq(computeOpportunity({ ...o, findingClass: "hypothesis" }, p).control, "Pendiente de validación: no presentar como hallazgo confirmado", "hipótesis");
  });

  await check("Hoja 9: carga propuesta = actual − sale + entra − recuperada, y alertas del rediseño", () => {
    const r = { currentLoad: 40, capacity: 100, hoursOut: 10, hoursIn: 0, hoursRecovered: 5, receivingPosition: "Cargo B" };
    const ok = computeRedesign(r, 1);
    eq([ok.proposedLoad, ok.currentPct, ok.proposedPct, ok.alert], [25, 0.4, 0.25, "OK"], "rediseño válido");
    eq(computeRedesign({ ...r, receivingPosition: null }, 1).alert, "Indique el cargo que recibe lo trasladado", "sin cargo receptor");
    eq(computeRedesign({ ...r, hoursOut: 0, hoursRecovered: 0, currentLoad: 120, receivingPosition: null }, 1).alert, "El rediseño deja el cargo sobre su capacidad: traslada el problema", "sobre capacidad");
    eq(computeRedesign({ ...r, capacity: 0 }, 1).alert, "Falta capacidad (hoja 2)", "sin capacidad");
    eq(computeRedesign({ currentLoad: 0, capacity: 100, hoursOut: null, hoursIn: 5, hoursRecovered: null, receivingPosition: null }, 1).currentPct, null, "carga actual 0 → sin %");
  });

  await check("Hoja 10: duración, diferencia, % de cumplimiento y alerta de plazo", () => {
    const p = { start: "2026-01-01", end: "2026-01-31", target: 10, actual: 12, status: "in_progress" };
    const r = computePlan(p, "2026-01-15");
    eq([r.durationDays, r.difference, r.compliancePct, r.deadlineAlert], [30, 2, 1.2, "OK"], "plan en plazo");
    eq(computePlan(p, "2026-02-01").deadlineAlert, "Plazo vencido sin completar", "vencido");
    eq(computePlan({ ...p, status: "completed" }, "2026-02-01").deadlineAlert, "OK", "completado no se marca vencido");
    eq(computePlan({ ...p, status: "cancelled" }, "2026-02-01").deadlineAlert, "OK", "cancelado no se marca vencido");
    eq(computePlan({ ...p, status: null }, "2026-02-01").deadlineAlert, "Plazo vencido sin completar", "sin estado y vencido");
    eq(computePlan({ ...p, start: null }, "2026-01-15").deadlineAlert, "Falta registrar fechas", "sin inicio");
    eq([computePlan({ ...p, target: 0 }, "2026-01-15").compliancePct, computePlan({ ...p, actual: null }, "2026-01-15").difference], [null, null], "meta 0 o sin resultado real");
  });

  await check("Etiquetas en español: inverso de las listas del Excel", () => {
    eq([labelOf("L_Valor", "dispensable"), labelOf("L_TipoAct", "coordination"), labelOf("L_Indicador", "on_time_pct"), labelOf("L_Valor", null)], ["Podría ser prescindible", "De coordinación", "% de cumplimiento de plazos", null], "etiquetas");
  });
}
main().then(summary);
