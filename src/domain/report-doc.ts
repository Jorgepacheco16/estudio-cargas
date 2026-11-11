/**
 * Documento del informe de resultados (D-107, parte D): reúne, sin calcular nada nuevo, lo que van a llevar el PDF, el Word y el PowerPoint: el texto de la versión APROBADA con las cifras
 * que cita, las cifras clave y los datos de las gráficas y tablas (los del tablero, calculados por la aplicación). Los tres formatos leen este mismo modelo, así que dicen lo mismo y
 * lo que se prueba aquí vale para los tres. Los archivos salen siempre con el nombre y el logo del CLIENTE (src/lib/client-theme.ts).
 */
import { LEVEL_ES, SCENARIO_ES, type ReportFacts } from "./report";
import { STATE_ES } from "./staffing";
import type { Catalog, ReportSection } from "./report-text";

const nf = (n: number, d = 0) => n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));
const pct = (n: number | null, d = 0) => (n === null ? "—" : `${nf(n * 100, d)} %`);
export const dateEs = (d: Date) => d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });

export interface DocVersion { number: number; status: "draft" | "approved" | "superseded"; approvedAt: Date | null; inputHash: string; sections: ReportSection[]; catalog: Catalog }
export interface DocInput { clientName: string; studyName: string; version: DocVersion; facts: ReportFacts; currentHash: string; now: Date }

export interface DocKpi { label: string; value: string; note: string }
export interface DocSection { id: string; title: string; paragraphs: string[]; cited: { label: string; display: string }[] }
export interface DocDetailRow { position: string; place: string; hay: string; exact: string; required: string; gap: string; use: string; state: string }
export interface ReportDoc {
  clientName: string; studyName: string; title: string; versionLabel: string; approvedOn: string; context: string; generatedOn: string;
  /** El texto se redactó con datos distintos a los de hoy: las cifras de gráficas y tablas son las de hoy. */ staleNote: string | null;
  kpis: DocKpi[]; sections: DocSection[]; facts: ReportFacts;
  areaRows: { area: string; hay: number; required: number; gap: string }[];
  detail: DocDetailRow[]; quality: string[]; fileBase: string;
}

/** La descarga solo existe para una versión aprobada: lo que llega al gerente es siempre lo oficial. */
export function downloadable(v: { status: string } | null | undefined): v is { status: "approved" } { return !!v && v.status === "approved"; }

export function buildReportDoc(i: DocInput): ReportDoc {
  const { facts, version } = i;
  if (version.status !== "approved" || !version.approvedAt) throw new Error("Solo se descarga una versión aprobada.");
  const sections: DocSection[] = version.sections
    .filter((s) => (s.status === "verified" || s.status === "edited") && s.paragraphs.length > 0)
    .map((s) => ({ id: s.id, title: s.title, paragraphs: s.paragraphs, cited: (version.catalog[s.id] ?? []).filter((c) => s.cites.includes(c.id)).map((c) => ({ label: c.label, display: c.display })) }));
  const w = facts.weeks;
  const kpis: DocKpi[] = [
    { label: "Personas que hay", value: nf(facts.totals.occupants), note: `En los ${facts.data.positionsWithFigure} cargos con cifra` },
    { label: "Personas necesarias", value: nf(facts.totals.required), note: `Con el umbral de sobrecarga en ${nf(facts.overload * 100)} %${facts.unplannedHours > 0 ? ` · incluye ${nf(facts.unplannedHours)} h por semana de actividades no planificadas (imprevistos)` : ""}` },
    { label: "Brecha", value: signed(facts.totals.gap), note: facts.totals.gap > 0 ? "Faltan personas" : facts.totals.gap < 0 ? "Hay personas de más según la carga registrada" : "Coinciden las que hay y las necesarias" },
    { label: "Uso con periódicas", value: w.periodic ? pct(w.periodic.utilization) : "—", note: w.periodic ? (w.periodic.extraPeople > 0 ? `Hace falta refuerzo de ${nf(w.periodic.extraPeople)} ${w.periodic.extraPeople === 1 ? "persona" : "personas"}` : "Sin refuerzo") : "Sin semana con periódicas" },
    { label: "Datos completos", value: pct(facts.data.completePct), note: `${nf(facts.data.complete)} de ${nf(facts.data.activities)} actividades` },
  ];
  const d = facts.data, plural = (n: number, one: string, many: string) => `${nf(n)} ${n === 1 ? one : many}`;
  const quality = [
    `${plural(d.incomplete, "actividad con datos incompletos", "actividades con datos incompletos")}: no suman horas.`,
    `${plural(d.positionsWithoutFigure, "cargo sin cifra", "cargos sin cifra")}: les falta cantidad, jornada o actividades completas.`,
    `${plural(d.positionsPartial, "cargo con cifra mínima", "cargos con cifra mínima")}: tienen actividades incompletas.`,
    `${plural(d.positionsWithoutShifts, "cargo sin turnos", "cargos sin turnos")}: no se pueden repartir por día.`,
  ];
  const stale = version.inputHash !== i.currentHash;
  return {
    clientName: i.clientName, studyName: i.studyName, title: "Informe de resultados", versionLabel: `Versión ${version.number}`, approvedOn: dateEs(version.approvedAt),
    context: `Escenario ${SCENARIO_ES[facts.scenario] ?? facts.scenario} · reserva de capacidad ${nf(facts.reservePct * 100)} % · umbral de sobrecarga ${nf(facts.overload * 100)} %`,
    generatedOn: dateEs(i.now),
    staleNote: stale ? `Los datos del estudio cambiaron después de redactar y aprobar este texto (${dateEs(version.approvedAt)}). Las cifras clave, gráficas y tablas de este documento son las de ${dateEs(i.now)}; el texto describe las de la versión aprobada.` : null,
    kpis, sections, facts,
    areaRows: facts.areas.map((a) => ({ area: a.area, hay: a.occupants, required: a.required, gap: signed(a.gap) })),
    detail: facts.positions.map((p) => ({
      position: p.position, place: `${p.area} · ${p.site}`, hay: nf(p.occupants), exact: nf(p.exact, 2), required: nf(p.required), gap: signed(p.gap), use: pct(p.usePct),
      state: `${LEVEL_ES[p.level]} · ${STATE_ES[p.state]}${p.partial ? " · cifra mínima" : ""}`,
    })),
    quality,
    fileBase: `informe-de-resultados_v${version.number}_${i.now.toISOString().slice(0, 10)}`,
  };
}

/** Parte un texto largo en trozos de a lo más `max` letras, cortando por párrafos y, si hace falta, por frases (para las diapositivas). */
export function chunkParagraphs(paragraphs: readonly string[], max: number): string[][] {
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= max) { pieces.push(p); continue; }
    let cur = "";
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if (cur && cur.length + s.length + 1 > max) { pieces.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) pieces.push(cur);
  }
  const out: string[][] = []; let group: string[] = [], size = 0;
  for (const p of pieces) { if (group.length && size + p.length > max) { out.push(group); group = []; size = 0; } group.push(p); size += p.length; }
  if (group.length) out.push(group);
  return out;
}
