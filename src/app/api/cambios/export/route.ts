import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { canRead } from "@/lib/access";
import { toXlsx, type Cell } from "@/lib/export";
import { rateLimit } from "@/lib/ratelimit";
import { KIND_LABEL, actionLabel, diffText, kindOf, originLabel, sectionOf } from "@/domain/changelog";
import { actorLabel, exportChangeRows, readChangeFilters } from "@/server/changelog";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
const MAX_ROWS = 20000;
const when = (d: Date) => d.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "medium" });

/** Descarga a Excel del registro de cambios con los mismos filtros de la pantalla (D-96). Requiere sesión y Historia en Lectura; la base de datos vuelve a verificarlo. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return err(401, "FORBIDDEN", "Inicie sesión para descargar el registro de cambios");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`cambios:${user.id}:${ip}`, 6, 60_000).ok) return err(429, "RATE_LIMITED", "Demasiadas descargas seguidas. Espere un momento.");
  const study = await activeStudyId(user.id);
  if (!study) return err(404, "NOT_FOUND", "No hay un estudio seleccionado");
  if (study.access && !canRead(study, "historia")) return err(403, "FORBIDDEN", "Su rol no permite ver Historia y desviaciones.");
  const params: Record<string, string | string[] | undefined> = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) { const v = req.nextUrl.searchParams.getAll(k); params[k] = v.length > 1 ? v : v[0]; }
  const { filters } = readChangeFilters(params);
  const { rows, truncated } = await exportChangeRows(getDb(), user.id, study.id, filters, MAX_ROWS);
  const table = rows.map((r): Record<string, Cell> => ({
    fecha: when(r.at), usuario: actorLabel(r), correo: r.email, tipo: KIND_LABEL[kindOf(r.entity)], seccion: sectionOf(r.entity), accion: actionLabel(r.action), registro: r.subject,
    area: r.area, cargo: r.position, detalle: diffText(r.action, r.diff) || null, origen: originLabel(r.origin),
  }));
  if (truncated) table.push({ fecha: null, usuario: null, correo: null, tipo: null, seccion: null, accion: null, registro: `Se muestran los ${MAX_ROWS.toLocaleString("es-CO")} cambios más recientes. Use los filtros para acotar la descarga.`, area: null, cargo: null, detalle: null, origen: null });
  const buf = await toXlsx([{
    name: "Registro de cambios",
    columns: [
      { key: "fecha", header: "Fecha y hora", width: 20 }, { key: "usuario", header: "Usuario", width: 28 }, { key: "correo", header: "Correo", width: 30 }, { key: "tipo", header: "Tipo", width: 18 },
      { key: "seccion", header: "Sección", width: 24 }, { key: "accion", header: "Acción", width: 12 }, { key: "registro", header: "Registro", width: 34 }, { key: "area", header: "Área", width: 20 },
      { key: "cargo", header: "Cargo", width: 24 }, { key: "detalle", header: "Detalle", width: 70 }, { key: "origen", header: "Origen", width: 16 },
    ],
    rows: table,
  }], `Registro de cambios · ${study.name}`);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="registro-de-cambios_${stamp}.xlsx"`, "Cache-Control": "no-store" } });
}
