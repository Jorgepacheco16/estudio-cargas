/**
 * Informe de resultados en PDF (D-107): A4 vertical, portada con el logo del cliente, cifras clave, el texto aprobado con las cifras que cita, las tres gráficas dibujadas como vector con la
 * misma geometría del tablero (report-charts.ts), el detalle por cargo y la calidad de los datos. Fuentes estándar: los caracteres fuera de WinAnsi se cambian.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { ReportDoc } from "@/domain/report-doc";
import { peopleByAreaChart, truncate, useByPositionChart as usageByPositionChart, weeksChart } from "@/domain/report-charts";
import { COLOR, logoHeight, type Logo } from "./assets";

const W = 595, H = 842, M = 48, CW = W - 2 * M;
const hex = (h: string) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
const PRIMARY = hex(COLOR.primary), SECONDARY = hex(COLOR.secondary), INK = hex(COLOR.ink), MUTED = rgb(0.33, 0.38, 0.48), LINE = rgb(0.87, 0.88, 0.925), SERIES_A = hex("5F8DC0"), AMBER = hex("B7791F"), GRAY = rgb(0.6, 0.63, 0.7), WHITE = rgb(1, 1, 1);
const LEVEL_COLOR = { overload: PRIMARY, low: AMBER, ok: SECONDARY, nodata: GRAY } as const;
const nf = (n: number, d = 0) => n.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });

export async function reportPdf(doc: ReportDoc, logo: Logo): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title} · ${doc.studyName} · ${doc.versionLabel}`); pdf.setAuthor(doc.clientName); pdf.setCreator("BalanceAPP");
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const img: PDFImage = await pdf.embedPng(logo.bytes);
  const ok = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/[\r\n\t]+/g, " ").replace(/−/g, "-")).map((ch) => (ok.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  const fit = (s: string, f: PDFFont, size: number, max: number) => {
    let t = clean(s);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > max) t = t.slice(0, -1);
    return t + "…";
  };
  const wrap = (s: string, f: PDFFont, size: number, max: number) => {
    const lines: string[] = []; let cur = "";
    for (const w of clean(s).split(" ")) { const t = cur ? `${cur} ${w}` : w; if (cur && f.widthOfTextAtSize(t, size) > max) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  };

  /* ── Portada ── */
  let page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: PRIMARY });
  const lw = 230, lh = logoHeight(logo, lw);
  page.drawImage(img, { x: M, y: H - 120 - lh, width: lw, height: lh });
  page.drawText(clean(doc.title), { x: M, y: H - 330, size: 34, font: bold, color: SECONDARY });
  page.drawRectangle({ x: M, y: H - 346, width: 70, height: 4, color: PRIMARY });
  let cy = H - 380;
  for (const l of wrap(doc.studyName, bold, 16, CW)) { page.drawText(l, { x: M, y: cy, size: 16, font: bold, color: INK }); cy -= 22; }
  for (const t of [`${doc.versionLabel} · aprobada el ${doc.approvedOn}`, doc.context, `Preparado para ${doc.clientName}`]) for (const l of wrap(t, font, 11, CW)) { page.drawText(l, { x: M, y: (cy -= 16), size: 11, font, color: MUTED }); }
  page.drawText(clean(`BalanceAPP · ${doc.generatedOn}`), { x: M, y: 40, size: 9, font, color: MUTED });

  /* ── Cuerpo ── */
  let y = 0;
  const body = () => {
    page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: PRIMARY });
    const w = 78, h = logoHeight(logo, w);
    page.drawImage(img, { x: W - M - w, y: H - 14 - h, width: w, height: h });
    page.drawText(clean(doc.title), { x: M, y: H - 34, size: 9, font: bold, color: SECONDARY });
    page.drawText(fit(`${doc.studyName} · ${doc.versionLabel}`, font, 8, CW - w - 20), { x: M, y: H - 46, size: 8, font, color: MUTED });
    y = H - 74;
  };
  const room = (h: number) => { if (y - h < M + 14) body(); };
  const heading = (t: string) => { room(46); page.drawText(clean(t), { x: M, y, size: 14, font: bold, color: SECONDARY }); y -= 8; page.drawRectangle({ x: M, y: y - 3, width: 36, height: 2, color: PRIMARY }); y -= 20; };
  const para = (t: string, size = 10, f = font, color = INK, lead = 14) => { for (const l of wrap(t, f, size, CW)) { room(lead); page.drawText(l, { x: M, y, size, font: f, color }); y -= lead; } };
  body();

  page.drawText("Cifras clave", { x: M, y, size: 14, font: bold, color: SECONDARY }); y -= 8; page.drawRectangle({ x: M, y: y - 3, width: 36, height: 2, color: PRIMARY }); y -= 14;
  const bw = (CW - 2 * 10) / 3, bh = 70;
  doc.kpis.forEach((k, n) => {
    const col = n % 3, row = Math.floor(n / 3), x = M + col * (bw + 10), top = y - row * (bh + 10);
    page.drawRectangle({ x, y: top - bh, width: bw, height: bh, borderColor: LINE, borderWidth: 1, color: rgb(0.97, 0.98, 1) });
    page.drawText(fit(k.label, font, 8.5, bw - 16), { x: x + 8, y: top - 16, size: 8.5, font, color: MUTED });
    page.drawText(fit(k.value, bold, 22, bw - 16), { x: x + 8, y: top - 42, size: 22, font: bold, color: SECONDARY });
    wrap(k.note, font, 7.5, bw - 16).slice(0, 2).forEach((l, j) => page.drawText(l, { x: x + 8, y: top - 56 - j * 9, size: 7.5, font, color: MUTED }));
  });
  y -= Math.ceil(doc.kpis.length / 3) * (bh + 10) + 16;
  if (doc.staleNote) {
    const lines = wrap(doc.staleNote, font, 8.5, CW - 16), h = lines.length * 12 + 12;
    room(h + 8);
    page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: rgb(1, 0.95, 0.85), borderColor: AMBER, borderWidth: 0.8 });
    lines.forEach((l, j) => page.drawText(l, { x: M + 8, y: y - 15 - j * 12, size: 8.5, font, color: INK }));
    y -= h + 12;
  }

  /* ── Texto aprobado ── */
  doc.sections.forEach((s, i) => {
    heading(`${i + 1}. ${s.title}`);
    for (const p of s.paragraphs) { para(p); y -= 6; }
    if (s.cited.length) { para(`Cifras citadas: ${s.cited.map((c) => `${c.label}: ${c.display}`).join(" · ")}`, 8, font, MUTED, 11); y -= 6; }
    y -= 6;
  });

  /* ── Gráficas (vector, con la geometría del tablero) ── */
  const { facts } = doc;
  const chartBox = (title: string, naturalW: number, naturalH: number) => {
    const s = Math.min(1.1, CW / naturalW), h = naturalH * s;
    room(h + 40); page.drawText(clean(title), { x: M, y, size: 11, font: bold, color: INK }); y -= 12;
    const top = y; y -= h + 18;
    return { s, top, X: (x: number) => M + x * s, Y: (yy: number) => top - yy * s };
  };
  const txt = (p: PDFPage, t: string, x: number, yy: number, size: number, f: PDFFont, color = INK, anchor: "start" | "middle" | "end" = "start", halo = false) => {
    const c = clean(t), w = f.widthOfTextAtSize(c, size);
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    if (halo) p.drawRectangle({ x: x0 - 2, y: yy - 2, width: w + 4, height: size + 3, color: WHITE });
    p.drawText(c, { x: x0, y: yy, size, font: f, color });
  };
  heading("Gráficas");
  if (facts.areas.length) {
    const c = peopleByAreaChart(facts.areas.map((a) => ({ label: a.area, hay: a.occupants, necesarias: a.required })));
    const b = chartBox("Personas que hay y necesarias, por área", c.width, c.height), fs = Math.max(7, 10 * b.s);
    for (const t of c.ticks) { page.drawLine({ start: { x: b.X(c.left), y: b.Y(t.y) }, end: { x: b.X(c.width - 12), y: b.Y(t.y) }, thickness: t.value === 0 ? 0.8 : 0.4, color: t.value === 0 ? MUTED : LINE }); txt(page, nf(t.value), b.X(c.left - 6), b.Y(t.y) - 3, fs - 1, font, MUTED, "end"); }
    for (const g of c.groups) {
      for (const bar of g.bars) { page.drawRectangle({ x: b.X(bar.x), y: b.Y(bar.y + bar.h), width: bar.w * b.s, height: Math.max(0, bar.h * b.s), color: bar.series === "hay" ? SERIES_A : SECONDARY }); txt(page, nf(bar.value), b.X(bar.x + bar.w / 2), b.Y(bar.y) + 4, fs, bold, INK, "middle"); }
      txt(page, truncate(g.label, 14), b.X(g.cx), b.Y(c.baseline) - 14 * b.s, fs, font, INK, "middle");
    }
    page.drawRectangle({ x: M, y: y + 6, width: 8, height: 8, color: SERIES_A }); txt(page, "Hay hoy", M + 12, y + 7, 8, font, MUTED);
    page.drawRectangle({ x: M + 70, y: y + 6, width: 8, height: 8, color: SECONDARY }); txt(page, "Necesarias", M + 82, y + 7, 8, font, MUTED);
    y -= 8;
  }
  if (facts.positions.length) {
    const c = usageByPositionChart(facts.positions.filter((p) => p.usePct !== null).map((p) => ({ label: `${p.position} (${p.area})`, pct: p.usePct as number, level: p.level })), facts.overload);
    const b = chartBox(`Uso de la capacidad actual, por cargo${facts.positions.length > 10 ? " (los 10 con más uso)" : ""}`, c.width, c.height), fs = Math.max(7, 10 * b.s);
    for (const t of c.ticks) { page.drawLine({ start: { x: b.X(t.x), y: b.Y(c.top - 6) }, end: { x: b.X(t.x), y: b.Y(c.bottom) }, thickness: 0.4, color: LINE }); txt(page, `${nf(t.pct)} %`, b.X(t.x), b.Y(c.bottom) - 12 * b.s, fs - 1, font, MUTED, "middle"); }
    for (const r of c.rows) {
      txt(page, r.short, b.X(c.plotLeft - 8), b.Y(r.labelY) - 3, fs, font, INK, "end");
      page.drawRectangle({ x: b.X(c.plotLeft), y: b.Y(r.y + 22), width: Math.max(1, r.w * b.s), height: 22 * b.s, color: LEVEL_COLOR[r.level] });
      txt(page, `${nf(r.pct * 100)} %`, b.X(c.plotLeft) + r.w * b.s + 4, b.Y(r.labelY) - 3, fs, bold, INK, "start", true);
    }
    page.drawLine({ start: { x: b.X(c.xThreshold), y: b.Y(c.top - 10) }, end: { x: b.X(c.xThreshold), y: b.Y(c.bottom) }, thickness: 1, color: PRIMARY, dashArray: [3, 2] });
    txt(page, `Umbral ${nf(c.thresholdPct)} %`, b.X(c.xThreshold), b.Y(c.top - 12), fs - 1, bold, PRIMARY, "middle");
  }
  if (facts.weeks.common || facts.weeks.periodic) {
    const c = weeksChart(facts.weeks.common, facts.weeks.periodic, facts.overload);
    const b = chartBox("Trabajo de la semana común y con periódicas (horas por semana)", c.width, c.height), fs = Math.max(7, 10 * b.s);
    for (const t of c.ticks) { page.drawLine({ start: { x: b.X(t.x), y: b.Y(c.top - 6) }, end: { x: b.X(t.x), y: b.Y(c.bottom) }, thickness: 0.4, color: LINE }); txt(page, nf(t.value), b.X(t.x), b.Y(c.bottom) - 12 * b.s, fs - 1, font, MUTED, "middle"); }
    for (const r of c.bars) {
      txt(page, r.label, b.X(c.plotLeft - 8), b.Y(r.y + 15) - 3, fs, font, INK, "end");
      page.drawRectangle({ x: b.X(c.plotLeft), y: b.Y(r.y + 30), width: Math.max(1, r.w * b.s), height: 30 * b.s, color: r.id === "common" ? SERIES_A : SECONDARY });
      txt(page, `${nf(r.hours, 0)} h · ${nf(r.utilization * 100)} %`, b.X(c.plotLeft) + r.w * b.s + 4, b.Y(r.y + 15) - 3, fs, bold, INK, "start", true);
    }
    if (c.xCapacity !== null) { page.drawLine({ start: { x: b.X(c.xCapacity), y: b.Y(c.top - 8) }, end: { x: b.X(c.xCapacity), y: b.Y(c.bottom) }, thickness: 1, color: INK }); txt(page, `Capacidad ${nf(c.capacityHours)} h`, b.X(c.xCapacity), b.Y(c.top - 10), fs - 1, bold, INK, "middle"); }
    if (facts.weeks.common) para(`En la semana común quedan ${nf(facts.weeks.common.freeHours)} h de disponibilidad sin tareas.`, 8.5, font, MUTED, 12);
  }

  /* ── Detalle por cargo ── */
  y -= 8; heading("Detalle por cargo");
  const cols: { h: string; w: number; key: "position" | "place" | "hay" | "exact" | "required" | "gap" | "use" | "state"; right?: boolean }[] = [
    { h: "Cargo", w: 82, key: "position" }, { h: "Área · centro", w: 84, key: "place" }, { h: "Hay", w: 24, key: "hay", right: true }, { h: "Exactas", w: 36, key: "exact", right: true },
    { h: "Necesarias", w: 46, key: "required", right: true }, { h: "Brecha", w: 34, key: "gap", right: true }, { h: "Uso", w: 34, key: "use", right: true }, { h: "Estado", w: 0, key: "state" },
  ];
  cols[cols.length - 1].w = CW - cols.slice(0, -1).reduce((t, c) => t + c.w, 0);
  const xs: number[] = []; { let a = M; for (const c of cols) { xs.push(a); a += c.w; } }
  const head = () => { room(30); page.drawRectangle({ x: M, y: y - 4, width: CW, height: 15, color: SECONDARY }); cols.forEach((c, i) => page.drawText(fit(c.h, bold, 7.5, c.w - 6), { x: xs[i] + 3, y, size: 7.5, font: bold, color: WHITE })); y -= 15; };
  head();
  for (const r of doc.detail) {
    if (y < M + 28) { body(); head(); }
    cols.forEach((c, i) => { const t = fit(r[c.key], font, 7.5, c.w - 6); page.drawText(t, { x: c.right ? xs[i] + c.w - 3 - font.widthOfTextAtSize(t, 7.5) : xs[i] + 3, y, size: 7.5, font, color: INK }); });
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.4, color: LINE });
    y -= 15;
  }
  if (doc.detail.length === 0) para("Sin cargos con cifra.", 9, font, MUTED);

  /* ── Calidad de los datos ── */
  y -= 10; heading("Calidad de los datos");
  for (const q of doc.quality) para(`•  ${q}`, 10);

  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    if (i === 0) return; // la portada va sin pie
    txt(p, `${doc.clientName} · ${doc.title} · ${doc.versionLabel}`, M, 24, 7.5, font, MUTED);
    txt(p, `Página ${i} de ${total - 1}`, W - M, 24, 7.5, font, MUTED, "end");
  });
  return pdf.save();
}
