/** Exportación a PDF (A4 horizontal) de las mismas tablas que CSV/XLSX. Fuentes estándar: los caracteres fuera de WinAnsi se cambian por «?». */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { Cell, Table } from "./export";

const W = 842, H = 595, M = 32, ROW = 15, BLUE = rgb(0.114, 0.247, 0.58), RED = rgb(0.839, 0.078, 0.11), INK = rgb(0.09, 0.125, 0.227), LINE = rgb(0.87, 0.88, 0.925);

function show(v: Cell, fmt?: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return fmt?.includes("%") ? (v * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + "%" : v.toLocaleString("es-CO", { maximumFractionDigits: 2 });
  return v;
}

export async function toPdf(tables: Table[], title: string, subtitle: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setCreator("Estudio de Cargas");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ok = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/[\r\n\t]+/g, " ")).map((ch) => (ok.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  const fit = (s: string, f: PDFFont, size: number, max: number) => {
    let t = clean(s);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > max) t = t.slice(0, -1);
    return t + "...";
  };

  let page = doc.addPage([W, H]), y = H - M;
  const header = () => {
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: RED });
    page.drawText(clean(title), { x: M, y: H - M - 6, size: 16, font: bold, color: INK });
    page.drawText(fit(subtitle, font, 9, W - 2 * M), { x: M, y: H - M - 20, size: 9, font, color: rgb(0.33, 0.38, 0.48) });
    y = H - M - 40;
  };
  header();

  for (const t of tables) {
    if (y < M + 60) { page = doc.addPage([W, H]); header(); }
    page.drawText(clean(t.name), { x: M, y, size: 11, font: bold, color: BLUE }); y -= 16;
    const total = t.columns.reduce((a, c) => a + (c.width ?? 14), 0), scale = (W - 2 * M) / total;
    const xs: number[] = []; let acc = M; for (const c of t.columns) { xs.push(acc); acc += (c.width ?? 14) * scale; }
    const widths = t.columns.map((c) => (c.width ?? 14) * scale - 6);
    const head = () => {
      page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: ROW, color: BLUE });
      t.columns.forEach((c, i) => page.drawText(fit(c.header, bold, 7.5, widths[i]), { x: xs[i] + 3, y, size: 7.5, font: bold, color: rgb(1, 1, 1) }));
      y -= ROW;
    };
    head();
    for (const r of t.rows) {
      if (y < M + 20) { page = doc.addPage([W, H]); header(); head(); }
      t.columns.forEach((c, i) => page.drawText(fit(show(r[c.key] ?? null, c.fmt), font, 7.5, widths[i]), { x: xs[i] + 3, y, size: 7.5, font, color: INK }));
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.4, color: LINE });
      y -= ROW;
    }
    if (t.rows.length === 0) { page.drawText("Sin registros", { x: M + 3, y, size: 8, font, color: rgb(0.33, 0.38, 0.48) }); y -= ROW; }
    y -= 14;
  }

  const stamp = new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" });
  doc.getPages().forEach((p, i, all) => p.drawText(`Generado ${stamp} · página ${i + 1} de ${all.length}`, { x: M, y: 14, size: 7.5, font, color: rgb(0.33, 0.38, 0.48) }));
  return doc.save();
}
