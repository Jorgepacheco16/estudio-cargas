/**
 * Registro de cambios (D-96): nombres en español de lo que se registra y la forma legible de cada cambio. Funciones puras: las usan la pantalla, la exportación y las pruebas.
 */

export type ChangeKind = "datos" | "admin";
export const KIND_LABEL: Record<ChangeKind, string> = { datos: "Datos del estudio", admin: "Administración" };

/** Qué sección de la aplicación corresponde a cada entidad del registro, y de qué tipo es el cambio. */
export const ENTITY_INFO: Record<string, { section: string; kind: ChangeKind }> = {
  staffing: { section: "Cargos y dotación", kind: "datos" }, positions: { section: "Cargos y dotación", kind: "datos" }, position_operation: { section: "Cargos y dotación", kind: "datos" },
  position_shift: { section: "Turnos", kind: "datos" }, position_shift_type: { section: "Turnos", kind: "datos" }, activity_shifts: { section: "Turnos", kind: "datos" },
  activity: { section: "Actividades", kind: "datos" }, activities: { section: "Actividades", kind: "datos" },
  measurability: { section: "Medibilidad", kind: "datos" }, suitability: { section: "Pertinencia", kind: "datos" }, risk: { section: "Riesgos", kind: "datos" },
  opportunity: { section: "Oportunidades", kind: "datos" }, redesign: { section: "Rediseño", kind: "datos" }, action: { section: "Plan de acción", kind: "datos" },
  parameters: { section: "Parámetros", kind: "datos" }, study: { section: "Estudio", kind: "datos" },
  measurement: { section: "Historia y mediciones", kind: "datos" }, snapshot: { section: "Historia y mediciones", kind: "datos" },
  deviation: { section: "Historia y mediciones", kind: "datos" }, deviation_detection: { section: "Historia y mediciones", kind: "datos" },
  sheet_connection: { section: "Integraciones con Google", kind: "datos" }, sync: { section: "Integraciones con Google", kind: "datos" },
  agent_run: { section: "Agente de IA", kind: "datos" }, agent_proposal: { section: "Agente de IA", kind: "datos" }, coverage_run: { section: "Agente de IA", kind: "datos" },
  membership: { section: "Usuarios y roles", kind: "admin" }, membership_name: { section: "Usuarios y roles", kind: "admin" }, member_password_reset: { section: "Usuarios y roles", kind: "admin" },
  role: { section: "Usuarios y roles", kind: "admin" }, invitation: { section: "Usuarios y roles", kind: "admin" }, invitation_accepted: { section: "Usuarios y roles", kind: "admin" },
};
export const sectionOf = (entity: string) => ENTITY_INFO[entity]?.section ?? "Otras";
export const kindOf = (entity: string): ChangeKind => ENTITY_INFO[entity]?.kind ?? "datos";
/** Entidades de una lista de secciones (para filtrar en la base de datos). */
export const entitiesOfSections = (sections: string[]) => Object.entries(ENTITY_INFO).filter(([, v]) => sections.includes(v.section)).map(([e]) => e);
export const entitiesOfKinds = (kinds: string[]) => Object.entries(ENTITY_INFO).filter(([, v]) => kinds.includes(v.kind)).map(([e]) => e);
export const SECTIONS = [...new Set(Object.values(ENTITY_INFO).map((v) => v.section))];

/** Qué se hizo, con el verbo en pasado (lo que ve la persona). */
export const ACTION_LABEL: Record<string, string> = {
  insert: "Creó", update: "Modificó", delete: "Eliminó", import: "Importó", run: "Ejecutó", explain: "Explicó", sync: "Sincronizó", restore: "Restauró", approve: "Aprobó", reject: "Rechazó",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.charAt(0).toUpperCase() + a.slice(1);
export const ORIGIN_LABEL: Record<string, string> = { app: "Aplicación", sheet: "Hoja de Google", import: "Importación", autocorrect: "Autocorrector", agent: "Agente de IA" };
export const originLabel = (o: string) => ORIGIN_LABEL[o] ?? o;

/** Nombre en español de los campos que más se modifican; el resto se escribe separando las palabras del nombre. */
const FIELD_LABEL: Record<string, string> = {
  name: "Nombre", code: "Código", description: "Descripción", headcount: "Cantidad de personas", employeeCode: "Colaborador (ID)", weeklyHours: "Horas semanales", dataKind: "Tipo de dato",
  boss: "Jefe inmediato", objective: "Objetivo del cargo", formalFunctions: "Funciones formales", operationDescription: "Descripción de la operación", shiftType: "Tipo de turno",
  surveyDate: "Fecha del levantamiento", surveyor: "Quien levantó la información", infoSource: "Fuente de la información", notes: "Notas", process: "Proceso", objectiveResult: "Resultado esperado",
  otherPositions: "Otros cargos que la hacen", formallyDocumented: "Documentada formalmente", frequency: "Frecuencia", calcMode: "Forma de cálculo", executionsPerPeriod: "Ejecuciones por período",
  period: "Período", scope: "Alcance", unitsPerExecution: "Unidades por ejecución", timeAvgMin: "Tiempo promedio (min)", timeMinMin: "Tiempo mínimo (min)", timeMaxMin: "Tiempo máximo (min)",
  seasonHighFactor: "Factor temporada alta", seasonLowFactor: "Factor temporada baja", dataSource: "Fuente del dato", confidence: "Confianza", simultaneousPeople: "Personas simultáneas",
  loadSharePct: "% de carga compartida", allShifts: "Todos los turnos", planning: "Planeación", tools: "Herramientas", inputs: "Insumos", deliverable: "Entregable", dependencies: "Dependencias",
  waitMin: "Espera (min)", travelMin: "Desplazamiento (min)", reworkPct: "% de reproceso", reworkMin: "Reproceso (min)", consequences: "Consecuencias", controls: "Controles",
  activityType: "Tipo de actividad", valueClass: "Clase de valor", mandatory: "Obligatoria", standardizationPotential: "Potencial de estandarización", simplificationPotential: "Potencial de simplificación",
  automationPotential: "Potencial de automatización", integrationPossible: "Integración posible", evidence: "Evidencia", pendingValidation: "Pendiente de validar", directMeasurement: "Medible directamente",
  hasIndicators: "Tiene indicadores", hasHistory: "Tiene histórico", hasTimeStandard: "Tiene estándar de tiempo", resultVerifiable: "Resultado verificable", recommendedUnit: "Unidad recomendada",
  proposedIndicator: "Indicador propuesto", qualitativeCriterion: "Criterio cualitativo", technicalKnowledge: "Conocimiento técnico", training: "Formación", experience: "Experiencia",
  technicalCompetencies: "Competencias técnicas", behavioralCompetencies: "Competencias comportamentales", authorizations: "Autorizaciones", compatibility: "Compatibilidad",
  currentCompetencies: "Competencias actuales", gaps: "Brechas", trainingPossible: "Se puede capacitar", reassignmentPossible: "Se puede reasignar", specializationNeeded: "Requiere especialización",
  situation: "Situación", sensitiveResponsibility: "Responsabilidad sensible", separationEvaluated: "Separación de funciones evaluada", risk: "Riesgo", impactOperational: "Impacto operativo",
  impactEconomic: "Impacto económico", impactLabor: "Impacto laboral", impactLegal: "Impacto legal", impactService: "Impacto en el servicio", probability: "Probabilidad",
  peopleWhoCanExecute: "Personas que pueden ejecutarla", duplications: "Duplicidades", functionIncompatibility: "Incompatibilidad de funciones", type: "Tipo", findingClass: "Clasificación del hallazgo",
  problem: "Problema", probableCause: "Causa probable", proposal: "Propuesta", positionName: "Cargo", expectedBenefit: "Beneficio esperado", recoverableHoursPerWeek: "Horas recuperables por semana",
  impactAssumptions: "Supuestos de impacto", implementationRisks: "Riesgos de implementación", impactScore: "Puntaje de impacto", easeScore: "Puntaje de facilidad", effortScore: "Puntaje de esfuerzo",
  costScore: "Puntaje de costo", riskScore: "Puntaje de riesgo", owner: "Responsable", dueDate: "Fecha de vencimiento", followUpIndicator: "Indicador de seguimiento", validationStatus: "Estado de validación",
  currentPositionName: "Cargo actual", currentObjective: "Objetivo actual", currentFunctions: "Funciones actuales", keptActivities: "Actividades que se mantienen", modifiedActivities: "Actividades modificadas",
  removedActivities: "Actividades que se eliminan", transferredActivities: "Actividades trasladadas", receivingPositionName: "Cargo que recibe", newResponsibilities: "Nuevas responsabilidades",
  limitsAndAuthority: "Límites y autoridad", requiredCompetencies: "Competencias requeridas", trainingNeeds: "Necesidades de formación", performanceIndicators: "Indicadores de desempeño",
  reportingLines: "Líneas de reporte", hoursOutPerWeek: "Horas que salen por semana", hoursInPerWeek: "Horas que entran por semana", hoursRecoveredPerWeek: "Horas recuperadas por semana",
  justification: "Justificación", expectedBenefits: "Beneficios esperados", risksAndConditions: "Riesgos y condiciones", approvalStatus: "Estado de aprobación", finding: "Hallazgo", action: "Acción",
  resources: "Recursos", estimatedCost: "Costo estimado", initiativeType: "Tipo de iniciativa", startDate: "Fecha de inicio", endDate: "Fecha de fin", risks: "Riesgos", resultIndicator: "Indicador de resultado",
  target: "Meta", status: "Estado", actualResult: "Resultado real", priority: "Prioridad", workDaysPerWeek: "Días laborales por semana", dailyWorkHours: "Horas laborales por día",
  weeksPerMonth: "Semanas por mes", weeksPerYear: "Semanas por año", reservePct: "% de reserva", overloadThreshold: "Umbral de sobrecarga", lowLoadThreshold: "Umbral de baja carga",
  hourlyCostCop: "Costo por hora (COP)", scenario: "Escenario", assumptionsValidated: "Supuestos validados", personHours: "Horas-persona", label: "Nombre de la foto", shifts: "Turnos",
  rol: "Rol", areas: "Áreas", acceso: "Acceso", clave: "Clave", nombre: "Nombre", permisos: "Permisos", email: "Correo", creadas: "Creadas",
};
const SKIP_FIELD = /(^|[a-z])Id$|^id$|^studyId$|^version$|^createdAt$|^updatedAt$|^autoCreated$/;
export const isShownField = (k: string) => !SKIP_FIELD.test(k) && k !== "autoCreated";
export function fieldLabel(key: string): string {
  if (FIELD_LABEL[key]) return FIELD_LABEL[key];
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/;
/** Un valor del cambio, como lo lee una persona. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return v.toLocaleString("es-CO", { maximumFractionDigits: 4 });
  if (Array.isArray(v)) return v.length ? v.map(valueText).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  const d = ISO_DAY.exec(s);
  if (d) return `${d[3]}/${d[2]}/${d[1]}`;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export interface DiffLine { field: string; from: string | null; to: string | null }
/**
 * Lo que cambió, una línea por campo. Al crear solo se muestra el valor nuevo; al eliminar, el que tenía; al modificar, antes y después. Los campos técnicos y las referencias
 * internas (…Id) no se muestran.
 */
export function diffLines(action: string, diff: Record<string, { from: unknown; to: unknown }> | null | undefined): DiffLine[] {
  if (!diff) return [];
  return Object.entries(diff).filter(([k]) => isShownField(k)).map(([k, v]) => ({
    field: fieldLabel(k),
    from: action === "insert" ? null : valueText(v?.from),
    to: action === "delete" ? null : valueText(v?.to),
  }));
}
export function diffText(action: string, diff: Record<string, { from: unknown; to: unknown }> | null | undefined): string {
  return diffLines(action, diff).map((l) => (l.from !== null && l.to !== null ? `${l.field}: ${l.from} → ${l.to}` : `${l.field}: ${l.to ?? l.from}`)).join(" · ");
}

/** Quita tildes y pasa a minúsculas (la búsqueda no distingue). */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Palabras de una búsqueda: todas deben aparecer. Los comodines de LIKE se escapan para que se busquen como texto. */
export function searchWords(q: string | undefined): string[] {
  return fold((q ?? "").trim()).split(/\s+/).filter(Boolean).slice(0, 8).map((w) => w.slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`));
}
/** La palabra tal como la escribió la persona (sin los escapes que searchWords agrega para LIKE). */
export const unescapeWord = (w: string) => w.replace(/\\([\\%_])/g, "$1");
/** Entidades cuyo nombre de sección contiene la palabra (así «actividades» o «riesgos» también encuentra por la sección). */
export const entitiesMatchingWord = (word: string) => { const w = unescapeWord(word); return w ? Object.entries(ENTITY_INFO).filter(([, v]) => fold(v.section).includes(w)).map(([e]) => e) : []; };
/** Acciones cuyo verbo empieza por la palabra («elimin» → Eliminó). */
export const actionsMatchingWord = (word: string) => { const w = unescapeWord(word); return w ? Object.keys(ACTION_LABEL).filter((a) => fold(actionLabel(a)).startsWith(w)) : []; };

export const PAGE_SIZE = 50;
