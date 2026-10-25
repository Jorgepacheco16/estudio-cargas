/**
 * Exportación a Excel y PDF del resultado de la validación de cobertura de funciones. A diferencia de las tablas del tablero, aquí el texto largo
 * (funciones y observaciones) se ENVUELVE en varias líneas: nunca se recorta con «...», porque lo importante es leer la función completa.
 */
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { z } from "zod";
import { STATUS_ES, type CoverageResult } from "../domain/coverage";

export const NOTICE = "Resultado generado por IA como apoyo; verifícalo antes de decidir.";
const LEVEL_ES = { alert: "Alerta: hay funciones sin cobertura", warning: "Advertencia: hay funciones cubiertas solo en parte", ok: "Todas las funciones están cubiertas" } as const;
const ICON = { none: "✖", partial: "⚠", covered: "✔" } as const;
const PDF_ICON = { none: "[X]", partial: "[!]", covered: "[OK]" } as const; // la fuente estándar del PDF no tiene estos símbolos

/** Lo que el navegador devuelve para exportar: se vuelve a validar (tamaños y forma) antes de generar el archivo. */
export const coveragePayload = z.object({
  cargo: z.string().max(400),
  result: z.object({
    functions: z.array(z.object({ n: z.number().int(), text: z.string().max(1500), status: z.enum(["covered", "partial", "none"]), activities: z.array(z.object({ code: z.string().max(80), name: z.string().max(400) })).max(200), note: z.string().max(1500) })).max(400),
    unrelated: z.array(z.object({ code: z.string().max(80), name: z.string().max(400) })).max(500),
    counts: z.object({ total: z.number(), covered: z.number(), partial: z.number(), none: z.number() }),
    summary: z.string().max(300),
    level: z.enum(["alert", "warning", "ok"]),
  }),
});
export type CoveragePayload = z.infer<typeof coveragePayload>;

export async function coverageXlsx(cargo: string, r: CoverageResult, stamp: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio de Cargas"; wb.title = "Cobertura de funciones del cargo"; wb.created = new Date();
  const ws = wb.addWorksheet("Cobertura de funciones");
  ws.columns = [{ key: "n", width: 6 }, { key: "fn", width: 62 }, { key: "st", width: 24 }, { key: "ac", width: 44 }, { key: "ob", width: 58 }];
  const line = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => { const row = ws.addRow([text]); ws.mergeCells(row.number, 1, row.number, 5); row.font = { bold: o.bold, size: o.size ?? 11, color: o.color ? { argb: o.color } : undefined }; row.alignment = { wrapText: true, vertical: "top" }; return row; };
  line("Cobertura de funciones del cargo", { bold: true, size: 16, color: "FF003C73" });
  line(`Cargo: ${cargo}`, { bold: true });
  line(`Fecha: ${stamp}`);
  line(r.summary, { bold: true });
  line(LEVEL_ES[r.level], { bold: true, color: r.level === "alert" ? "FFB80015" : r.level === "warning" ? "FF8A5300" : "FF0C6A33" });
  line(NOTICE, { color: "FF5A626C" });
  ws.addRow([]);
  const head = ws.addRow(["N.º", "Función", "Estado", "Actividades que la cubren", "Observación"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } }; head.alignment = { vertical: "middle", wrapText: true }; head.height = 24;
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00529B" } }; });
  const fill = { none: "FFFDE6E9", partial: "FFFDEFD2", covered: "FFE0F6E9" } as const;
  for (const f of r.functions) {
    const row = ws.addRow([f.n, f.text, `${ICON[f.status]} ${STATUS_ES[f.status]}`, f.activities.length ? f.activities.map((a) => `${a.code} · ${a.name}`).join("\n") : "Ninguna", f.note || "—"]);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill[f.status] } }; row.getCell(3).font = { bold: true };
  }
  const head2Row = ws.rowCount + 2;
  ws.getRow(head2Row).values = ["Actividades no relacionadas con ninguna función (informativo, no es una alerta)"]; ws.getRow(head2Row).font = { bold: true };
  ws.mergeCells(head2Row, 1, head2Row, 5);
  if (r.unrelated.length === 0) ws.getRow(head2Row + 1).values = ["", "Todas las actividades se relacionaron con alguna función."];
  r.unrelated.forEach((a, i) => { ws.getRow(head2Row + 1 + i).values = ["", `${a.code} · ${a.name}`]; });
  ws.views = [{ state: "frozen", ySplit: 8 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Parte un texto en líneas que caben en `max` puntos, cortando por palabras (y por caracteres solo si una palabra sola no cabe). */
export function wrapText(text: string, max: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (measure(next) <= max) { cur = next; continue; }
      if (cur) out.push(cur);
      let w = word;
      while (measure(w) > max && w.length > 1) { let k = w.length - 1; while (k > 1 && measure(w.slice(0, k)) > max) k--; out.push(w.slice(0, k)); w = w.slice(k); }
      cur = w;
    }
    out.push(cur);
  }
  return out;
}

export async function coveragePdf(cargo: string, r: CoverageResult, stamp: string): Promise<Uint8Array> {
  const W = 842, H = 595, M = 32, LH = 10.5, SIZE = 8;
  const BLUE = rgb(0, 0.322, 0.608), DARK = rgb(0, 0.235, 0.451), RED = rgb(0.929, 0, 0.106), INK = rgb(0.145, 0.169, 0.2), MUTED = rgb(0.353, 0.384, 0.424), LINE = rgb(0.88, 0.9, 0.92);
  const doc = await PDFDocument.create();
  doc.setTitle("Cobertura de funciones del cargo"); doc.setCreator("Estudio de Cargas");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ok = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/[\t]+/g, " ")).map((ch) => (ch === "\n" || ok.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  const wrap = (s: string, f: PDFFont, size: number, max: number) => wrapText(clean(s), max, (t) => f.widthOfTextAtSize(t, size));
  const cols = [{ h: "N.º", w: 0.05 }, { h: "Función", w: 0.34 }, { h: "Estado", w: 0.15 }, { h: "Actividades que la cubren", w: 0.2 }, { h: "Observación", w: 0.26 }];
  const total = W - 2 * M, xs: number[] = []; let acc = M; for (const c of cols) { xs.push(acc); acc += c.w * total; }
  const widths = cols.map((c) => c.w * total - 8);

  let page = doc.addPage([W, H]), y = H - M;
  const top = () => {
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: RED });
    page.drawText("Cobertura de funciones del cargo", { x: M, y: H - M - 6, size: 16, font: bold, color: DARK });
    y = H - M - 24;
  };
  top();
  for (const l of wrap(`Cargo: ${cargo}`, bold, 10, total)) { page.drawText(l, { x: M, y, size: 10, font: bold, color: INK }); y -= 13; }
  page.drawText(clean(`${r.summary}   ·   ${stamp}`), { x: M, y, size: 9.5, font, color: INK }); y -= 14;
  const lc = r.level === "alert" ? rgb(0.72, 0, 0.082) : r.level === "warning" ? rgb(0.54, 0.325, 0) : rgb(0.047, 0.416, 0.2);
  page.drawText(clean(LEVEL_ES[r.level]), { x: M, y, size: 10, font: bold, color: lc }); y -= 14;
  page.drawText(clean(NOTICE), { x: M, y, size: 8, font, color: MUTED }); y -= 18;

  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 5, width: total, height: 16, color: BLUE });
    cols.forEach((c, i) => page.drawText(clean(c.h), { x: xs[i] + 4, y, size: 8, font: bold, color: rgb(1, 1, 1) }));
    y -= 18;
  };
  tableHead();
  for (const f of r.functions) {
    const cells = [String(f.n), f.text, `${PDF_ICON[f.status]} ${STATUS_ES[f.status]}`, f.activities.length ? f.activities.map((a) => `${a.code} - ${a.name}`).join("\n") : "Ninguna", f.note || "-"];
    const lines = cells.map((c, i) => wrap(c, i === 2 ? bold : font, SIZE, widths[i]));
    const h = Math.max(...lines.map((l) => l.length)) * LH + 8;
    if (y - h < M + 24) { page = doc.addPage([W, H]); top(); tableHead(); }
    lines.forEach((ls, i) => ls.forEach((l, k) => page.drawText(l, { x: xs[i] + 4, y: y - k * LH, size: SIZE, font: i === 2 ? bold : font, color: i === 2 ? (f.status === "none" ? rgb(0.72, 0, 0.082) : f.status === "partial" ? rgb(0.54, 0.325, 0) : rgb(0.047, 0.416, 0.2)) : INK })));
    page.drawLine({ start: { x: M, y: y - h + LH }, end: { x: M + total, y: y - h + LH }, thickness: 0.4, color: LINE });
    y -= h;
  }
  y -= 8;
  if (y < M + 50) { page = doc.addPage([W, H]); top(); }
  page.drawText("Actividades no relacionadas con ninguna función (informativo, no es una alerta)", { x: M, y, size: 9.5, font: bold, color: DARK }); y -= 14;
  const items = r.unrelated.length ? r.unrelated.map((a) => `${a.code} - ${a.name}`) : ["Todas las actividades se relacionaron con alguna función."];
  for (const it of items) for (const l of wrap(it, font, SIZE, total - 8)) { if (y < M + 20) { page = doc.addPage([W, H]); top(); } page.drawText(l, { x: M + 4, y, size: SIZE, font, color: INK }); y -= LH + 1; }
  doc.getPages().forEach((p, i, all) => p.drawText(`Estudio de Cargas · generado ${stamp} · página ${i + 1} de ${all.length}`, { x: M, y: 14, size: 7.5, font, color: MUTED }));
  return doc.save();
}
