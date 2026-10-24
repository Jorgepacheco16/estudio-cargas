import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { toXlsx } from "@/lib/export";
import { rateLimit } from "@/lib/ratelimit";
import { buildBackup } from "@/server/backup";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

/** Respaldo completo del estudio activo en Excel. Requiere sesión; cualquier miembro (incluido solo lectura) puede descargarlo. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return err(401, "FORBIDDEN", "Inicie sesión para descargar el respaldo");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`respaldo:${user.id}:${ip}`, 5, 60_000).ok) return err(429, "RATE_LIMITED", "Demasiadas descargas seguidas. Espere un momento.");
  const study = await activeStudyId(user.id);
  if (!study) return err(404, "NOT_FOUND", "No hay un estudio seleccionado");
  const backup = await buildBackup(getDb(), user.id, study.id);
  if (!backup) return err(404, "NOT_FOUND", "Estudio no encontrado");
  const buf = await toXlsx(backup.tables, `Respaldo · ${backup.name}`);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="respaldo-estudio_${stamp}.xlsx"`, "Cache-Control": "no-store" } });
}
