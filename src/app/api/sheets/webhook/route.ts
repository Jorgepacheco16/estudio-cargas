import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/server";
import { sheetChangeEvent } from "@/domain/contracts";
import { verifySignature } from "@/server/webhook";
import { handleEvent } from "@/server/sheets/sync";
import { rateLimit } from "@/lib/ratelimit";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY = 1_000_000;

/** Evento firmado de Apps Script (brief §12.4): firma HMAC de tiempo constante, ventana de ±5 min, cuerpo validado, idempotente por eventId. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`webhook:${ip}`, 120, 60_000).ok) return err(429, "RATE_LIMITED", "Demasiadas solicitudes");
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!secret) return err(503, "INTERNAL", "Sincronización no configurada");
  const raw = await req.text();
  if (raw.length > MAX_BODY) return err(413, "VALIDATION", "Cuerpo demasiado grande");
  const ts = Number(req.headers.get("x-timestamp")), sig = req.headers.get("x-signature") ?? "";
  if (!/^[0-9a-f]+$/i.test(sig) || !verifySignature(raw, sig, ts, secret)) return err(401, "FORBIDDEN", "Firma inválida o evento vencido");
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return err(400, "VALIDATION", "JSON inválido"); }
  const ev = sheetChangeEvent.safeParse(json);
  if (!ev.success) return err(400, "VALIDATION", "Evento inválido");
  const r = await handleEvent(getDb(), ev.data);
  if (r.status === "unknown_sheet") return err(404, "NOT_FOUND", "La hoja no está conectada");
  if (r.status === "error") return err(500, "INTERNAL", "No se pudo procesar el evento");
  return NextResponse.json({ status: r.status, rows: r.outcomes?.length ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
