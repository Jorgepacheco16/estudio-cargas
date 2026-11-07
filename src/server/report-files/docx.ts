/**
 * Informe de resultados en Word (D-107): portada con el logo del cliente, cifras clave, el texto aprobado con las cifras que cita y, en lugar de gráficas (Word solo admite imágenes), las
 * mismas cifras en tablas; luego el detalle por cargo y la calidad de los datos. Encabezado con el logo y pie con el número de página.
 */
import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { ReportDoc } from "@/domain/report-doc";
import { LEVEL_ES } from "@/domain/report";
import { COLOR, logoHeight, type Logo } from "./assets";

const FONT = "Calibri";
const nf = (n: number, d = 0) => n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const border = { style: BorderStyle.SINGLE, size: 4, color: "DDE1EC" };
const borders = { top: border, bottom: border, left: border, right: border };

export async function reportDocx(doc: ReportDoc, logo: Logo): Promise<Buffer> {
  const logoRun = (w: number) => new ImageRun({ type: "png", data: logo.bytes, transformation: { width: w, height: logoHeight(logo, w) }, altText: { title: doc.clientName, description: `Logo de ${doc.clientName}`, name: "logo" } });
  const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, bold: o.bold, size: o.size, color: o.color ?? COLOR.ink });
  const p = (text: string, o: { bold?: boolean; size?: number; color?: string; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new Paragraph({ children: [run(text, o)], spacing: { after: o.after ?? 120 }, alignment: o.align });
  const h1 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(text, { bold: true, size: 30, color: COLOR.secondary })], spacing: { before: 320, after: 140 }, keepNext: true });
  const cell = (text: string, o: { head?: boolean; right?: boolean; width?: number; bold?: boolean } = {}) => new TableCell({
    borders, width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    shading: o.head ? { type: ShadingType.CLEAR, fill: COLOR.secondary, color: "auto" } : undefined,
    children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [run(text, { bold: o.head || o.bold, size: 19, color: o.head ? "FFFFFF" : COLOR.ink })] })],
  });
  const table = (head: { t: string; w: number; right?: boolean }[], rows: { t: string; bold?: boolean }[][]) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: head.map((h) => cell(h.t, { head: true, right: h.right, width: h.w })) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c.t, { right: head[i].right, bold: c.bold, width: head[i].w })) }))],
  });

  const cover = [
    new Paragraph({ children: [logoRun(240)], spacing: { before: 600, after: 1400 } }),
    new Paragraph({ children: [run(doc.title, { bold: true, size: 72, color: COLOR.secondary })], spacing: { after: 160 } }),
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 24, color: COLOR.primary, space: 1 } }, children: [], spacing: { after: 240 }, indent: { right: 7200 } }),
    p(doc.studyName, { bold: true, size: 34, after: 200 }),
    p(`${doc.versionLabel} · aprobada el ${doc.approvedOn}`, { size: 24, color: "555E73", after: 80 }),
    p(doc.context, { size: 22, color: "555E73", after: 80 }),
    p(`Preparado para ${doc.clientName}`, { size: 22, color: "555E73", after: 80 }),
    p(`BalanceAPP · ${doc.generatedOn}`, { size: 18, color: "555E73" }),
  ];

  const kpiTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: doc.kpis.map((k) => cell(k.label, { head: true, width: 20 })) }),
      new TableRow({ children: doc.kpis.map((k) => new TableCell({ borders, margins: { top: 80, bottom: 40, left: 80, right: 80 }, children: [new Paragraph({ children: [run(k.value, { bold: true, size: 40, color: COLOR.secondary })] })] })) }),
      new TableRow({ children: doc.kpis.map((k) => new TableCell({ borders, margins: { top: 20, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [run(k.note, { size: 16, color: "555E73" })] })] })) }),
    ],
  });

  const body: (Paragraph | Table)[] = [h1("Cifras clave"), kpiTable];
  if (doc.staleNote) body.push(new Paragraph({ spacing: { before: 160, after: 120 }, shading: { type: ShadingType.CLEAR, fill: "FFF3D9", color: "auto" }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "B7791F", space: 6 } }, children: [run(doc.staleNote, { size: 19 })] }));
  doc.sections.forEach((s, i) => {
    body.push(h1(`${i + 1}. ${s.title}`));
    for (const t of s.paragraphs) body.push(p(t, { size: 22, after: 140 }));
    if (s.cited.length) body.push(p(`Cifras citadas: ${s.cited.map((c) => `${c.label}: ${c.display}`).join(" · ")}`, { size: 17, color: "555E73" }));
  });

  const { facts } = doc;
  body.push(h1("Cifras por área, cargo y semana"));
  if (doc.areaRows.length) {
    body.push(p("Personas que hay y necesarias, por área", { bold: true, after: 80 }));
    body.push(table([{ t: "Área", w: 46 }, { t: "Hay", w: 18, right: true }, { t: "Necesarias", w: 18, right: true }, { t: "Brecha", w: 18, right: true }], doc.areaRows.map((a) => [{ t: a.area }, { t: nf(a.hay) }, { t: nf(a.required) }, { t: a.gap, bold: true }])));
  }
  const used = facts.positions.filter((x) => x.usePct !== null).slice(0, 10);
  if (used.length) {
    body.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    body.push(p(`Uso de la capacidad actual, por cargo (umbral de sobrecarga ${nf(facts.overload * 100)} %${facts.positions.length > 10 ? "; los 10 con más uso" : ""})`, { bold: true, after: 80 }));
    body.push(table([{ t: "Cargo", w: 50 }, { t: "Uso actual", w: 20, right: true }, { t: "Nivel", w: 30 }], used.map((x) => [{ t: `${x.position} (${x.area})` }, { t: `${nf((x.usePct as number) * 100)} %`, bold: true }, { t: LEVEL_ES[x.level] }])));
  }
  const weeks = [["Semana común", facts.weeks.common], ["Con periódicas", facts.weeks.periodic]] as const;
  if (weeks.some(([, w]) => w)) {
    body.push(new Paragraph({ children: [], spacing: { after: 60 } }));
    body.push(p("Trabajo de la semana común y con periódicas", { bold: true, after: 80 }));
    body.push(table([{ t: "Semana", w: 28 }, { t: "Horas de trabajo", w: 24, right: true }, { t: "Capacidad (h)", w: 24, right: true }, { t: "Uso", w: 24, right: true }],
      weeks.flatMap(([label, w]) => (w ? [[{ t: label }, { t: nf(w.workHours) }, { t: nf(w.capacityHours) }, { t: `${nf(w.utilization * 100)} %`, bold: true }]] : []))));
    if (facts.weeks.common) body.push(p(`En la semana común quedan ${nf(facts.weeks.common.freeHours)} h de disponibilidad sin tareas.`, { size: 18, color: "555E73" }));
  }

  body.push(h1("Detalle por cargo"));
  body.push(doc.detail.length === 0 ? p("Sin cargos con cifra.") : table(
    [{ t: "Cargo", w: 15 }, { t: "Área · centro", w: 15 }, { t: "Hay", w: 6, right: true }, { t: "Exactas", w: 8, right: true }, { t: "Necesarias", w: 10, right: true }, { t: "Brecha", w: 8, right: true }, { t: "Uso", w: 8, right: true }, { t: "Estado", w: 30 }],
    doc.detail.map((r) => [{ t: r.position, bold: true }, { t: r.place }, { t: r.hay }, { t: r.exact }, { t: r.required, bold: true }, { t: r.gap, bold: true }, { t: r.use }, { t: r.state }]),
  ));
  body.push(h1("Calidad de los datos"));
  for (const q of doc.quality) body.push(new Paragraph({ bullet: { level: 0 }, children: [run(q, { size: 22 })], spacing: { after: 80 } }));

  const d = new Document({
    creator: doc.clientName, title: `${doc.title} · ${doc.studyName} · ${doc.versionLabel}`, description: `${doc.title} de ${doc.clientName}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      { properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } }, children: cover },
      {
        properties: { page: { margin: { top: 1300, bottom: 1100, left: 1200, right: 1200 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [logoRun(90)] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${doc.clientName} · ${doc.title} · ${doc.versionLabel} · página `, { size: 16, color: "555E73" }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "555E73" })] })] }) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(d);
}
