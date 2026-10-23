import { NextResponse, type NextRequest } from "next/server";
import { loadAnalysis, parseMode } from "@/data/source";
import { tablesFor, isView } from "@/lib/tables";
import { toCsv, toXlsx } from "@/lib/export";

export async function GET(req: NextRequest, ctx: { params: Promise<{ view: string }> }) {
  const { view } = await ctx.params;
  if (!isView(view)) return NextResponse.json({ error: { code: "UNKNOWN_VIEW", message: "Vista desconocida" } }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "csv" ? "csv" : "xlsx";
  const { analysis, dashboard } = await loadAnalysis(parseMode(sp.get("modo") ?? undefined));
  const { title, tables } = tablesFor(view, analysis, dashboard);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `estudio-cargas_${view}_${stamp}`;

  if (format === "csv") {
    // CSV es una sola tabla: la principal de la vista (en el tablero, la de cargos).
    const main = tables.find((t) => t.name === "Cargos") ?? tables[0];
    return new NextResponse(toCsv(main), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" } });
  }
  const buf = await toXlsx(tables, title);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "no-store" } });
}
