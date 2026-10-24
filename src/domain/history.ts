/**
 * Historia, productividad real y desviaciones (brief §15.3 a §15.5, F10 [PROPUESTA]). Funciones puras sobre las fotos del tablero y las mediciones.
 * Los umbrales son parámetros del estudio; sus valores iniciales son PROVISIONALES hasta que el responsable los decida con datos reales (D-20).
 */
import type { Analysis, AlertLevel } from "./summary";
import type { Dashboard } from "./dashboard";

/* ───────── Fotos del tablero ───────── */
export interface SnapPosition { key: string; area: string; site: string; position: string; kind: string; occupants: number; capacity: number; hours: number; pct: number | null; level: AlertLevel; activities: number; complete: number }
export interface SnapActivity { id: string; code: string; hours: number | null; complete: boolean; source: string | null; confidence: string | null; hasEvidence: boolean }
export interface SnapMetrics {
  version: 1;
  indicators: Dashboard["indicators"];
  areas: { area: string; hours: number; capacity: number; pct: number | null; activities: number; complete: number }[];
  positions: SnapPosition[];
  activities: SnapActivity[];
  overduePlans: string[];
  thresholds: { high: number; low: number };
}

export interface ActivityAttrs { id: string; code: string; source: string | null; confidence: string | null; hasEvidence: boolean }
const posKey = (p: { dataKind: string; area: string; site: string; position: string }) => [p.dataKind, p.area, p.site, p.position].join("|").toLowerCase();

/** Foto de los indicadores en este instante (no reemplaza el recálculo, que siempre es posible desde los datos). */
export function buildSnapshot(a: Analysis, d: Dashboard, th: { high: number; low: number }, attrs: ActivityAttrs[], overduePlans: string[]): SnapMetrics {
  const byCode = new Map(attrs.map((x) => [x.code.trim().toLowerCase(), x]));
  return {
    version: 1, indicators: d.indicators, thresholds: th, overduePlans: [...overduePlans].sort(),
    areas: a.areas.map((r) => ({ area: r.area, hours: r.hours, capacity: r.capacity, pct: r.pct, activities: r.activities, complete: r.complete })),
    positions: a.positions.map((p) => ({ key: posKey(p), area: p.area, site: p.site, position: p.position, kind: p.dataKind, occupants: p.occupants, capacity: p.capacity, hours: p.hours, pct: p.pct, level: p.level, activities: p.activities, complete: p.complete })),
    activities: a.activities.map((x) => {
      const at = byCode.get(x.code.trim().toLowerCase());
      return { id: at?.id ?? x.code, code: x.code, hours: x.hoursWeek, complete: x.complete, source: at?.source ?? null, confidence: at?.confidence ?? null, hasEvidence: at?.hasEvidence ?? false };
    }),
  };
}

export interface SnapshotDiff {
  indicators: { key: string; from: number | string | null; to: number | string | null; delta: number | null }[];
  areas: { area: string; hoursFrom: number; hoursTo: number; pctFrom: number | null; pctTo: number | null }[];
  crossings: { position: string; area: string; site: string; from: AlertLevel | null; to: AlertLevel | null }[];
  incomplete: { from: number; to: number };
}

/** Qué cambió entre dos fotos: indicadores, carga por área, cargos que cambiaron de nivel y actividades incompletas. */
export function diffSnapshots(a: SnapMetrics, b: SnapMetrics): SnapshotDiff {
  const ka = a.indicators as unknown as Record<string, number | string | null>, kb = b.indicators as unknown as Record<string, number | string | null>;
  const indicators = Object.keys(kb).map((key) => ({ key, from: ka[key] ?? null, to: kb[key], delta: typeof ka[key] === "number" && typeof kb[key] === "number" ? (kb[key] as number) - (ka[key] as number) : null }));
  const areaA = new Map(a.areas.map((r) => [r.area, r]));
  const areas = b.areas.map((r) => ({ area: r.area, hoursFrom: areaA.get(r.area)?.hours ?? 0, hoursTo: r.hours, pctFrom: areaA.get(r.area)?.pct ?? null, pctTo: r.pct })).filter((r) => r.hoursFrom !== r.hoursTo || r.pctFrom !== r.pctTo);
  const posA = new Map(a.positions.map((p) => [p.key, p]));
  const crossings = b.positions.flatMap((p) => { const before = posA.get(p.key)?.level ?? null; return before !== p.level ? [{ position: p.position, area: p.area, site: p.site, from: before, to: p.level }] : []; });
  const inc = (m: SnapMetrics) => m.activities.filter((x) => !x.complete).length;
  return { indicators, areas, crossings, incomplete: { from: inc(a), to: inc(b) } };
}

/* ───────── Productividad real ───────── */
export interface ActivityStd { calcMode: "per_event" | "per_unit" | null; timeAvgMin: number | null }
export interface Measure { unitsProcessed: number | null; personHours: number }

/** Estándar por hora: 60 ÷ tiempo promedio (eventos por hora si es por evento; unidades por hora si es por unidad). */
export function standardPerHour(a: ActivityStd): number | null {
  return a.calcMode && a.timeAvgMin !== null && a.timeAvgMin > 0 ? 60 / a.timeAvgMin : null;
}

export type ProductivityStatus = "sin_estandar" | "sin_mediciones" | "insuficientes" | "ok";
export interface Productivity { status: ProductivityStatus; n: number; realPerHour: number | null; standardPerHour: number | null; index: number | null; message: string }

/**
 * Productividad real = unidades (o eventos) ÷ horas-persona medidas. Índice = real ÷ estándar. Sin mediciones, o con menos del mínimo,
 * NO hay número: se dice qué falta. Un índice bajo no concluye ineficiencia (puede ser un tiempo estimado optimista o esperas no registradas).
 */
export function productivity(a: ActivityStd, ms: Measure[], minN: number): Productivity {
  const std = standardPerHour(a);
  if (std === null) return { status: "sin_estandar", n: 0, realPerHour: null, standardPerHour: null, index: null, message: "La actividad no tiene modalidad y tiempo promedio: falta el estándar" };
  const usable = ms.filter((m) => m.unitsProcessed !== null && m.unitsProcessed >= 0 && m.personHours > 0);
  if (ms.length === 0) return { status: "sin_mediciones", n: 0, realPerHour: null, standardPerHour: std, index: null, message: "Sin mediciones" };
  if (usable.length < minN) return { status: "insuficientes", n: usable.length, realPerHour: null, standardPerHour: std, index: null, message: `Faltan mediciones: hay ${usable.length} con unidades y se requieren ${minN}` };
  const units = usable.reduce((s, m) => s + (m.unitsProcessed ?? 0), 0), hours = usable.reduce((s, m) => s + m.personHours, 0);
  const real = units / hours;
  return { status: "ok", n: usable.length, realPerHour: real, standardPerHour: std, index: real / std, message: "Un índice bajo no concluye ineficiencia: revise si el tiempo estimado era optimista o hubo esperas no registradas" };
}

/* ───────── Desviaciones ───────── */
export interface DevParams { estimatePct: number; minMeasurements: number; jumpPct: number; minHistory: number }
export const DISPERSION_PCT = 0.3;         // regla del comparador de sedes del Excel (hoja 2b, celda F25): (máx − mín) ÷ promedio de horas por ocupante
export const RECURRING_CONFLICTS = 3;      // veces que una misma fila debe entrar en conflicto para considerarse recurrente
export interface Candidate { ruleCode: string; entity: string; entityId: string | null; key: string; baseline: Record<string, unknown>; observed: Record<string, unknown>; message: string }

export interface DevInput {
  params: DevParams;
  snapshots: SnapMetrics[];                       // de la más antigua a la más reciente
  activities: { id: string; code: string; calcMode: "per_event" | "per_unit" | null; timeAvgMin: number | null }[];
  measurements: { activityId: string; unitsProcessed: number | null; personHours: number }[];
  syncEvents: { sheet: string; rows: number[]; at: string }[];     // solo los eventos con conflicto
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length === 0 ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const CONF = { low: 1, medium: 2, high: 3 } as const;
const VERIFIABLE = new Set(["observed", "timed", "verifiable_source"]);
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function detectDeviations(i: DevInput): Candidate[] {
  const out: Candidate[] = [];
  const snaps = i.snapshots, cur = snaps.at(-1), prev = snaps.at(-2);

  /* R1 · Estimado vs medido (con al menos n mediciones) */
  for (const a of i.activities) {
    if (a.timeAvgMin === null || a.timeAvgMin <= 0 || !a.calcMode) continue;
    const ms = i.measurements.filter((m) => m.activityId === a.id && m.unitsProcessed !== null && m.unitsProcessed > 0 && m.personHours > 0);
    if (ms.length < i.params.minMeasurements) continue;
    const measuredMin = (ms.reduce((s, m) => s + m.personHours, 0) * 60) / ms.reduce((s, m) => s + (m.unitsProcessed ?? 0), 0);
    const gap = measuredMin / a.timeAvgMin - 1;
    if (Math.abs(gap) > i.params.estimatePct) out.push({ ruleCode: "R1", entity: "activities", entityId: a.id, key: `R1:${a.id}`, baseline: { estimatedMin: a.timeAvgMin }, observed: { measuredMin: r4(measuredMin), n: ms.length, gapPct: r4(gap * 100) }, message: `${a.code}: el tiempo medido difiere ${Math.round(Math.abs(gap) * 100)} % del estimado` });
  }

  if (cur && prev) {
    /* R2 · Cruce de umbral entre dos fotos */
    const before = new Map(prev.positions.map((p) => [p.key, p]));
    for (const p of cur.positions) {
      const b = before.get(p.key);
      if (p.level === "overload" && b && b.level !== "overload") out.push({ ruleCode: "R2", entity: "positions", entityId: null, key: `R2:${p.key}`, baseline: { level: b.level, pct: b.pct }, observed: { level: p.level, pct: p.pct }, message: `${p.position} (${p.area}) pasó a superar la capacidad` });
    }
    /* R4 · Pérdida de calidad: baja la confianza o la fuente pasa de verificable a declarada */
    const prevAct = new Map(prev.activities.map((a) => [a.id, a]));
    for (const a of cur.activities) {
      const b = prevAct.get(a.id);
      if (!b) continue;
      const lowered = a.confidence && b.confidence && (CONF as Record<string, number>)[a.confidence] < (CONF as Record<string, number>)[b.confidence];
      const downgraded = b.source && a.source && VERIFIABLE.has(b.source) && !VERIFIABLE.has(a.source);
      if (lowered || downgraded) out.push({ ruleCode: "R4", entity: "activities", entityId: a.id, key: `R4:${a.id}`, baseline: { confidence: b.confidence, source: b.source }, observed: { confidence: a.confidence, source: a.source }, message: `${a.code}: bajó la calidad del dato` });
    }
    /* R7 · Aumento de actividades incompletas */
    const inc = (m: SnapMetrics) => m.activities.filter((x) => !x.complete).length;
    if (inc(cur) > inc(prev)) out.push({ ruleCode: "R7", entity: "study", entityId: null, key: "R7:study", baseline: { incompletas: inc(prev) }, observed: { incompletas: inc(cur) }, message: "Aumentó el número de actividades con datos faltantes" });
    /* R6 · Plan vencido reincidente (vencido en las dos últimas fotos) */
    for (const code of cur.overduePlans) if (prev.overduePlans.includes(code)) out.push({ ruleCode: "R6", entity: "action_items", entityId: null, key: `R6:${code}`, baseline: { vencidaEnFotoAnterior: true }, observed: { codigo: code, vencida: true }, message: `La acción ${code} sigue con plazo vencido` });
  }

  /* R3 · Salto de horas sin respaldo, contra la mediana de las fotos previas (solo con el mínimo de historia) */
  if (cur && snaps.length - 1 >= i.params.minHistory) {
    const history = snaps.slice(-1 - 5, -1);
    const prevOne = snaps.at(-2)!;
    const prevAct = new Map(prevOne.activities.map((a) => [a.id, a]));
    for (const a of cur.activities) {
      const b = prevAct.get(a.id);
      if (!b || a.hours === null || a.hours <= 0) continue;
      const same = a.source === b.source && a.confidence === b.confidence && a.hasEvidence === b.hasEvidence;
      const base = median(history.flatMap((s) => s.activities.filter((x) => x.id === a.id && x.hours !== null).map((x) => x.hours as number)));
      if (!same || base === null || base <= 0) continue;
      const jump = a.hours / base - 1;
      if (Math.abs(jump) > i.params.jumpPct) out.push({ ruleCode: "R3", entity: "activities", entityId: a.id, key: `R3:${a.id}`, baseline: { medianHours: r4(base), fotos: history.length }, observed: { hours: r4(a.hours), jumpPct: r4(jump * 100) }, message: `${a.code}: las horas cambiaron ${Math.round(Math.abs(jump) * 100)} % sin cambio de fuente, confianza ni evidencia` });
    }
  }

  /* R5 · Dispersión entre sedes (> 30 % de horas por ocupante); se alerta si aparece o crece respecto a la foto anterior */
  if (cur) {
    const spreadOf = (m: SnapMetrics) => {
      const g = new Map<string, number[]>();
      for (const p of m.positions) if (p.occupants > 0 && p.hours > 0) g.set(`${p.kind}|${p.area}|${p.position}`.toLowerCase(), [...(g.get(`${p.kind}|${p.area}|${p.position}`.toLowerCase()) ?? []), p.hours / p.occupants]);
      return new Map([...g].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, (Math.max(...v) - Math.min(...v)) / (v.reduce((a, b) => a + b, 0) / v.length)])); // como la hoja 2b: (máx − mín) ÷ promedio
    };
    const now = spreadOf(cur), before = prev ? spreadOf(prev) : new Map<string, number>();
    for (const [k, s] of now) if (s > DISPERSION_PCT && (!before.has(k) || s > (before.get(k) ?? 0))) {
      const [, area, position] = k.split("|");
      out.push({ ruleCode: "R5", entity: "positions", entityId: null, key: `R5:${k}`, baseline: { dispersionPct: before.has(k) ? r4((before.get(k) ?? 0) * 100) : null }, observed: { dispersionPct: r4(s * 100) }, message: `${position} (${area}): las horas por ocupante difieren ${Math.round(s * 100)} % entre sedes` });
    }
  }

  /* R8 · Conflictos de sincronización recurrentes en la misma fila */
  const seen = new Map<string, number>();
  for (const e of i.syncEvents) for (const r of e.rows) seen.set(`${e.sheet}!${r}`, (seen.get(`${e.sheet}!${r}`) ?? 0) + 1);
  for (const [k, n] of seen) if (n >= RECURRING_CONFLICTS) out.push({ ruleCode: "R8", entity: "sync_events", entityId: null, key: `R8:${k}`, baseline: { minimo: RECURRING_CONFLICTS }, observed: { fila: k, conflictos: n }, message: `La fila ${k} genera conflictos de sincronización repetidos` });

  return out;
}

/* ───────── Explicación redactada por el modelo: sin cifras nuevas ───────── */
const NUM = /\d+(?:[.,]\d+)?/g;
export const numbersIn = (s: string) => (s.match(NUM) ?? []).map((x) => Number(x.replace(/,/g, ".")));
const flatNumbers = (v: unknown): number[] => (typeof v === "number" ? [v] : typeof v === "string" ? numbersIn(v) : v && typeof v === "object" ? Object.values(v).flatMap(flatNumbers) : []);

/**
 * La explicación debe citar identificadores de cambio ENTREGADOS (#123), no introducir cifras que no estén en el registro de la
 * desviación y no estar vacía. Devuelve el motivo del rechazo, o null si es aceptable.
 */
export function validateExplanation(e: { text: string; cited: number[] }, allowedChangeIds: number[], record: { baseline: unknown; observed: unknown }, requireCitation: boolean): string | null {
  const text = e.text.trim();
  if (text.length < 20 || text.length > 900) return "longitud fuera de 20–900 caracteres";
  if (e.cited.some((id) => !allowedChangeIds.includes(id))) return "cita un identificador de cambio que no se entregó";
  if (requireCitation && allowedChangeIds.length > 0 && e.cited.length === 0) return "no cita ningún identificador de cambio";
  const allowed = new Set([...flatNumbers(record.baseline), ...flatNumbers(record.observed), ...e.cited, ...allowedChangeIds]);
  const extra = numbersIn(text).filter((n) => ![...allowed].some((a) => Math.abs(a - n) < 1e-6 || Math.abs(Math.round(a) - n) < 1e-6));
  return extra.length ? `introduce cifras que no están en el registro: ${[...new Set(extra)].slice(0, 3).join(", ")}` : null;
}
