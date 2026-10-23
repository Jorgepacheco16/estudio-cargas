import { z } from "zod";

/** Estos enums replican (en el mismo orden y con los mismos códigos) los pgEnum de src/db/schema.ts. */
export const periodUnit = z.enum(["day", "week", "fortnight", "month", "quarter", "year"]);
export const calcMode = z.enum(["per_event", "per_unit"]);
export const execScope = z.enum(["per_employee", "position_total"]);
export const dataKind = z.enum(["real", "demo"]);
const num = z.number().finite().nonnegative();

/** Cuerpo de POST/PATCH /api/studies/:studyId/activities (subconjunto representativo de las 51 columnas de la hoja 3). */
export const activityUpsert = z.object({
  id: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive().optional(), // concurrencia optimista: obligatorio en PATCH
  dataKind: dataKind.default("real"),
  code: z.string().trim().min(1),
  positionId: z.string().uuid(),
  secondaryPositionId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1),
  calcMode: calcMode.nullable().optional(),
  executionsPerPeriod: num.nullable().optional(),
  period: periodUnit.nullable().optional(),
  scope: execScope.nullable().optional(),
  unitsPerExecution: num.nullable().optional(),
  timeAvgMin: num.nullable().optional(),
  loadSharePct: z.number().min(0).max(1).nullable().optional(),
  simultaneousPeople: z.number().int().min(1).max(50).nullable().optional(),
  reworkPct: z.number().min(0).max(1).nullable().optional(),
}).strict();
export type ActivityUpsert = z.infer<typeof activityUpsert>;

/** Evento que envía Google Apps Script cuando alguien edita la hoja (hoja → app). */
export const sheetChangeEvent = z.object({
  eventId: z.string().uuid(),                 // llave de idempotencia (sync_events.origin_id)
  spreadsheetId: z.string().min(10),
  sheetName: z.string().min(1),
  kind: z.enum(["edit", "change"]),
  range: z.object({ row: z.number().int().positive(), col: z.number().int().positive(), rows: z.number().int().positive(), cols: z.number().int().positive() }),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(500),
  editedAt: z.string().datetime(),
}).strict();
export type SheetChangeEvent = z.infer<typeof sheetChangeEvent>;

/** Hallazgo del autocorrector / validador (tabla validation_issues). */
export const validationIssue = z.object({
  ruleCode: z.enum(["EMPTY_REQUIRED", "DUPLICATE_CODE", "NOT_IN_LIST", "BAD_NUMBER", "OUT_OF_RANGE", "WHITESPACE", "ORPHAN_REFERENCE"]),
  severity: z.enum(["error", "warning", "info"]),
  entity: z.string(), entityId: z.string().uuid().nullable(), field: z.string().nullable(),
  autoFixable: z.boolean(),
  suggestedValue: z.unknown().optional(),
}).strict();

/** Propuesta del agente (tabla agent_proposals). El agente NUNCA aplica: solo propone; una persona aprueba. */
export const agentProposal = z.object({
  kind: z.enum(["parameter", "list_value", "validation_rule", "report"]),
  summary: z.string().min(10).max(400),
  payload: z.record(z.string(), z.unknown()),
  evidence: z.array(z.object({ entity: z.string(), id: z.string().uuid() })).min(1),   // sin evidencia, no hay propuesta
}).strict();
export type AgentProposal = z.infer<typeof agentProposal>;
export const agentOutput = z.object({ proposals: z.array(agentProposal).max(20) }).strict();

/** Informe de una importación del Excel (tabla import_runs / JSONB en audit_log). */
export const importReport = z.object({
  file: z.string(), sha256: z.string().length(64),
  counts: z.record(z.string(), z.object({ read: z.number().int(), inserted: z.number().int(), skipped: z.number().int(), errors: z.number().int() })),
  issues: z.array(validationIssue.extend({ sheet: z.string(), row: z.number().int() })),
}).strict();

/** Configuración de "drill-down" (navegación por niveles) del tablero. Cada nivel agrupa, mide y apunta al siguiente. */
export const drillMetric = z.enum(["hours", "capacity", "pct", "incomplete", "unplanned", "rework", "wait", "seasonVariation"]);
export const drillConfig = z.object({
  id: z.string().min(3),
  levels: z.array(z.object({
    key: z.enum(["study", "area", "position", "activity"]),
    groupBy: z.enum(["area", "site", "position", "activity", "processType", "valueClass"]).nullable(),
    metrics: z.array(drillMetric).min(1),
    next: z.enum(["area", "position", "activity"]).nullable(),
  })).min(2),
  filters: z.object({ kind: dataKind.default("real"), alertOnly: z.enum(["overload", "lowLoad", "incomplete"]).optional(), scenario: z.enum(["base", "high_season", "low_season", "min_time", "max_time"]).optional() }).strict(),
}).strict();
export type DrillConfig = z.infer<typeof drillConfig>;

/** Formato único de error de la API; el código HTTP lo decide la tabla de §8.6 del brief. */
export const apiError = z.object({ error: z.object({ code: z.enum(["VALIDATION", "FORBIDDEN", "NOT_FOUND", "VERSION_CONFLICT", "DUPLICATE", "REFERENCE_INVALID", "RANGE_INVALID", "INTERNAL"]), message: z.string(), details: z.record(z.string(), z.unknown()).optional() }).strict() }).strict();

/** Mapeo de columnas entre una hoja de Google Sheets y los campos de la aplicación (se guarda por conexión, versionado). */
export const sheetMapping = z.object({
  version: z.number().int().positive(), sheetName: z.string().min(1), headerRow: z.number().int().positive(), firstDataRow: z.number().int().positive(),
  naturalKey: z.array(z.string()).min(1), internalColumns: z.object({ id: z.string(), version: z.string() }).strict(),
  columns: z.array(z.object({ header: z.string(), field: z.string(), type: z.enum(["text", "number", "percent", "date", "boolean", "enum"]), list: z.string().optional(),
    direction: z.enum(["both", "sheet_to_app", "app_to_sheet"]), required: z.boolean().optional() }).strict()).min(1),
}).strict();
