import { NextResponse, type NextRequest } from "next/server";
import { loadAnalysis, parseMode } from "@/data/source";
import { tablesFor, isView, type ProposalRow } from "@/lib/tables";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { listProposals } from "@/server/agent";
import { toCsv, toXlsx } from "@/lib/export";
import { toPdf } from "@/lib/pdf";
import { rateLimit } from "@/lib/ratelimit";
import { activityFilters, paramsToRecord, positionFilters } from "@/lib/page-filters";
import { listActivityNames } from "@/server/studies";

export async function GET(req: NextRequest, ctx: { params: Promise<{ view: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = rateLimit(`export:${ip}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Demasiadas descargas seguidas. Espere un momento." } }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const { view } = await ctx.params;
  if (!isView(view)) return NextResponse.json({ error: { code: "UNKNOWN_VIEW", message: "Vista desconocida" } }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const fmtParam = sp.get("format");
  const format = fmtParam === "csv" ? "csv" : fmtParam === "pdf" ? "pdf" : "xlsx";
  const loaded = await loadAnalysis(parseMode(sp.get("modo") ?? undefined));
  const { dashboard, label } = loaded;
  // Las exportaciones respetan los filtros elegidos en pantalla (D-74): centro de operaciones, área, cargo, estado y búsqueda.
  let analysis = loaded.analysis;
  const fp = paramsToRecord(sp);
  if (view === "cargos") analysis = { ...analysis, positions: positionFilters(analysis.positions, fp).rows };
  if (view === "actividades" || view === "calculo") {
    let names: Map<string, string> | undefined;
    if (view === "calculo" && loaded.source === "estudio") { const u = await getUser(); const s = u ? await activeStudyId(u.id) : null; if (u && s) names = await listActivityNames(getDb(), u.id, s.id); }
    analysis = { ...analysis, activities: activityFilters(analysis.activities, fp, view === "calculo" ? "calculo" : "captura", names).rows };
  }
  const q = Object.fromEntries(["area", "position", "config", "level", "site", "code", "alert"].map((k) => [k, sp.get(k) ?? undefined]));
  let proposals: ProposalRow[] = [];
  if (view === "agente") {
    const user = await getUser(); const study = user ? await activeStudyId(user.id) : null;
    if (user && study) proposals = (await listProposals(getDb(), user.id, study.id)).map((p) => ({ id: p.id, kind: p.kind, summary: p.summary, status: p.status, reviewedBy: p.reviewedBy ? "persona autorizada" : null, at: p.createdAt.toISOString().slice(0, 10) }));
  }
  const { title, tables } = tablesFor(view, analysis, dashboard, proposals, q, loaded.mode, loaded.params.reservePct);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `estudio-cargas_${view}_${stamp}`;

  if (format === "csv") {
    // CSV es una sola tabla: la principal de la vista (en el tablero, la de cargos).
    const main = tables.find((t) => t.name === "Cargos") ?? tables[0];
    return new NextResponse(toCsv(main), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" } });
  }
  if (format === "pdf") {
    const pdf = await toPdf(tables, title, `Estudio de Cargas · ${label}`);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"`, "Cache-Control": "no-store" } });
  }
  const buf = await toXlsx(tables, title);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "no-store" } });
}
