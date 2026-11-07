/**
 * Informe de resultados en PowerPoint (D-107): diapositivas 16:9 con el logo y los colores del cliente. Las tres gráficas son NATIVAS (se pueden editar en PowerPoint); el texto aprobado va
 * en diapositivas de texto (las secciones largas se parten en varias) con las cifras que cita al pie.
 */
import PptxGenJS from "pptxgenjs";
import type { ReportDoc } from "@/domain/report-doc";
import { chunkParagraphs } from "@/domain/report-doc";
import { COLOR, logoHeight, type Logo } from "./assets";

const FONT = "Calibri", SERIES_A = "5F8DC0", MUTED = "555E73";
const nf = (n: number, d = 0) => n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const LEVEL_COLOR = { overload: COLOR.primary, low: "B7791F", ok: COLOR.secondary, nodata: "9AA0B2" } as const;
const ROWS_PER_SLIDE = 9, CHARS_PER_SLIDE = 900;

export async function reportPptx(doc: ReportDoc, logo: Logo): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13,33 × 7,5 pulgadas
  pptx.author = doc.clientName; pptx.company = doc.clientName; pptx.title = `${doc.title} · ${doc.studyName} · ${doc.versionLabel}`;
  const logoData = `image/png;base64,${logo.bytes.toString("base64")}`;
  let n = 0;

  const slide = (title: string) => {
    const s = pptx.addSlide(); n++;
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: COLOR.primary }, line: { color: COLOR.primary } });
    s.addText(title, { x: 0.6, y: 0.35, w: 10, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: COLOR.secondary, valign: "middle" });
    s.addImage({ data: logoData, x: 13.33 - 0.6 - 1.4, y: 0.4, w: 1.4, h: logoHeight(logo, 1.4) });
    s.addText(`${doc.clientName} · ${doc.title} · ${doc.versionLabel}`, { x: 0.6, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED });
    s.addText(String(n), { x: 12.1, y: 7.05, w: 0.63, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED, align: "right" });
    return s;
  };
  const note = (s: PptxGenJS.Slide, text: string, y = 6.55) => s.addText(text, { x: 0.6, y, w: 12.1, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED, valign: "top" });

  /* ── Portada ── */
  { const s = pptx.addSlide(); n++;
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.25, fill: { color: COLOR.primary }, line: { color: COLOR.primary } });
    s.addImage({ data: logoData, x: 0.8, y: 0.9, w: 3.2, h: logoHeight(logo, 3.2) });
    s.addText(doc.title, { x: 0.8, y: 2.6, w: 11.5, h: 1.1, fontFace: FONT, fontSize: 48, bold: true, color: COLOR.secondary, valign: "middle" });
    s.addShape("rect", { x: 0.8, y: 3.75, w: 1.3, h: 0.07, fill: { color: COLOR.primary }, line: { color: COLOR.primary } });
    s.addText(doc.studyName, { x: 0.8, y: 4.0, w: 11.5, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: COLOR.ink });
    s.addText([{ text: `${doc.versionLabel} · aprobada el ${doc.approvedOn}`, options: { breakLine: true } }, { text: doc.context, options: { breakLine: true } }, { text: `Preparado para ${doc.clientName}` }],
      { x: 0.8, y: 4.7, w: 11.5, h: 1.3, fontFace: FONT, fontSize: 16, color: MUTED, valign: "top", paraSpaceAfter: 4 });
    s.addText(`BalanceAPP · ${doc.generatedOn}`, { x: 0.8, y: 6.9, w: 8, h: 0.3, fontFace: FONT, fontSize: 11, color: MUTED });
  }

  /* ── Cifras clave ── */
  { const s = slide("Cifras clave");
    const w = 3.8, h = 2.0;
    doc.kpis.forEach((k, i) => {
      const x = 0.6 + (i % 3) * (w + 0.35), y = 1.4 + Math.floor(i / 3) * (h + 0.3);
      s.addShape("rect", { x, y, w, h, fill: { color: "F5F8FF" }, line: { color: "DDE1EC", width: 1 } });
      s.addText(k.label, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.4, fontFace: FONT, fontSize: 14, color: MUTED });
      s.addText(k.value, { x: x + 0.2, y: y + 0.55, w: w - 0.4, h: 0.85, fontFace: FONT, fontSize: 40, bold: true, color: COLOR.secondary, valign: "middle" });
      s.addText(k.note, { x: x + 0.2, y: y + 1.4, w: w - 0.4, h: 0.5, fontFace: FONT, fontSize: 12, color: MUTED, valign: "top" });
    });
    if (doc.staleNote) s.addText(doc.staleNote, { x: 0.6, y: 5.9, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 12, color: COLOR.ink, fill: { color: "FFF3D9" }, line: { color: "B7791F", width: 1 }, margin: 8, valign: "middle" });
  }

  /* ── Gráficas nativas ── */
  const { facts } = doc;
  const axis = { catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, dataLabelFontFace: FONT, dataLabelFontSize: 12, valGridLine: { color: "DDE1EC", size: 0.5 } } as const;
  if (facts.areas.length) {
    const s = slide("Personas que hay y necesarias, por área");
    s.addChart(pptx.ChartType.bar, [
      { name: "Hay hoy", labels: facts.areas.map((a) => a.area), values: facts.areas.map((a) => a.occupants) },
      { name: "Necesarias", labels: facts.areas.map((a) => a.area), values: facts.areas.map((a) => a.required) },
    ], { x: 0.6, y: 1.25, w: 12.1, h: 5.2, barDir: "col", barGrouping: "clustered", chartColors: [SERIES_A, COLOR.secondary], showLegend: true, legendPos: "b", legendFontFace: FONT, legendFontSize: 13, showValue: true, ...axis });
    note(s, `Brecha total: ${doc.kpis[2].value} (${doc.kpis[2].note.toLowerCase()}).`);
  }
  const used = facts.positions.filter((p) => p.usePct !== null).slice(0, 10), usedUp = [...used].reverse(); // las barras horizontales se dibujan de abajo hacia arriba
  if (used.length) {
    const s = slide("Uso de la capacidad actual, por cargo");
    s.addChart(pptx.ChartType.bar, [{ name: "Uso actual (%)", labels: usedUp.map((p) => `${p.position} (${p.area})`), values: usedUp.map((p) => Math.round((p.usePct as number) * 100)) }],
      { x: 0.6, y: 1.25, w: 12.1, h: 5.2, barDir: "bar", chartColors: usedUp.map((p) => LEVEL_COLOR[p.level]), showLegend: false, showValue: true, dataLabelFormatCode: '0" %"', valAxisLabelFormatCode: '0" %"', ...axis });
    note(s, `Carga necesaria ÷ capacidad de las personas que hay hoy. Pasar del umbral de sobrecarga (${nf(facts.overload * 100)} %) es sobrecarga${facts.positions.length > 10 ? "; se muestran los 10 cargos con más uso" : ""}.`);
  }
  if (facts.weeks.common || facts.weeks.periodic) {
    const s = slide("Trabajo de la semana común y con periódicas");
    const ws = [["Semana común", facts.weeks.common], ["Con periódicas", facts.weeks.periodic]] as const, present = ws.filter(([, w]) => w) as unknown as [string, NonNullable<typeof facts.weeks.common>][];
    s.addChart(pptx.ChartType.bar, [
      { name: "Horas de trabajo", labels: present.map(([l]) => l), values: present.map(([, w]) => Math.round(w.workHours)) },
      { name: "Capacidad de las personas necesarias", labels: present.map(([l]) => l), values: present.map(([, w]) => Math.round(w.capacityHours)) },
    ], { x: 0.6, y: 1.25, w: 12.1, h: 5.2, barDir: "col", barGrouping: "clustered", chartColors: [SERIES_A, COLOR.secondary], showLegend: true, legendPos: "b", legendFontFace: FONT, legendFontSize: 13, showValue: true, ...axis });
    note(s, `Horas por semana. ${facts.weeks.common ? `En la semana común quedan ${nf(facts.weeks.common.freeHours)} h de disponibilidad sin tareas.` : ""}`);
  }

  /* ── Texto aprobado ── */
  doc.sections.forEach((sec, i) => {
    const parts = chunkParagraphs(sec.paragraphs, CHARS_PER_SLIDE);
    parts.forEach((group, k) => {
      const s = slide(`${i + 1}. ${sec.title}${parts.length > 1 ? ` (${k + 1}/${parts.length})` : ""}`);
      s.addText(group.map((t) => ({ text: t, options: { breakLine: true, paraSpaceAfter: 12 } })), { x: 0.6, y: 1.3, w: 12.1, h: 4.9, fontFace: FONT, fontSize: 18, color: COLOR.ink, valign: "top" });
      if (k === parts.length - 1 && sec.cited.length) note(s, `Cifras citadas: ${sec.cited.map((c) => `${c.label}: ${c.display}`).join(" · ")}`, 6.3);
    });
  });

  /* ── Detalle y calidad ── */
  const head = ["Cargo", "Área · centro", "Hay", "Necesarias", "Brecha", "Uso", "Estado"].map((t, i) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: COLOR.secondary }, align: (i >= 2 && i <= 5 ? "right" : "left") as "left" | "right" } }));
  const pages = Math.max(1, Math.ceil(doc.detail.length / ROWS_PER_SLIDE));
  for (let pgi = 0; pgi < pages; pgi++) {
    const s = slide(`Detalle por cargo${pages > 1 ? ` (${pgi + 1}/${pages})` : ""}`);
    const rows = doc.detail.slice(pgi * ROWS_PER_SLIDE, (pgi + 1) * ROWS_PER_SLIDE).map((r) => [r.position, r.place, r.hay, r.required, r.gap, r.use, r.state].map((t, i) => ({ text: t, options: { bold: i === 0 || i === 3 || i === 4, align: (i >= 2 && i <= 5 ? "right" : "left") as "left" | "right" } })));
    if (rows.length === 0) note(s, "Sin cargos con cifra.", 1.4);
    else s.addTable([head, ...rows], { x: 0.6, y: 1.3, w: 12.1, colW: [2.6, 2.6, 0.8, 1.3, 1.0, 0.9, 2.9], fontFace: FONT, fontSize: 12, color: COLOR.ink, border: { type: "solid", color: "DDE1EC", pt: 0.5 }, rowH: 0.45, valign: "middle" });
  }
  { const s = slide("Calidad de los datos");
    s.addText(doc.quality.map((q) => ({ text: q, options: { bullet: true, breakLine: true, paraSpaceAfter: 12 } })), { x: 0.8, y: 1.4, w: 11.7, h: 4.5, fontFace: FONT, fontSize: 20, color: COLOR.ink, valign: "top" });
    note(s, "Lo que conviene completar para que las cifras sean más firmes. Las cifras nunca se rellenan por su cuenta.", 6.3);
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
