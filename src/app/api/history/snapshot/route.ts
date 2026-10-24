import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/server";
import { runDetection, snapshotTargets, takeSnapshot } from "@/server/history";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Foto semanal del tablero y detección de desviaciones de cada estudio (Vercel Cron, «Authorization: Bearer CRON_SECRET»). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "No autorizado" } }, { status: 401 });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const results: { study: string; ok: boolean }[] = [];
  for (const t of await snapshotTargets(getDb())) {
    try { await takeSnapshot(getDb(), t.actorId, t.studyId, `Semanal ${day}`); await runDetection(getDb(), t.actorId, t.studyId); results.push({ study: t.studyId, ok: true }); }
    catch { results.push({ study: t.studyId, ok: false }); }
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
