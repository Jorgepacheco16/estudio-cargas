import { NextResponse, type NextRequest } from "next/server";
import { activeStudyId } from "@/data/source";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { canEdit, canRead } from "@/lib/access";
import { ENTRY_MODULE } from "@/domain/access";
import { rateLimit } from "@/lib/ratelimit";
import { buildTemplate, bulkEnabled } from "@/server/entry/bulk-file";
import { entryDef } from "@/server/entry/defs";
import { entryOptions } from "@/server/entry/service";

/** Plantilla de Excel para la carga masiva de una sección (D-72). Solo para personas con permiso de escritura en el estudio activo. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ hoja: string }> }) {
  const { hoja } = await ctx.params;
  const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });
  if (!bulkEnabled(hoja)) return err(404, "NOT_FOUND", "Esta sección no tiene carga masiva.");
  const user = await getUser();
  if (!user) return err(401, "FORBIDDEN", "Inicie sesión para descargar la plantilla.");
  if (!rateLimit(`plantilla:${user.id}`, 20, 60_000).ok) return err(429, "RATE_LIMITED", "Demasiadas descargas seguidas. Espere un momento.");
  const study = await activeStudyId(user.id);
  if (!study) return err(404, "NOT_FOUND", "Cree o seleccione un estudio primero.");
  if (!canEdit(study, ENTRY_MODULE[hoja])) return err(403, "FORBIDDEN", "Su rol no permite cargar datos en esta sección.");
  const def = entryDef(hoja)!;
  const { areas, activities } = await entryOptions(getDb(), user.id, study.id);
  const file = await buildTemplate(def, areas, activities.map((a) => a.code));
  const name = `plantilla-${def.short.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.xlsx`;
  return new NextResponse(new Uint8Array(file), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
