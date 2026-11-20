import { NextResponse } from "next/server";
import { activeStudyId } from "@/data/source";
import { getUser } from "@/lib/supabase/server";
import { canEdit } from "@/lib/access";
import { rateLimit } from "@/lib/ratelimit";
import { buildStructureTemplate } from "@/server/structure-file";

/** Formato vacío de «Estructura de la tienda» (D-113). Solo para quien puede editar Cargos y dotación en el estudio activo. */
export async function GET() {
  const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });
  const user = await getUser();
  if (!user) return err(401, "FORBIDDEN", "Inicie sesión para descargar el formato.");
  if (!rateLimit(`estructura:${user.id}`, 20, 60_000).ok) return err(429, "RATE_LIMITED", "Demasiadas descargas seguidas. Espere un momento.");
  const study = await activeStudyId(user.id);
  if (!study) return err(404, "NOT_FOUND", "Cree o seleccione un estudio primero.");
  if (!canEdit(study, "cargos")) return err(403, "FORBIDDEN", "Su rol no permite descargar este formato.");
  const file = await buildStructureTemplate();
  return new NextResponse(new Uint8Array(file), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="formato-estructura-de-la-tienda.xlsx"', "Cache-Control": "no-store" } });
}
