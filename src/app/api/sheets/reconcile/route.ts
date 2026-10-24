import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/server";
import { activeConnections, syncNow } from "@/server/sheets/sync";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Reconciliación programada (Vercel Cron envía «Authorization: Bearer CRON_SECRET»). Corrige eventos perdidos y refresca la hoja. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !same(auth, `Bearer ${secret}`)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "No autorizado" } }, { status: 401 });
  const results: { connection: string; ok: boolean }[] = [];
  for (const c of await activeConnections(getDb())) {
    try { await syncNow(getDb(), c); results.push({ connection: c.id, ok: true }); } catch { results.push({ connection: c.id, ok: false }); }
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
