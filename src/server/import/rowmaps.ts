/**
 * Mapeo declarativo columna de la base ← campo de la fila normalizada, por hoja. Lo comparten la importación del Excel y la
 * sincronización con Google Sheets (en ambos sentidos), para que lean y escriban exactamente lo mismo. No resuelven cargos,
 * áreas ni actividades: eso lo hace quien llama.
 * Tipos: s = texto/código, n = número, ns = número guardado como texto (numeric de Postgres), b = Sí/No.
 */
import type { Row } from "./parse";

export type T = "s" | "n" | "ns" | "b";
export type FieldMap = Record<string, [field: string, type: T]>;

export const ACTIVITY_MAP: FieldMap = {
  employeeCode: ["employeeCode", "s"], name: ["name", "s"], description: ["description", "s"], process: ["process", "s"], objectiveResult: ["objective", "s"],
  otherPositions: ["otherPositions", "s"], formallyDocumented: ["documented", "s"], frequency: ["frequency", "s"], calcMode: ["calcMode", "s"], executionsPerPeriod: ["executions", "ns"],
  period: ["period", "s"], scope: ["scope", "s"], unitsPerExecution: ["units", "ns"], timeAvgMin: ["timeAvg", "ns"], timeMinMin: ["timeMin", "ns"], timeMaxMin: ["timeMax", "ns"],
  seasonHighFactor: ["seasonHigh", "ns"], seasonLowFactor: ["seasonLow", "ns"], dataSource: ["source", "s"], confidence: ["confidence", "s"], simultaneousPeople: ["simultaneous", "n"],
  loadSharePct: ["loadShare", "ns"], planning: ["planning", "s"], tools: ["tools", "s"], inputs: ["inputs", "s"], deliverable: ["deliverable", "s"], dependencies: ["dependencies", "s"],
  waitMin: ["waitMin", "ns"], waitOccupiesPerson: ["waitOccupies", "b"], travelMin: ["travelMin", "ns"], reworkPct: ["reworkPct", "ns"], reworkMin: ["reworkMin", "ns"],
  consequences: ["consequences", "s"], controls: ["controls", "s"], activityType: ["activityType", "s"], valueClass: ["valueClass", "s"], mandatory: ["mandatory", "b"],
  standardizationPotential: ["stdPotential", "s"], simplificationPotential: ["simplPotential", "s"], automationPotential: ["autoPotential", "s"], integrationPossible: ["integration", "s"],
  evidence: ["evidence", "s"], notes: ["notes", "s"], pendingValidation: ["pending", "s"],
};
export const MEAS_MAP: FieldMap = {
  directMeasurement: ["direct", "s"], hasIndicators: ["hasIndicators", "b"], hasHistory: ["hasHistory", "s"], hasTimeStandard: ["hasStandard", "b"], sourceReliability: ["reliability", "s"],
  externalDependency: ["external", "s"], resultVerifiable: ["verifiable", "s"], recommendedUnit: ["unit", "s"], proposedIndicator: ["indicator", "s"], qualitativeCriterion: ["criterion", "s"],
};
export const SUIT_MAP: FieldMap = {
  correspondence: ["correspondence", "s"], technicalKnowledge: ["knowledge", "s"], training: ["training", "s"], experience: ["experience", "s"], technicalCompetencies: ["techComp", "s"],
  behavioralCompetencies: ["behavComp", "s"], authorizations: ["authorizations", "s"], autonomy: ["autonomy", "s"], compatibility: ["compatibility", "s"], currentCompetencies: ["currentComp", "s"],
  gaps: ["gaps", "s"], trainingPossible: ["trainingPossible", "s"], reassignmentPossible: ["reassign", "s"], specializationNeeded: ["specialization", "b"], situation: ["situation", "s"],
  sensitiveResponsibility: ["sensitive", "b"], separationEvaluated: ["separation", "b"],
};
export const RISK_MAP: FieldMap = {
  risk: ["risk", "s"], consequences: ["consequences", "s"], impactOperational: ["impOp", "n"], impactEconomic: ["impEco", "n"], impactLabor: ["impLab", "n"], impactLegal: ["impLegal", "n"],
  impactService: ["impService", "n"], probability: ["probability", "n"], controls: ["controls", "s"], evidence: ["evidence", "s"], dependencies: ["dependencies", "s"],
  peopleWhoCanExecute: ["people", "n"], duplications: ["duplications", "s"], functionIncompatibility: ["incompat", "b"],
};
export const OPP_MAP: FieldMap = {
  type: ["type", "s"], findingClass: ["finding", "s"], problem: ["problem", "s"], evidence: ["evidence", "s"], probableCause: ["cause", "s"], proposal: ["proposal", "s"],
  positionName: ["position", "s"], expectedBenefit: ["benefit", "s"], recoverableHoursPerWeek: ["hours", "ns"], impactAssumptions: ["assumptions", "s"], implementationRisks: ["risks", "s"],
  impactScore: ["impact", "n"], easeScore: ["ease", "n"], effortScore: ["effort", "n"], costScore: ["cost", "n"], riskScore: ["riskScore", "n"], owner: ["owner", "s"], dueDate: ["due", "s"],
  followUpIndicator: ["indicator", "s"], validationStatus: ["validation", "s"],
};
export const PLAN_MAP: FieldMap = {
  finding: ["finding", "s"], action: ["action", "s"], positionName: ["position", "s"], resources: ["resources", "s"], estimatedCost: ["cost", "ns"], priority: ["priority", "s"],
  initiativeType: ["initiative", "s"], dependencies: ["dependencies", "s"], risks: ["risks", "s"], resultIndicator: ["indicator", "s"], target: ["target", "ns"], status: ["status", "s"],
  actualResult: ["actual", "ns"],
};

type Values = Record<string, string | number | boolean | null>;
const S = (n: number | null) => (n === null ? null : String(n));
/** Fila normalizada → columnas de la base. */
export function forward(map: FieldMap, r: Row): Values {
  return Object.fromEntries(Object.entries(map).map(([db, [f, t]]) => [db, t === "s" ? r.s(f) : t === "n" ? r.n(f) : t === "ns" ? S(r.n(f)) : r.b(f)]));
}

export const activityFields = (r: Row) => forward(ACTIVITY_MAP, r);
export const measFields = (r: Row) => forward(MEAS_MAP, r);
export const suitFields = (r: Row) => forward(SUIT_MAP, r);
export const riskFields = (r: Row) => forward(RISK_MAP, r);
export const oppFields = (r: Row) => forward(OPP_MAP, r);
export const planFields = (r: Row) => forward(PLAN_MAP, r);
