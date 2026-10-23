/** Hoja 11 del Excel: tablero ejecutivo y conclusiones preliminares. Función pura sobre los resultados de 4a/4b y de las hojas 5–10. */
import { norm, type Params } from "./engine";
import { labelOf } from "./calculators";
import { readPosition, type Analysis, type Mode, type Thresholds } from "./summary";

export interface ActivityMeta { code: string; name: string; source: string | null; confidence: string | null; valueClass: string | null; activityType: string | null; autoPotential: string | null; stdPotential: string | null; simplPotential: string | null }
export interface DashInput {
  mode: Mode; analysis: Analysis; params: Params; thresholds: Thresholds; areaNames: string[]; assumptionsValidated: boolean; hourlyCost: number | null;
  meta: ActivityMeta[];
  meas: { kind: string; level: string }[];
  suit: { kind: string; situation: string | null }[];
  risks: { kind: string; criticality: string; backup: string }[];
  opps: { kind: string; findingClass: string | null; hours: number | null; annualImpact: number | string | null }[];
  plans: { kind: string; alert: string }[];
}

export interface AreaLine { area: string; activities: number; complete: number; hours: number | null; capacity: number | null; pct: number | null; reading: string }
export interface Share { label: string; hours: number; pct: number | null }
export interface TopLine { name: string; code: string; area: string; position: string; site: string; hours: number; pct: number | null }
export interface Dashboard {
  modeBanner: string; assumptionsBanner: string;
  indicators: { areasWithInfo: string; activities: number; completePct: number | null; hours: number; capacity: number; capacityPct: number | null; overload: number; lowLoad: number; verifiablePct: number | null; opportunities: number; recoverableHours: number; criticalNoBackup: number };
  areas: AreaLine[]; byValue: Share[]; byType: Share[]; byPotential: Share[]; top10: TopLine[];
  coverage: { label: string; value: string; note: string }[];
  opportunities: { label: string; value: string }[];
  conclusions: string[];
}

const nf = (n: number, d = 1) => n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct0 = (n: number) => `${Math.round(n * 100)}%`;
const VALUE_LABELS = ["direct_value", "necessary_no_direct_value", "dispensable"] as const;
const TYPE_ORDER = ["operational", "administrative", "control", "coordination", "service", "support", "occasional"] as const;
const VERIFIABLE = new Set(["observed", "timed", "verifiable_source"]);

export function buildDashboard(i: DashInput): Dashboard {
  const keep = (k: string) => i.mode === "all" || k === i.mode;
  const a = i.analysis, th = i.thresholds;
  const metaByCode = new Map(i.meta.map((m) => [norm(m.code), m]));
  const acts = a.activities;
  const D8 = acts.length, H8 = a.kpis.hours, J8 = a.kpis.capacity;
  const completePct = D8 === 0 ? null : acts.filter((x) => x.complete).length / D8;
  const verifiablePct = D8 === 0 ? null : acts.filter((x) => VERIFIABLE.has(metaByCode.get(norm(x.code))?.source ?? "")).length / D8;
  const meas = i.meas.filter((x) => keep(x.kind)), suit = i.suit.filter((x) => keep(x.kind)), risks = i.risks.filter((x) => keep(x.kind));
  const opps = i.opps.filter((x) => keep(x.kind)), plans = i.plans.filter((x) => keep(x.kind));
  const criticalNoBackup = risks.filter((r) => r.backup === "Requiere respaldo prioritario").length;
  const areasWithInfo = a.areas.filter((r) => r.activities > 0).length;

  const indicators = {
    areasWithInfo: `${areasWithInfo} de ${i.areaNames.length}`, activities: D8, completePct, hours: H8, capacity: J8, capacityPct: J8 > 0 ? H8 / J8 : null,
    overload: a.positions.filter((p) => p.pct !== null && p.pct > th.high).length, lowLoad: a.positions.filter((p) => p.pct !== null && p.pct < th.low).length,
    verifiablePct, opportunities: opps.length, recoverableHours: opps.reduce((s, o) => s + (o.hours ?? 0), 0), criticalNoBackup,
  };

  /* A. Carga por área: una línea por cada área del estudio, con la misma lectura de la hoja 4b */
  const byArea = new Map(a.areas.map((r) => [norm(r.area), r]));
  const areas: AreaLine[] = i.areaNames.map((name) => {
    const r = byArea.get(norm(name));
    const agg = { activities: r?.activities ?? 0, complete: r?.complete ?? 0, hours: r?.hours ?? 0, capacity: r?.capacity ?? 0, pct: r?.pct ?? null };
    return { area: name, activities: agg.activities, complete: agg.complete, hours: r ? agg.hours : null, capacity: r ? agg.capacity : null, pct: agg.pct, reading: readPosition(agg, th).reading };
  });

  /* B. Distribución de las horas inventariadas (solo actividades completas) */
  const share = (label: string, hours: number): Share => ({ label, hours, pct: H8 > 0 ? hours / H8 : null });
  const hoursBy = (pick: (m: ActivityMeta) => string | null) => {
    const out = new Map<string, number>();
    for (const x of acts) { if (!x.complete) continue; const m = metaByCode.get(norm(x.code)); const k = m ? pick(m) : null; if (k) out.set(k, (out.get(k) ?? 0) + x.result.hTotal!); }
    return out;
  };
  const byV = hoursBy((m) => m.valueClass);
  const valueShares = VALUE_LABELS.map((c) => share(labelOf("L_Valor", c)!, byV.get(c) ?? 0));
  const byValue = [...valueShares, share("Sin clasificar", H8 - valueShares.reduce((s, x) => s + x.hours, 0))];
  const byT = hoursBy((m) => m.activityType);
  const byType = TYPE_ORDER.map((c) => share(labelOf("L_TipoAct", c)!, byT.get(c) ?? 0));
  const high = (pick: (m: ActivityMeta) => string | null) => { let h = 0; for (const x of acts) { if (!x.complete) continue; const m = metaByCode.get(norm(x.code)); if (m && pick(m) === "high") h += x.result.hTotal!; } return h; };
  const automationHigh = high((m) => m.autoPotential);
  const byPotential = [share("Automatización", automationHigh), share("Estandarización", high((m) => m.stdPotential)), share("Simplificación", high((m) => m.simplPotential))];

  /* C. Las 10 actividades que más horas consumen (desempate: la fila posterior primero, como LARGE del libro) */
  const top10: TopLine[] = acts.map((x, idx) => ({ x, idx })).filter(({ x }) => x.complete && (x.hoursWeek ?? 0) > 0)
    .sort((p, q) => (q.x.hoursWeek! + q.idx * 1e-9) - (p.x.hoursWeek! + p.idx * 1e-9)).slice(0, 10)
    .map(({ x }) => ({ name: metaByCode.get(norm(x.code))?.name ?? "", code: x.code, area: x.area, position: x.position, site: x.site, hours: x.hoursWeek!, pct: H8 > 0 ? x.hoursWeek! / H8 : null }));

  /* D. Cobertura y calidad */
  const conf = (c: string) => acts.filter((x) => metaByCode.get(norm(x.code))?.confidence === c).length;
  const sit = (s: string) => suit.filter((x) => x.situation === s).length;
  const lowMeas = meas.filter((m) => m.level === "Baja").length;
  const crit = risks.filter((r) => r.criticality === "Crítica" || r.criticality === "Alta").length;
  const incomplete = D8 - acts.filter((x) => x.complete).length;
  const coverage = [
    { label: "Actividades con datos completos", value: completePct === null ? "—" : pct0(completePct), note: D8 === 0 ? "Sin actividades registradas." : incomplete === 0 ? "Todas las actividades tienen los datos mínimos." : `${incomplete} actividad(es) incompletas: vea el estado de captura de cada actividad.` },
    { label: "Confianza ALTA en la estimación", value: String(conf("high")), note: "Meta del estudio: respaldar con datos de confianza alta las actividades de mayor peso." },
    { label: "Confianza MEDIA", value: String(conf("medium")), note: "" },
    { label: "Confianza BAJA", value: String(conf("low")), note: conf("low") > 0 ? "Priorice medir u observar estas actividades antes de sacar conclusiones." : "" },
    { label: "Actividades con fuente verificable", value: verifiablePct === null ? "—" : pct0(verifiablePct), note: "" },
    { label: "Medibilidad evaluada (hoja 5)", value: String(meas.length), note: D8 === 0 ? "" : meas.length < D8 ? `Faltan ${D8 - meas.length} actividades por evaluar.` : "Todas evaluadas." },
    { label: "…con baja medibilidad", value: String(lowMeas), note: lowMeas > 0 ? "Defina criterios cualitativos verificables; no fuerce métricas numéricas." : "" },
    { label: "Pertinencia evaluada (hoja 6)", value: String(suit.length), note: "" },
    { label: "…situación 1 (capacitar) / 2 (no corresponde) / 3 (especialización) / 4 (simplificar o automatizar)", value: `${sit("s1_train")} / ${sit("s2_not_in_purpose")} / ${sit("s3_specialization")} / ${sit("s4_simplify_automate")}`, note: "" },
    { label: "Riesgos evaluados (hoja 7)", value: String(risks.length), note: "" },
    { label: "…criticidad crítica o alta", value: String(crit), note: "" },
    { label: "…requieren respaldo prioritario", value: String(criticalNoBackup), note: criticalNoBackup > 0 ? "Concentración del conocimiento en actividades críticas: evalúe respaldo antes de cualquier rediseño." : "" },
  ];

  /* E. Oportunidades y plan */
  const cls = (c: string) => opps.filter((o) => o.findingClass === c).length;
  const confirmedHours = opps.filter((o) => o.findingClass === "confirmed").reduce((s, o) => s + (o.hours ?? 0), 0);
  const money = i.hourlyCost === null ? "Defina costo/hora" : `$ ${nf(opps.reduce((s, o) => s + (typeof o.annualImpact === "number" ? o.annualImpact : 0), 0), 0)}`;
  const opportunities = [
    { label: "Hallazgo confirmado", value: String(cls("confirmed")) }, { label: "Hipótesis", value: String(cls("hypothesis")) }, { label: "Recomendación pendiente de validación", value: String(cls("pending_recommendation")) },
    { label: "Tiempo recuperable (h/sem) — solo confirmado", value: nf(confirmedHours) }, { label: "Impacto económico anual estimado (COP)", value: money },
    { label: "Acciones con plazo vencido", value: String(plans.filter((p) => p.alert.startsWith("Plazo vencido")).length) },
  ];

  /* F. Conclusiones preliminares (mismos textos que las fórmulas del libro) */
  const totalAreas = i.areaNames.length;
  const conclusions: string[] = [];
  if (D8 === 0) conclusions.push("Sin datos registrados en el modo seleccionado: aún no es posible generar conclusiones.");
  else {
    conclusions.push(`COBERTURA: ${D8} actividades registradas en ${areasWithInfo} de ${totalAreas} áreas. ${areasWithInfo < totalAreas ? "El análisis es PRELIMINAR: faltan áreas por levantar." : "Todas las áreas tienen información; valide su calidad antes de concluir."}`);
    conclusions.push(indicators.overload === 0 ? "CARGA: ningún cargo supera la capacidad disponible con los datos actuales." : `CARGA: ${indicators.overload} cargo(s) superan la capacidad disponible. Antes de concluir sobrecarga, revise datos, solapamientos, horas extraordinarias y distribución de actividades.`);
    conclusions.push(indicators.lowLoad === 0 ? "CARGA BAJA: ningún cargo presenta carga inventariada inferior al umbral definido." : `CARGA BAJA: ${indicators.lowLoad} cargo(s) con carga inventariada inferior al ${pct0(th.low)} de su capacidad. Valide que el inventario esté completo; no es evidencia de personal sobrante.`);
    conclusions.push(completePct === 1 ? "CALIDAD DE DATOS: todas las actividades tienen los datos mínimos para el cálculo." : `CALIDAD DE DATOS: ${D8 - Math.round((completePct ?? 0) * D8)} actividad(es) con datos incompletos; no se incluyen en las cargas hasta completarlas.`);
    if (H8 !== 0) conclusions.push(automationHigh === 0 ? "AUTOMATIZACIÓN: no hay actividades con potencial alto registradas." : `AUTOMATIZACIÓN: el ${pct0(automationHigh / H8)} de las horas inventariadas (${nf(automationHigh)} h/sem) corresponde a actividades con potencial ALTO de automatización. Es un potencial por validar, no un ahorro.`);
    conclusions.push(risks.length === 0 ? "RIESGOS: aún no hay actividades con riesgo evaluado (hoja 7)." : criticalNoBackup > 0 ? `RIESGOS: ${criticalNoBackup} actividad(es) crítica(s) o de impacto alto dependen de una sola persona: evalúe respaldo antes de redistribuir o automatizar.` : "RIESGOS: no se identifican actividades críticas con dependencia de una sola persona entre las evaluadas.");
    conclusions.push(opps.length === 0 ? "OPORTUNIDADES: aún no hay oportunidades registradas (hoja 8)." : `OPORTUNIDADES: ${opps.length} registradas (${cls("confirmed")} hallazgos confirmados, ${cls("hypothesis")} hipótesis, ${cls("pending_recommendation")} pendientes de validación). Tiempo recuperable estimado: ${nf(indicators.recoverableHours)} h/sem (${nf(confirmedHours)} h/sem confirmado). Las hipótesis no deben presentarse como hallazgos.`);
    if (lowMeas > 0) conclusions.push(`MEDIBILIDAD: ${lowMeas} actividad(es) con baja medibilidad: defina criterios cualitativos verificables en lugar de forzar métricas.`);
    if (!i.assumptionsValidated) conclusions.push("SUPUESTOS: los supuestos de capacidad (reserva, días laborales) no han sido validados; los porcentajes de capacidad son referenciales.");
    if (i.mode !== "real") conclusions.push(`MODO: se están mostrando datos ${i.mode === "demo" ? "DEMO" : "TODOS"} (ficticios o mezclados con datos reales). Cambie el modo a REAL para ver solo la información del estudio.`);
  }

  return {
    modeBanner: i.mode === "real" ? "Mostrando solo datos REALES del estudio." : i.mode === "demo" ? "ATENCIÓN: se muestran datos DEMO (ficticios). No son resultados del estudio. Cambie a REAL para ver su información." : "ATENCIÓN: se muestran datos REAL y DEMO juntos. Cambie a REAL para ver solo la información del estudio.",
    assumptionsBanner: i.assumptionsValidated ? "Supuestos de capacidad validados (hoja Parametros)." : "Supuestos de capacidad SIN validar (hoja Parametros): los porcentajes de capacidad son referenciales.",
    indicators, areas, byValue, byType, byPotential, top10, coverage, opportunities, conclusions,
  };
}
