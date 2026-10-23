/**
 * Captura de las hojas 5–10 y de los parámetros (Fase 3). Una definición declarativa por hoja alimenta el formulario,
 * la validación y el guardado. Todo pasa por withRls(); los campos vacíos se guardan vacíos (no se inventan valores).
 */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { withRls, type Db } from "../db/client";
import {
  actionItems, auditLog, improvementOpportunities, measurabilityAssessments, redesignProposals, riskAssessments, studyParameters, suitabilityAssessments,
} from "../db/schema";
import { LABELS } from "../domain/labels";

export type FieldKind = "text" | "longtext" | "bool" | "scale" | "int" | "num" | "pct" | "date" | "list" | "activity" | "area";
export interface Field { key: string; label: string; kind: FieldKind; list?: keyof typeof LABELS; required?: boolean; notNull?: boolean; max?: number; hint?: string }
export interface SheetDef { id: string; title: string; table: PgTable; keyCols: string[]; idCol: "id" | "studyId"; fields: Field[]; entity: string }

const L = (key: string, label: string, list: keyof typeof LABELS, o: Partial<Field> = {}): Field => ({ key, label, kind: "list", list, ...o });
const T = (key: string, label: string, o: Partial<Field> = {}): Field => ({ key, label, kind: "longtext", ...o });
const B = (key: string, label: string): Field => ({ key, label, kind: "bool" });
const S = (key: string, label: string, hint = "1 a 5"): Field => ({ key, label, kind: "scale", hint });
const N = (key: string, label: string, o: Partial<Field> = {}): Field => ({ key, label, kind: "num", ...o });
const DK = (): Field => L("dataKind", "Tipo de dato", "L_TipoDato", { notNull: true });
const AC = (): Field => ({ key: "activityId", label: "Actividad", kind: "activity", required: true });

export const SHEETS: SheetDef[] = [
  { id: "5", title: "5 · Medibilidad", table: measurabilityAssessments, keyCols: ["activityId"], idCol: "id", entity: "measurability", fields: [
    AC(), L("directMeasurement", "¿Se puede medir directamente?", "L_SiParcialNo"), B("hasIndicators", "¿Tiene indicadores?"), L("hasHistory", "¿Hay histórico?", "L_SiParcialNo"),
    B("hasTimeStandard", "¿Tiene tiempo estándar?"), L("sourceReliability", "Confiabilidad de la fuente", "L_AMB"), L("externalDependency", "Dependencia externa", "L_AMB"),
    L("resultVerifiable", "¿Resultado verificable?", "L_SiParcialNo"), L("recommendedUnit", "Unidad recomendada", "L_Unidad"), L("proposedIndicator", "Indicador propuesto", "L_Indicador"),
    T("qualitativeCriterion", "Criterio cualitativo"),
  ] },
  { id: "6", title: "6 · Pertinencia", table: suitabilityAssessments, keyCols: ["activityId"], idCol: "id", entity: "suitability", fields: [
    AC(), L("correspondence", "Correspondencia con el cargo", "L_Corresp"), T("technicalKnowledge", "Conocimientos técnicos"), T("training", "Formación"), T("experience", "Experiencia"),
    T("technicalCompetencies", "Competencias técnicas"), T("behavioralCompetencies", "Competencias conductuales"), T("authorizations", "Autorizaciones"), L("autonomy", "Autonomía", "L_Autonomia"),
    L("compatibility", "Compatibilidad", "L_Compat"), T("currentCompetencies", "Competencias actuales"), T("gaps", "Brechas"), L("trainingPossible", "¿Se cierra con formación?", "L_SiParcialNo"),
    L("reassignmentPossible", "¿Reasignación posible?", "L_Reasig"), B("specializationNeeded", "¿Requiere especialización?"), L("situation", "Situación", "L_Situacion"),
    B("sensitiveResponsibility", "¿Responsabilidad sensible?"), B("separationEvaluated", "¿Separación de funciones evaluada?"),
  ] },
  { id: "7", title: "7 · Riesgos", table: riskAssessments, keyCols: ["activityId"], idCol: "id", entity: "risk", fields: [
    AC(), T("risk", "Riesgo"), T("consequences", "Consecuencias"), S("impactOperational", "Impacto operativo"), S("impactEconomic", "Impacto económico"), S("impactLabor", "Impacto laboral"),
    S("impactLegal", "Impacto legal"), S("impactService", "Impacto en servicio"), S("probability", "Probabilidad"), T("controls", "Controles"), T("evidence", "Evidencia"), T("dependencies", "Dependencias"),
    { key: "peopleWhoCanExecute", label: "Personas que la saben ejecutar", kind: "int", max: 1000 }, T("duplications", "Duplicidades"), B("functionIncompatibility", "¿Incompatibilidad de funciones?"),
  ] },
  { id: "8", title: "8 · Oportunidades", table: improvementOpportunities, keyCols: ["code"], idCol: "id", entity: "opportunity", fields: [
    DK(), { key: "code", label: "Código", kind: "text", required: true, max: 40 }, L("type", "Tipo de oportunidad", "L_TipoOport"), L("findingClass", "Clase de hallazgo", "L_Hallazgo"), T("problem", "Problema"),
    { key: "relatedActivityId", label: "Actividad relacionada", kind: "activity" }, T("evidence", "Evidencia"), T("probableCause", "Causa probable"), T("proposal", "Propuesta"),
    { key: "areaId", label: "Área", kind: "area" }, { key: "positionName", label: "Cargo", kind: "text", max: 160 }, T("expectedBenefit", "Beneficio esperado"),
    N("recoverableHoursPerWeek", "Horas recuperables por semana"), T("impactAssumptions", "Supuestos del impacto"), T("implementationRisks", "Riesgos de implementación"),
    S("impactScore", "Impacto"), S("easeScore", "Facilidad"), S("effortScore", "Esfuerzo"), S("costScore", "Costo"), S("riskScore", "Riesgo"),
    { key: "owner", label: "Responsable", kind: "text", max: 160 }, { key: "dueDate", label: "Fecha límite", kind: "date" }, { key: "followUpIndicator", label: "Indicador de seguimiento", kind: "text", max: 300 },
    L("validationStatus", "Estado de validación", "L_EstadoValid"),
  ] },
  { id: "9", title: "9 · Rediseño", table: redesignProposals, keyCols: ["dataKind", "areaId", "currentPositionName"], idCol: "id", entity: "redesign", fields: [
    DK(), { key: "areaId", label: "Área", kind: "area", required: true }, { key: "currentPositionName", label: "Cargo actual", kind: "text", required: true, max: 160 },
    T("currentObjective", "Objetivo actual"), T("currentFunctions", "Funciones actuales"), T("keptActivities", "Actividades que se mantienen"), T("modifiedActivities", "Actividades modificadas"),
    T("removedActivities", "Actividades eliminadas"), T("transferredActivities", "Actividades trasladadas"), { key: "receivingPositionName", label: "Cargo que recibe", kind: "text", max: 160 },
    T("newResponsibilities", "Nuevas responsabilidades"), T("limitsAndAuthority", "Límites y autoridad"), T("requiredCompetencies", "Competencias requeridas"), T("trainingNeeds", "Necesidades de formación"),
    T("performanceIndicators", "Indicadores de desempeño"), T("reportingLines", "Líneas de reporte"), N("hoursOutPerWeek", "Horas que salen (h/sem)"), N("hoursInPerWeek", "Horas que entran (h/sem)"),
    N("hoursRecoveredPerWeek", "Horas recuperadas (h/sem)"), T("justification", "Justificación"), T("expectedBenefits", "Beneficios esperados"), T("risksAndConditions", "Riesgos y condiciones"),
    L("approvalStatus", "Estado de aprobación", "L_Aprob", { notNull: true }),
  ] },
  { id: "10", title: "10 · Plan de acción", table: actionItems, keyCols: ["code"], idCol: "id", entity: "action", fields: [
    DK(), { key: "code", label: "Código", kind: "text", required: true, max: 40 }, T("finding", "Hallazgo"), { key: "action", label: "Acción", kind: "longtext", required: true },
    { key: "areaId", label: "Área", kind: "area" }, { key: "positionName", label: "Cargo", kind: "text", max: 160 }, T("resources", "Recursos"), N("estimatedCost", "Costo estimado (COP)"),
    L("priority", "Prioridad", "L_AMB"), L("initiativeType", "Tipo de iniciativa", "L_TipoIniciativa"), { key: "startDate", label: "Inicio", kind: "date" }, { key: "endDate", label: "Fin", kind: "date" },
    T("dependencies", "Dependencias"), T("risks", "Riesgos"), { key: "resultIndicator", label: "Indicador de resultado", kind: "text", max: 300 }, N("target", "Meta"),
    L("status", "Estado", "L_EstadoPlan"), N("actualResult", "Resultado real"),
  ] },
  { id: "param", title: "Parámetros", table: studyParameters, keyCols: [], idCol: "studyId", entity: "parameters", fields: [
    N("workDaysPerWeek", "Días laborales por semana", { notNull: true, max: 7 }), N("weeksPerMonth", "Semanas por mes", { notNull: true, max: 6 }),
    { key: "weeksPerYear", label: "Semanas por año", kind: "int", notNull: true, max: 53 }, { key: "reservePct", label: "Reserva de capacidad (%)", kind: "pct", notNull: true },
    { key: "overloadThreshold", label: "Umbral de sobrecarga (%)", kind: "pct", notNull: true }, { key: "lowLoadThreshold", label: "Umbral de carga baja (%)", kind: "pct", notNull: true },
    N("hourlyCostCop", "Costo por hora (COP)", { max: 1e9 }), L("scenario", "Escenario", "L_Escenario", { notNull: true }),
    { ...B("assumptionsValidated", "Supuestos validados por el responsable"), notNull: true },
    { key: "weightImpact", label: "Peso: impacto", kind: "int", notNull: true, max: 10 }, { key: "weightEase", label: "Peso: facilidad", kind: "int", notNull: true, max: 10 },
    { key: "weightEffort", label: "Peso: esfuerzo", kind: "int", notNull: true, max: 10 }, { key: "weightCost", label: "Peso: costo", kind: "int", notNull: true, max: 10 },
    { key: "weightRisk", label: "Peso: riesgo", kind: "int", notNull: true, max: 10 },
  ] },
];
export const sheetById = (id: string | undefined) => SHEETS.find((s) => s.id === id);

export const optionsOf = (list: keyof typeof LABELS) => Object.entries(LABELS[list].map).map(([label, code]) => ({ code: code as string, label }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Convierte lo recibido del formulario en los valores de la tabla. Texto no numérico es un error, nunca 0. Devuelve los errores por campo. */
export function parseForm(def: SheetDef, raw: Record<string, FormDataEntryValue>): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of def.fields) {
    const s = String(raw[f.key] ?? "").trim();
    if (s === "") {
      if (f.required) errors.push(`${f.label}: es obligatorio`);
      else if (!f.notNull) values[f.key] = null; // los campos NOT NULL vacíos conservan su valor/predeterminado
      continue;
    }
    switch (f.kind) {
      case "text": case "longtext":
        if (s.length > (f.max ?? 4000)) errors.push(`${f.label}: máximo ${f.max ?? 4000} caracteres`); else values[f.key] = s; break;
      case "bool":
        if (s !== "yes" && s !== "no") errors.push(`${f.label}: elija Sí o No`); else values[f.key] = s === "yes"; break;
      case "scale": case "int": {
        const n = Number(s.replace(",", "."));
        const [lo, hi] = f.kind === "scale" ? [1, 5] : [0, f.max ?? 1e6];
        if (!Number.isInteger(n) || n < lo || n > hi) errors.push(`${f.label}: escriba un entero entre ${lo} y ${hi}`); else values[f.key] = n;
        break;
      }
      case "num": case "pct": {
        const n = Number(s.replace("%", "").replace(",", "."));
        const v = f.kind === "pct" ? n / 100 : n;
        const hi = f.kind === "pct" ? 1 : f.max ?? 1e12;
        if (!Number.isFinite(n) || v < 0 || v > hi) errors.push(`${f.label}: escriba un número ${f.kind === "pct" ? "entre 0 y 100" : `entre 0 y ${hi}`}`);
        else values[f.key] = f.kind === "pct" ? v.toFixed(4) : String(n);
        break;
      }
      case "date":
        if (!DATE.test(s) || Number.isNaN(Date.parse(s))) errors.push(`${f.label}: fecha inválida`); else values[f.key] = s; break;
      case "list":
        if (!optionsOf(f.list!).some((o) => o.code === s)) errors.push(`${f.label}: valor fuera de la lista`); else values[f.key] = s; break;
      case "activity": case "area":
        if (!UUID.test(s)) errors.push(`${f.label}: elija un valor de la lista`); else values[f.key] = s; break;
    }
  }
  return { values, errors };
}

/** Valores de una fila de la base como texto para precargar el formulario. */
export function toFormValue(f: Field, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.kind === "bool") return v ? "yes" : "no";
  if (f.kind === "pct") return String(Math.round(Number(v) * 10000) / 100);
  return String(v);
}

type Row = Record<string, unknown> & { id?: string; studyId: string; version: number };
const cols = (t: PgTable) => getTableColumns(t) as Record<string, Parameters<typeof eq>[0]>;

export async function listRows(db: Db, sub: string, studyId: string, def: SheetDef): Promise<Row[]> {
  const c = cols(def.table);
  return withRls(db, { sub }, async (tx) => (await tx.select().from(def.table).where(eq(c.studyId, studyId))) as Row[]);
}

export type SaveResult = "created" | "updated" | "conflict" | "exists";

/**
 * Inserta o actualiza por la clave natural de la hoja. Si la fila ya existe se exige la versión que el usuario vio
 * (control de concurrencia optimista); si cambió, devuelve "conflict" (HTTP 409 equivalente).
 */
export async function saveRow(db: Db, sub: string, studyId: string, def: SheetDef, values: Record<string, unknown>, seenVersion: number | null): Promise<SaveResult> {
  const c = cols(def.table);
  return withRls(db, { sub }, async (tx) => {
    const keyMatch = def.keyCols.map((k) => eq(c[k], values[k] as never));
    const [found] = (await tx.select().from(def.table).where(and(eq(c.studyId, studyId), ...keyMatch))) as Row[];
    let result: SaveResult;
    let entityId: string | null = null;
    if (!found) {
      if (def.idCol === "studyId") throw new Error("Estudio sin parámetros");
      const inserted = (await tx.insert(def.table).values({ ...values, studyId } as never).returning({ id: c.id } as never)) as { id: string }[];
      entityId = inserted[0]?.id ?? null; result = "created";
    } else {
      if (seenVersion === null) return "exists";
      const idMatch = eq(c[def.idCol], found[def.idCol] as never);
      const upd = (await tx.update(def.table).set(values as never).where(and(idMatch, eq(c.version, seenVersion))).returning({ v: c.version } as never)) as unknown[];
      if (upd.length !== 1) return "conflict";
      entityId = found.id ?? null; result = "updated";
    }
    const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => !found || String(found[k] ?? "") !== String(v ?? "")).map(([k, v]) => [k, { from: found ? found[k] ?? null : null, to: v }]));
    await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: result === "created" ? "insert" : "update", entity: def.entity, entityId, diff });
    return result;
  });
}

export async function deleteRow(db: Db, sub: string, studyId: string, def: SheetDef, id: string): Promise<boolean> {
  if (def.idCol !== "id") return false;
  const c = cols(def.table);
  return withRls(db, { sub }, async (tx) => {
    const gone = (await tx.delete(def.table).where(and(eq(c.studyId, studyId), eq(c.id, id))).returning({ id: c.id } as never)) as unknown[];
    if (gone.length === 1) await tx.insert(auditLog).values({ studyId, actorId: sub, origin: "app", action: "delete", entity: def.entity, entityId: id, diff: null });
    return gone.length === 1;
  });
}
