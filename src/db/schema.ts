import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, integer, smallint, numeric, boolean, date,
  timestamp, jsonb, bigint, unique, index, foreignKey, check,
} from "drizzle-orm/pg-core";

/* Las columnas created_by / user_id apuntan a auth.users (tabla de Supabase). Drizzle intenta CREAR esa tabla si se
   importa, así que la clave foránea se agrega en la migración SQL personalizada (drizzle/0001_rls.sql). */

/* ───────── Enumeraciones: reproducen las listas desplegables del Excel (hoja Parametros) ───────── */
export const appRole = pgEnum("app_role", ["owner", "editor", "analyst", "viewer"]);
export const dataKind = pgEnum("data_kind", ["real", "demo"]);                       // L_TipoDato
export const frequency = pgEnum("frequency", ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "occasional", "on_demand"]); // L_Frecuencia
export const periodUnit = pgEnum("period_unit", ["day", "week", "fortnight", "month", "quarter", "year"]);                                   // L_Periodo
export const calcMode = pgEnum("calc_mode", ["per_event", "per_unit"]);              // L_Modalidad
export const execScope = pgEnum("exec_scope", ["per_employee", "position_total"]);   // L_Alcance
export const triState = pgEnum("tri_state", ["yes", "partial", "no"]);               // L_SiParcialNo / L_Documentada
export const yesNoNe = pgEnum("yes_no_ne", ["yes", "no", "not_evaluated"]);          // L_SiNoNE
export const activityType = pgEnum("activity_type", ["operational", "administrative", "control", "coordination", "service", "support", "occasional"]); // L_TipoAct
export const valueClass = pgEnum("value_class", ["direct_value", "necessary_no_direct_value", "dispensable"]);  // L_Valor
export const potential = pgEnum("potential", ["high", "medium", "low", "none"]);     // L_Potencial
export const dataSource = pgEnum("data_source", ["declared_by_employee", "declared_by_manager", "observed", "timed", "verifiable_source", "validated_estimate"]); // L_Fuente
export const infoSource = pgEnum("info_source", ["interview_employee", "interview_manager", "direct_observation", "procedures_review", "records_systems", "timing"]); // L_FuenteInfo
export const confidence = pgEnum("confidence", ["high", "medium", "low"]);           // L_Confianza
export const planning = pgEnum("planning", ["planned", "unplanned"]);                // L_Planificada
export const level3 = pgEnum("level3", ["high", "medium", "low"]);                   // L_AMB
export const scenario = pgEnum("scenario", ["base", "high_season", "low_season", "min_time", "max_time"]);  // L_Escenario
export const situation = pgEnum("situation", ["s1_train", "s2_not_in_purpose", "s3_specialization", "s4_simplify_automate", "none"]); // L_Situacion
export const correspondence = pgEnum("correspondence", ["high", "partial", "low", "none"]); // L_Corresp
export const compatibility = pgEnum("compatibility", ["compatible", "partial", "incompatible"]);            // L_Compat
export const reassignment = pgEnum("reassignment", ["yes", "conditional", "no"]);    // L_Reasig
export const measureUnit = pgEnum("measure_unit", ["minutes_per_execution", "units_per_hour", "on_time_pct", "error_pct", "rework_rate", "record_accuracy", "service_level", "control_compliance", "response_time", "qualitative_criterion"]); // L_Unidad
export const indicatorKind = pgEnum("indicator_kind", ["cycle_time", "units_per_hour", "on_time_pct", "error_pct", "rework_rate", "record_accuracy", "service_level", "control_compliance", "response_time", "qualitative_criterion"]); // L_Indicador
export const opportunityType = pgEnum("opportunity_type", ["keep", "eliminate", "simplify", "standardize", "automate", "redistribute", "group", "create_specialized_role", "train", "document", "reduce_waits_rework", "improve_controls"]); // L_TipoOport
export const findingClass = pgEnum("finding_class", ["confirmed", "hypothesis", "pending_recommendation"]);  // L_Hallazgo
export const validationStatus = pgEnum("validation_status", ["pending", "in_validation", "validated", "rejected"]); // L_EstadoValid
export const planStatus = pgEnum("plan_status", ["not_started", "in_progress", "completed", "blocked", "cancelled"]); // L_EstadoPlan
export const initiativeType = pgEnum("initiative_type", ["quick_win", "investment", "tech_adjustment", "training", "org_change"]); // L_TipoIniciativa
export const approvalStatus = pgEnum("approval_status", ["drafting", "validated_by_owner", "approved_by_management", "rejected"]); // L_Aprob

const stamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1), // control de concurrencia optimista (necesario para la sincronización con Sheets)
});
const studyFk = () => uuid("study_id").notNull().references(() => studies.id, { onDelete: "cascade" });

/* ───────── Estudio, permisos y parámetros ───────── */
export const studies = pgTable("studies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: uuid("created_by").notNull(),
  ...stamps(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  userId: uuid("user_id").notNull(),
  role: appRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("memberships_study_user_uq").on(t.studyId, t.userId), index("memberships_user_idx").on(t.userId)]);

/** Hoja "Parametros" (supuestos). FechaCorte no se almacena: es la fecha actual al consultar. */
export const studyParameters = pgTable("study_parameters", {
  studyId: uuid("study_id").primaryKey().references(() => studies.id, { onDelete: "cascade" }),
  workDaysPerWeek: numeric("work_days_per_week", { precision: 4, scale: 2 }).notNull().default("6"),
  weeksPerMonth: numeric("weeks_per_month", { precision: 10, scale: 6 }).notNull().default("4.333333"),
  weeksPerYear: integer("weeks_per_year").notNull().default(52),
  reservePct: numeric("reserve_pct", { precision: 5, scale: 4 }).notNull().default("0.1000"),
  overloadThreshold: numeric("overload_threshold", { precision: 5, scale: 4 }).notNull().default("1.0000"),
  lowLoadThreshold: numeric("low_load_threshold", { precision: 5, scale: 4 }).notNull().default("0.5000"),
  hourlyCostCop: numeric("hourly_cost_cop", { precision: 14, scale: 2 }),
  scenario: scenario("scenario").notNull().default("base"),
  assumptionsValidated: boolean("assumptions_validated").notNull().default(false),
  weightImpact: smallint("weight_impact").notNull().default(3),
  weightEase: smallint("weight_ease").notNull().default(2),
  weightEffort: smallint("weight_effort").notNull().default(1),
  weightCost: smallint("weight_cost").notNull().default(1),
  weightRisk: smallint("weight_risk").notNull().default(1),
  ...stamps(),
}, (t) => [
  check("study_parameters_ranges_ck", sql`${t.workDaysPerWeek} between 1 and 7 and ${t.reservePct} between 0 and 1 and ${t.lowLoadThreshold} <= ${t.overloadThreshold}`),
]);

/* ───────── Estructura organizacional (hoja 2_Caracterizacion) ───────── */
export const areas = pgTable("areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [unique("areas_study_name_uq").on(t.studyId, t.name), unique("areas_id_study_uq").on(t.id, t.studyId)]);

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  name: text("name").notNull(),
  regional: text("regional"),
}, (t) => [unique("sites_study_name_uq").on(t.studyId, t.name), unique("sites_id_study_uq").on(t.id, t.studyId)]);

/** Clave del Excel: área|sede|cargo|tipo de dato. */
export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  areaId: uuid("area_id").notNull(),
  siteId: uuid("site_id").notNull(),
  name: text("name").notNull(),
  dataKind: dataKind("data_kind").notNull().default("real"),
  boss: text("boss"),
  objective: text("objective"),
  formalFunctions: text("formal_functions"),
  autoCreated: boolean("auto_created").notNull().default(false),
  ...stamps(),
}, (t) => [
  unique("positions_key_uq").on(t.studyId, t.areaId, t.siteId, t.name, t.dataKind),
  unique("positions_id_study_uq").on(t.id, t.studyId),
  foreignKey({ columns: [t.areaId, t.studyId], foreignColumns: [areas.id, areas.studyId], name: "positions_area_fk" }),
  foreignKey({ columns: [t.siteId, t.studyId], foreignColumns: [sites.id, sites.studyId], name: "positions_site_fk" }),
]);

/** Una fila de la hoja 2: cantidad de colaboradores, jornada y datos del levantamiento. */
export const staffingEntries = pgTable("staffing_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  positionId: uuid("position_id").notNull(),
  headcount: integer("headcount"),
  employeeCode: text("employee_code"),
  weeklyHours: numeric("weekly_hours", { precision: 5, scale: 2 }),
  surveyDate: date("survey_date"),
  surveyor: text("surveyor"),
  infoSource: infoSource("info_source"),
  notes: text("notes"),
  ...stamps(),
}, (t) => [
  foreignKey({ columns: [t.positionId, t.studyId], foreignColumns: [positions.id, positions.studyId], name: "staffing_position_fk" }).onDelete("cascade"),
  index("staffing_position_idx").on(t.positionId),
  check("staffing_ranges_ck", sql`(${t.headcount} is null or ${t.headcount} between 0 and 500) and (${t.weeklyHours} is null or ${t.weeklyHours} between 0 and 84)`),
]);

/* ───────── Inventario de actividades (hoja 3_Actividades) ───────── */
export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  dataKind: dataKind("data_kind").notNull().default("real"),
  code: text("code").notNull(),
  positionId: uuid("position_id").notNull(),
  employeeCode: text("employee_code"),
  name: text("name").notNull(),
  description: text("description"),
  process: text("process"),
  objectiveResult: text("objective_result"),
  otherPositions: text("other_positions"),
  formallyDocumented: triState("formally_documented"),
  frequency: frequency("frequency"),
  calcMode: calcMode("calc_mode"),
  executionsPerPeriod: numeric("executions_per_period", { precision: 14, scale: 4 }),
  period: periodUnit("period"),
  scope: execScope("scope"),
  unitsPerExecution: numeric("units_per_execution", { precision: 14, scale: 4 }),
  timeAvgMin: numeric("time_avg_min", { precision: 12, scale: 4 }),
  timeMinMin: numeric("time_min_min", { precision: 12, scale: 4 }),
  timeMaxMin: numeric("time_max_min", { precision: 12, scale: 4 }),
  seasonHighFactor: numeric("season_high_factor", { precision: 6, scale: 3 }),
  seasonLowFactor: numeric("season_low_factor", { precision: 6, scale: 3 }),
  dataSource: dataSource("data_source"),
  confidence: confidence("confidence"),
  simultaneousPeople: integer("simultaneous_people"),
  loadSharePct: numeric("load_share_pct", { precision: 5, scale: 4 }),
  secondaryPositionId: uuid("secondary_position_id"),
  planning: planning("planning"),
  tools: text("tools"),
  inputs: text("inputs"),
  deliverable: text("deliverable"),
  dependencies: text("dependencies"),
  waitMin: numeric("wait_min", { precision: 12, scale: 4 }),
  waitOccupiesPerson: boolean("wait_occupies_person"),
  travelMin: numeric("travel_min", { precision: 12, scale: 4 }),
  reworkPct: numeric("rework_pct", { precision: 5, scale: 4 }),
  reworkMin: numeric("rework_min", { precision: 12, scale: 4 }),
  consequences: text("consequences"),
  controls: text("controls"),
  activityType: activityType("activity_type"),
  valueClass: valueClass("value_class"),
  mandatory: boolean("mandatory"),
  standardizationPotential: potential("standardization_potential"),
  simplificationPotential: potential("simplification_potential"),
  automationPotential: potential("automation_potential"),
  integrationPossible: yesNoNe("integration_possible"),
  evidence: text("evidence"),
  notes: text("notes"),
  pendingValidation: text("pending_validation"),
  ...stamps(),
}, (t) => [
  unique("activities_study_code_uq").on(t.studyId, t.code),
  unique("activities_id_study_uq").on(t.id, t.studyId),
  foreignKey({ columns: [t.positionId, t.studyId], foreignColumns: [positions.id, positions.studyId], name: "activities_position_fk" }),
  foreignKey({ columns: [t.secondaryPositionId, t.studyId], foreignColumns: [positions.id, positions.studyId], name: "activities_secondary_position_fk" }),
  index("activities_position_idx").on(t.positionId),
  check("activities_code_ck", sql`length(btrim(${t.code})) > 0`),
  check("activities_ranges_ck", sql`
    (${t.executionsPerPeriod} is null or ${t.executionsPerPeriod} >= 0) and (${t.unitsPerExecution} is null or ${t.unitsPerExecution} >= 0)
    and (${t.timeAvgMin} is null or ${t.timeAvgMin} >= 0) and (${t.timeMinMin} is null or ${t.timeMinMin} >= 0) and (${t.timeMaxMin} is null or ${t.timeMaxMin} >= 0)
    and (${t.seasonHighFactor} is null or ${t.seasonHighFactor} between 0 and 10) and (${t.seasonLowFactor} is null or ${t.seasonLowFactor} between 0 and 10)
    and (${t.simultaneousPeople} is null or ${t.simultaneousPeople} between 1 and 50)
    and (${t.loadSharePct} is null or ${t.loadSharePct} between 0 and 1) and (${t.reworkPct} is null or ${t.reworkPct} between 0 and 1)
    and (${t.waitMin} is null or ${t.waitMin} >= 0) and (${t.travelMin} is null or ${t.travelMin} >= 0) and (${t.reworkMin} is null or ${t.reworkMin} >= 0)`),
]);

/* ───────── Evaluaciones por actividad (hojas 5, 6 y 7): una por actividad ───────── */
const perActivity = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  activityId: uuid("activity_id").notNull(),
});
const perActivityFk = (name: string, t: { activityId: any; studyId: any }) =>
  foreignKey({ columns: [t.activityId, t.studyId], foreignColumns: [activities.id, activities.studyId], name }).onDelete("cascade");

export const measurabilityAssessments = pgTable("measurability_assessments", {
  ...perActivity(),
  directMeasurement: triState("direct_measurement"),
  hasIndicators: boolean("has_indicators"),
  hasHistory: triState("has_history"),
  hasTimeStandard: boolean("has_time_standard"),
  sourceReliability: level3("source_reliability"),
  externalDependency: level3("external_dependency"),
  resultVerifiable: triState("result_verifiable"),
  recommendedUnit: measureUnit("recommended_unit"),
  proposedIndicator: indicatorKind("proposed_indicator"),
  qualitativeCriterion: text("qualitative_criterion"),
  ...stamps(),
}, (t) => [unique("measurability_activity_uq").on(t.activityId), perActivityFk("measurability_activity_fk", t)]);

export const suitabilityAssessments = pgTable("suitability_assessments", {
  ...perActivity(),
  correspondence: correspondence("correspondence"),
  technicalKnowledge: text("technical_knowledge"),
  training: text("training"),
  experience: text("experience"),
  technicalCompetencies: text("technical_competencies"),
  behavioralCompetencies: text("behavioral_competencies"),
  authorizations: text("authorizations"),
  autonomy: level3("autonomy"),
  compatibility: compatibility("compatibility"),
  currentCompetencies: text("current_competencies"),
  gaps: text("gaps"),
  trainingPossible: triState("training_possible"),
  reassignmentPossible: reassignment("reassignment_possible"),
  specializationNeeded: boolean("specialization_needed"),
  situation: situation("situation"),
  sensitiveResponsibility: boolean("sensitive_responsibility"),
  separationEvaluated: boolean("separation_evaluated"),
  ...stamps(),
}, (t) => [unique("suitability_activity_uq").on(t.activityId), perActivityFk("suitability_activity_fk", t)]);

export const riskAssessments = pgTable("risk_assessments", {
  ...perActivity(),
  risk: text("risk"),
  consequences: text("consequences"),
  impactOperational: smallint("impact_operational"),
  impactEconomic: smallint("impact_economic"),
  impactLabor: smallint("impact_labor"),
  impactLegal: smallint("impact_legal"),
  impactService: smallint("impact_service"),
  probability: smallint("probability"),
  controls: text("controls"),
  evidence: text("evidence"),
  dependencies: text("dependencies"),
  peopleWhoCanExecute: integer("people_who_can_execute"),
  duplications: text("duplications"),
  functionIncompatibility: boolean("function_incompatibility"),
  ...stamps(),
}, (t) => [
  unique("risk_activity_uq").on(t.activityId),
  perActivityFk("risk_activity_fk", t),
  check("risk_scales_ck", sql`coalesce(${t.impactOperational},1) between 1 and 5 and coalesce(${t.impactEconomic},1) between 1 and 5 and coalesce(${t.impactLabor},1) between 1 and 5 and coalesce(${t.impactLegal},1) between 1 and 5 and coalesce(${t.impactService},1) between 1 and 5 and coalesce(${t.probability},1) between 1 and 5`),
]);

/* ───────── Mejora, rediseño y plan (hojas 8, 9 y 10) ───────── */
export const improvementOpportunities = pgTable("improvement_opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  dataKind: dataKind("data_kind").notNull().default("real"),
  code: text("code").notNull(),
  type: opportunityType("type"),
  findingClass: findingClass("finding_class"),
  problem: text("problem"),
  relatedActivityId: uuid("related_activity_id"),
  evidence: text("evidence"),
  probableCause: text("probable_cause"),
  proposal: text("proposal"),
  areaId: uuid("area_id"),
  positionName: text("position_name"),
  expectedBenefit: text("expected_benefit"),
  recoverableHoursPerWeek: numeric("recoverable_hours_per_week", { precision: 10, scale: 2 }),
  impactAssumptions: text("impact_assumptions"),
  implementationRisks: text("implementation_risks"),
  impactScore: smallint("impact_score"),
  easeScore: smallint("ease_score"),
  effortScore: smallint("effort_score"),
  costScore: smallint("cost_score"),
  riskScore: smallint("risk_score"),
  owner: text("owner"),
  dueDate: date("due_date"),
  followUpIndicator: text("follow_up_indicator"),
  validationStatus: validationStatus("validation_status"),
  ...stamps(),
}, (t) => [
  unique("opportunities_study_code_uq").on(t.studyId, t.code),
  foreignKey({ columns: [t.relatedActivityId, t.studyId], foreignColumns: [activities.id, activities.studyId], name: "opportunities_activity_fk" }),
  foreignKey({ columns: [t.areaId, t.studyId], foreignColumns: [areas.id, areas.studyId], name: "opportunities_area_fk" }),
  check("opportunities_scales_ck", sql`coalesce(${t.impactScore},1) between 1 and 5 and coalesce(${t.easeScore},1) between 1 and 5 and coalesce(${t.effortScore},1) between 1 and 5 and coalesce(${t.costScore},1) between 1 and 5 and coalesce(${t.riskScore},1) between 1 and 5`),
]);

export const redesignProposals = pgTable("redesign_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  dataKind: dataKind("data_kind").notNull().default("real"),
  areaId: uuid("area_id").notNull(),
  currentPositionName: text("current_position_name").notNull(),
  currentObjective: text("current_objective"),
  currentFunctions: text("current_functions"),
  keptActivities: text("kept_activities"),
  modifiedActivities: text("modified_activities"),
  removedActivities: text("removed_activities"),
  transferredActivities: text("transferred_activities"),
  receivingPositionName: text("receiving_position_name"),
  newResponsibilities: text("new_responsibilities"),
  limitsAndAuthority: text("limits_and_authority"),
  requiredCompetencies: text("required_competencies"),
  trainingNeeds: text("training_needs"),
  performanceIndicators: text("performance_indicators"),
  reportingLines: text("reporting_lines"),
  hoursOutPerWeek: numeric("hours_out_per_week", { precision: 10, scale: 2 }),
  hoursInPerWeek: numeric("hours_in_per_week", { precision: 10, scale: 2 }),
  hoursRecoveredPerWeek: numeric("hours_recovered_per_week", { precision: 10, scale: 2 }),
  justification: text("justification"),
  expectedBenefits: text("expected_benefits"),
  risksAndConditions: text("risks_and_conditions"),
  approvalStatus: approvalStatus("approval_status").notNull().default("drafting"),
  ...stamps(),
}, (t) => [
  unique("redesign_study_area_position_uq").on(t.studyId, t.dataKind, t.areaId, t.currentPositionName),
  foreignKey({ columns: [t.areaId, t.studyId], foreignColumns: [areas.id, areas.studyId], name: "redesign_area_fk" }),
]);

export const actionItems = pgTable("action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  dataKind: dataKind("data_kind").notNull().default("real"),
  code: text("code").notNull(),
  finding: text("finding"),
  action: text("action").notNull(),
  areaId: uuid("area_id"),
  positionName: text("position_name"),
  resources: text("resources"),
  estimatedCost: numeric("estimated_cost", { precision: 16, scale: 2 }),
  priority: level3("priority"),
  initiativeType: initiativeType("initiative_type"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  dependencies: text("dependencies"),
  risks: text("risks"),
  resultIndicator: text("result_indicator"),
  target: numeric("target", { precision: 18, scale: 4 }),
  status: planStatus("status"),
  actualResult: numeric("actual_result", { precision: 18, scale: 4 }),
  ...stamps(),
}, (t) => [
  unique("actions_study_code_uq").on(t.studyId, t.code),
  foreignKey({ columns: [t.areaId, t.studyId], foreignColumns: [areas.id, areas.studyId], name: "actions_area_fk" }),
  check("actions_dates_ck", sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`),
]);

/* ───────── Capacidades NUEVAS (no existen en el Excel): auditoría, sincronización, validación, agente ───────── */
export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  studyId: studyFk(),
  actorId: uuid("actor_id"),
  origin: text("origin").notNull(),            // 'app' | 'sheet' | 'import' | 'autocorrect' | 'agent'
  action: text("action").notNull(),            // 'insert' | 'update' | 'delete' | ...
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  diff: jsonb("diff").$type<Record<string, { from: unknown; to: unknown }>>(), // JSONB: estructura variable por entidad
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_study_at_idx").on(t.studyId, t.at), index("audit_entity_idx").on(t.entity, t.entityId)]);

export const sheetConnections = pgTable("sheet_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  mode: text("mode").notNull().default("off"),     // 'off' | 'push' | 'pull' | 'bidirectional'
  mappingVersion: integer("mapping_version").notNull().default(1),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  status: text("status").notNull().default("idle"),
  ...stamps(),
}, (t) => [unique("sheet_conn_study_sheet_uq").on(t.studyId, t.spreadsheetId)]);

export const syncEvents = pgTable("sync_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  connectionId: uuid("connection_id").notNull().references(() => sheetConnections.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),          // 'sheet_to_app' | 'app_to_sheet'
  originId: uuid("origin_id").notNull(),           // llave de idempotencia y anti-eco
  sheetName: text("sheet_name").notNull(),
  rowRef: text("row_ref"),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [unique("sync_events_origin_uq").on(t.connectionId, t.originId)]);

export const validationIssues = pgTable("validation_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  field: text("field"),
  ruleCode: text("rule_code").notNull(),
  severity: text("severity").notNull(),            // 'error' | 'warning' | 'info'
  autoFixable: boolean("auto_fixable").notNull().default(false),
  suggestedValue: jsonb("suggested_value"),
  status: text("status").notNull().default("open"), // 'open' | 'auto_fixed' | 'accepted' | 'dismissed'
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
}, (t) => [index("issues_study_status_idx").on(t.studyId, t.status)]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  trigger: text("trigger").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("running"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentProposals = pgTable("agent_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),                    // 'parameter' | 'list_value' | 'validation_rule' | 'report'
  summary: text("summary").notNull(),
  payload: jsonb("payload").notNull(),             // JSONB: forma distinta por tipo de propuesta
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'applied'
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────── PROPUESTAS (fuera del alcance original): historia, productividad real y desviaciones ───────── */
export const studySnapshots = pgTable("study_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  label: text("label").notNull(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  metrics: jsonb("metrics").notNull(),             // JSONB: foto de indicadores calculados en ese momento
});

export const measurements = pgTable("measurements", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  activityId: uuid("activity_id").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  unitsProcessed: numeric("units_processed", { precision: 14, scale: 4 }),
  personHours: numeric("person_hours", { precision: 10, scale: 4 }).notNull(),
  method: dataSource("method").notNull(),
  observer: text("observer"),
}, (t) => [
  foreignKey({ columns: [t.activityId, t.studyId], foreignColumns: [activities.id, activities.studyId], name: "measurements_activity_fk" }).onDelete("cascade"),
  check("measurements_hours_ck", sql`${t.personHours} > 0`),
]);

export const deviations = pgTable("deviations", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: studyFk(),
  ruleCode: text("rule_code").notNull(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  baseline: jsonb("baseline").notNull(),
  observed: jsonb("observed").notNull(),
  explanation: text("explanation"),
  status: text("status").notNull().default("open"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});
