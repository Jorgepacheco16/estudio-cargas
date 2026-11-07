import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { analyze } from "../src/domain/summary";
import { buildSchedules, positionKey, type ActivityExtra } from "../src/domain/schedule";
import { buildReportFacts } from "../src/domain/report";
import { buildReportDoc, chunkParagraphs, downloadable, type DocVersion } from "../src/domain/report-doc";
import type { ReportSection } from "../src/domain/report-text";
import type { ActivityInput, Params, StaffingInput } from "../src/domain/engine";
import { CLIENT } from "../src/lib/client-theme";
import { loadClientLogo } from "../src/server/report-files/assets";
import { reportPdf } from "../src/server/report-files/pdf";
import { reportDocx } from "../src/server/report-files/docx";
import { reportPptx } from "../src/server/report-files/pptx";
import { check, summary } from "./helpers";

/**
 * Descargas del informe (D-107): el modelo del documento y los tres archivos (PDF, Word, PowerPoint) con el logo y los colores del cliente. Se abren los archivos de verdad: el PDF con pdf-lib y
 * Word y PowerPoint como lo que son, un zip con XML, para comprobar que el texto, las cifras, el logo y las gráficas están dentro.
 */
const TH = { high: 1.05, low: 0.5 };
const prm = (): Params => ({ workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct: 0.1, scenario: "base" });
const staff = (area: string, position: string, headcount: number, weeklyHours: number): StaffingInput => ({ dataKind: "real", area, site: "CO1", position, headcount, weeklyHours });
const act = (code: string, area: string, position: string, hours: number, o: Partial<ActivityInput> = {}): ActivityInput => ({
  code, dataKind: "real", area, site: "CO1", position, employeeCode: null, calcMode: "per_event", scope: "position_total", executions: 1, period: "week", unitsPerExecution: null,
  timeAvgMin: hours * 60, timeMinMin: null, timeMaxMin: null, seasonHigh: null, seasonLow: null, simultaneous: null, loadShare: null, secondaryPosition: null, planning: "planned",
  waitMin: null, waitOccupies: null, travelMin: null, reworkPct: null, reworkMin: null, ...o,
});
function facts() {
  const st = [staff("Cajas", "Cajero", 9, 40), staff("Cajas", "Fiscal", 3, 40), staff("Domicilios", "Auxiliar", 8, 40)];
  const ac = [act("C1", "Cajas", "Cajero", 2.4, { executions: 150 }), act("C2", "Cajas", "Cajero", 6, { period: "month" }), act("F1", "Cajas", "Fiscal", 1.4, { executions: 75 }), act("D1", "Domicilios", "Auxiliar", 1, { executions: 6, period: "day" })];
  const p = prm(), a = analyze(st, ac, p, TH, "all");
  const extras = new Map<string, ActivityExtra>(ac.map((x) => [x.code.toLowerCase(), { name: x.code, type: "operational" }]));
  const shiftDays = new Map<string, number[]>(["Cajero", "Fiscal"].map((pos) => [positionKey("real", "Cajas", "CO1", pos), [0, 1, 2, 3, 4, 5]]));
  const schedules = buildSchedules({ staff: st, acts: ac, params: p, positions: a.positions, extras, shiftDays, overload: TH.high });
  return buildReportFacts({ positions: a.positions, schedules, kpis: a.kpis, overload: TH.high, reservePct: p.reservePct, scenario: p.scenario });
}
const sec = (id: ReportSection["id"], title: string, status: ReportSection["status"], paragraphs: string[], cites: string[] = []): ReportSection => ({ id, title, status, source: "agent", paragraphs, cites, hash: "h" });
const version = (o: Partial<DocVersion> = {}): DocVersion => ({
  number: 2, status: "approved", approvedAt: new Date("2026-11-06T15:00:00Z"), inputHash: "H1",
  sections: [
    sec("resumen", "Resumen ejecutivo", "verified", ["Hay 20 personas y se necesitan 18, con acentos: ñ, á, é, í, ó, ú y símbolos como ≥ y «comillas».", "Segundo párrafo del resumen."], ["totals.occupants"]),
    sec("alcance", "Alcance y método", "edited", ["Texto editado por una persona."]),
    sec("hallazgos", "Hallazgos del diagnóstico", "nodata", []),
    sec("recomendaciones", "Recomendaciones", "review", ["No debe salir: requiere revisión."]),
  ],
  catalog: { resumen: [{ id: "totals.occupants", label: "Personas que hay", value: 20, display: "20" }], alcance: [], dotacion: [], distribucion: [], hallazgos: [], recomendaciones: [], calidad: [] },
  ...o,
});
const input = (v = version()) => ({ clientName: CLIENT.name, studyName: "Estudio de prueba", version: v, facts: facts(), currentHash: "H1", now: new Date("2026-11-07T12:00:00Z") });
const zip = (b: Uint8Array | Buffer) => JSZip.loadAsync(b);
const names = (z: JSZip) => Object.keys(z.files);
const text = async (z: JSZip, re: RegExp) => (await Promise.all(names(z).filter((n) => re.test(n)).map((n) => z.files[n].async("string")))).join("\n");

async function main() {
  const logo = await loadClientLogo();
  await check("El logo y los colores son los del cliente: el PNG es válido y los colores de los documentos son los --red y --blue de la aplicación", () => {
    if (logo.width < 50 || logo.height < 20) throw new Error(`logo ${logo.width}×${logo.height}`);
    const css = readFileSync("src/app/globals.css", "utf8");
    const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
    const get = (k: string) => new RegExp(`--${k}:\\s*#([0-9a-fA-F]{6})`).exec(root)?.[1]?.toUpperCase();
    if (get("red") !== CLIENT.colors.primary || get("blue") !== CLIENT.colors.secondary) throw new Error(`css ${get("red")}/${get("blue")} ≠ ${CLIENT.colors.primary}/${CLIENT.colors.secondary}`);
  });

  await check("Solo se descarga una versión aprobada: el borrador y la reemplazada se rechazan", () => {
    for (const status of ["draft", "superseded"] as const) { let msg = ""; try { buildReportDoc(input(version({ status }))); } catch (e) { msg = (e as Error).message; } if (!/aprobada/.test(msg)) throw new Error(`${status}: ${msg}`); }
    if (!downloadable({ status: "approved" }) || downloadable({ status: "draft" }) || downloadable(null)) throw new Error("downloadable");
    let sinFecha = ""; try { buildReportDoc(input(version({ approvedAt: null }))); } catch (e) { sinFecha = (e as Error).message; } if (!sinFecha) throw new Error("una aprobada sin fecha no sale");
  });

  await check("El documento lleva el texto verificado o editado con las cifras que cita, y deja fuera lo que no tiene datos o requiere revisión", () => {
    const d = buildReportDoc(input());
    if (d.sections.map((s) => s.id).join() !== "resumen,alcance") throw new Error(d.sections.map((s) => s.id).join());
    if (d.sections[0].cited.map((c) => `${c.label}=${c.display}`).join() !== "Personas que hay=20") throw new Error("cifras citadas");
    if (d.kpis.length !== 5 || d.versionLabel !== "Versión 2" || !/6 de noviembre de 2026/.test(d.approvedOn)) throw new Error(`${d.kpis.length} ${d.versionLabel} ${d.approvedOn}`);
    if (d.fileBase !== "informe-de-resultados_v2_2026-11-07") throw new Error(d.fileBase);
    if (d.staleNote !== null) throw new Error("no hay cambios de datos");
    if (d.quality.length !== 4 || d.detail.length !== 3) throw new Error("calidad/detalle");
  });

  await check("Si los datos cambiaron desde la aprobación, el documento lo dice (las cifras de gráficas y tablas son las de hoy)", () => {
    const d = buildReportDoc({ ...input(), currentHash: "H2" });
    if (!d.staleNote || !/cambiaron/.test(d.staleNote) || !/7 de noviembre de 2026/.test(d.staleNote)) throw new Error(String(d.staleNote));
  });

  await check("chunkParagraphs: reparte el texto en diapositivas sin perder nada ni pasarse del límite", () => {
    const largo = Array.from({ length: 30 }, (_, i) => `Frase número ${i + 1} del párrafo largo.`).join(" ");
    const grupos = chunkParagraphs(["Corto.", largo, "Otro corto."], 300);
    const todo = grupos.flat().join(" ");
    for (const t of ["Corto.", "Frase número 1 ", "Frase número 30 ", "Otro corto."]) if (!todo.includes(t)) throw new Error("falta " + t);
    if (grupos.length < 3) throw new Error("debía partirse: " + grupos.length);
    for (const g of grupos) if (g.join("").length > 300) throw new Error("grupo largo " + g.join("").length);
    if (chunkParagraphs([], 300).length !== 0) throw new Error("vacío");
  });

  await check("PDF: se abre, tiene portada y páginas de contenido, título con el estudio y la versión, y no falla con caracteres fuera de WinAnsi (≥)", async () => {
    const bytes = await reportPdf(buildReportDoc(input()), logo);
    if (Buffer.from(bytes.slice(0, 5)).toString() !== "%PDF-") throw new Error("no es PDF");
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() < 3) throw new Error("páginas " + pdf.getPageCount());
    if (!/Estudio de prueba/.test(pdf.getTitle() ?? "") || !/Versión 2/.test(pdf.getTitle() ?? "") || pdf.getAuthor() !== CLIENT.name) throw new Error(`${pdf.getTitle()} / ${pdf.getAuthor()}`);
    if (bytes.length < 20_000) throw new Error("PDF sospechosamente pequeño: ¿falta el logo? " + bytes.length);
  });

  await check("PDF con muchos cargos y texto largo: se parte en varias páginas sin lanzar errores", async () => {
    const d = buildReportDoc(input(version({ sections: [sec("resumen", "Resumen ejecutivo", "verified", Array.from({ length: 40 }, (_, i) => `Párrafo ${i + 1}: ` + "texto de relleno con varias palabras para ocupar espacio. ".repeat(6)))] })));
    const base = d.detail[0];
    d.detail.push(...Array.from({ length: 80 }, (_, i) => ({ ...base, position: `Cargo ${i}` })));
    const pdf = await PDFDocument.load(await reportPdf(d, logo));
    if (pdf.getPageCount() < 8) throw new Error("páginas " + pdf.getPageCount());
  });

  await check("Word: es un docx válido con el texto, las cifras citadas, el logo, el detalle y la calidad; lo que no tiene datos o requiere revisión no sale", async () => {
    const z = await zip(await reportDocx(buildReportDoc(input()), logo));
    if (!names(z).includes("word/document.xml") || !names(z).includes("[Content_Types].xml")) throw new Error(names(z).join());
    const xml = await text(z, /^word\/(document|header\d*|footer\d*)\.xml$/);
    for (const t of ["Informe de resultados", "Estudio de prueba", "Versión 2", "6 de noviembre de 2026", "Megatiendas", "Resumen ejecutivo", "Hay 20 personas", "Segundo párrafo del resumen.", "Texto editado por una persona.", "Personas que hay: 20", "Detalle por cargo", "Calidad de los datos", "Cajero", "Auxiliar"]) if (!xml.includes(t)) throw new Error("falta «" + t + "»");
    for (const t of ["No debe salir", "Hallazgos del diagnóstico", "Recomendaciones"]) if (xml.includes(t)) throw new Error("no debía salir «" + t + "»");
    if (names(z).filter((n) => /^word\/media\/.*\.png$/.test(n)).length < 1) throw new Error("falta el logo");
    if (!/PAGE/.test(xml)) throw new Error("falta el número de página");
  });

  await check("PowerPoint: es un pptx válido con portada y logo, tres gráficas NATIVAS, el texto aprobado en diapositivas y el detalle; lo que requiere revisión no sale", async () => {
    const z = await zip(await reportPptx(buildReportDoc(input()), logo));
    const slides = names(z).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    if (slides.length < 8) throw new Error("diapositivas " + slides.length);
    const charts = names(z).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    if (charts.length !== 3) throw new Error("gráficas " + charts.length);
    if (!names(z).some((n) => /^ppt\/media\/.*\.png$/.test(n))) throw new Error("falta el logo");
    const xml = await text(z, /^ppt\/slides\/slide\d+\.xml$/);
    for (const t of ["Informe de resultados", "Estudio de prueba", "Versión 2", "Megatiendas", "Cifras clave", "1. Resumen ejecutivo", "Hay 20 personas", "Texto editado por una persona.", "Personas que hay: 20", "Detalle por cargo", "Calidad de los datos"]) if (!xml.includes(t)) throw new Error("falta «" + t + "»");
    if (xml.includes("No debe salir")) throw new Error("no debía salir lo que requiere revisión");
    const chartXml = await text(z, /^ppt\/charts\/chart\d+\.xml$/);
    for (const t of ["Hay hoy", "Necesarias", "Horas de trabajo"]) if (!chartXml.includes(t)) throw new Error("gráfica sin «" + t + "»");
  });

  await check("Estudio sin semana con periódicas ni áreas: los tres formatos se generan igual (sin gráficas vacías)", async () => {
    const d = buildReportDoc(input());
    d.facts.areas.length = 0; d.areaRows.length = 0; d.facts.positions.length = 0; d.detail.length = 0; d.facts.weeks.common = null; d.facts.weeks.periodic = null;
    const [pdf, docx, pptx] = await Promise.all([reportPdf(d, logo), reportDocx(d, logo), reportPptx(d, logo)]);
    if ((await PDFDocument.load(pdf)).getPageCount() < 2 || names(await zip(docx)).length < 5) throw new Error("pdf/docx");
    const z = await zip(pptx);
    if (names(z).some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))) throw new Error("no debía haber gráficas");
  });
  summary();
}
main().catch((e) => { console.error(e); process.exit(1); });
