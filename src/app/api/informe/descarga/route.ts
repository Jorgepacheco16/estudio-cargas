import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { canRead } from "@/lib/access";
import { rateLimit } from "@/lib/ratelimit";
import { CLIENT } from "@/lib/client-theme";
import { buildReportDoc } from "@/domain/report-doc";
import { listVersions, loadReportBasis } from "@/server/report-version";
import { loadClientLogo } from "@/server/report-files/assets";
import { reportPdf } from "@/server/report-files/pdf";
import { reportDocx } from "@/server/report-files/docx";
import { reportPptx } from "@/server/report-files/pptx";

/**
 * Descarga del informe de resultados en PDF, Word o PowerPoint (D-107). Solo de una versión APROBADA, con el logo y los colores del cliente. Exige sesión, «Resultados», Cargos, Actividades y
 * acceso a todas las áreas (igual que ver el texto del informe).
 */
export const maxDuration = 60;
const TYPES = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
} as const;
const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const user = await getUser(), study = user ? await activeStudyId(user.id) : null;
  if (!user || !study) return err(401, "UNAUTHENTICATED", "Inicie sesión para descargar el informe.");
  if (!canRead(study, "resultados") || !canRead(study, "cargos") || !canRead(study, "actividades") || !study.access?.allAreas) return err(403, "FORBIDDEN", "Su rol no permite descargar el informe: necesita Resultados y acceso a todas las áreas.");
  if (!rateLimit(`informe-descarga:${user.id}`, 12, 60_000).ok) return err(429, "RATE_LIMITED", "Demasiadas descargas seguidas. Espere un momento.");
  const sp = req.nextUrl.searchParams, formato = sp.get("formato") ?? "";
  if (!(formato in TYPES)) return err(400, "BAD_FORMAT", "Elija PDF, Word (docx) o PowerPoint (pptx).");
  const kind = TYPES[formato as keyof typeof TYPES];

  const db = getDb();
  const versions = await listVersions(db, user.id, study.id);
  const wanted = Number(sp.get("v"));
  const version = wanted ? versions.find((v) => v.number === wanted) : versions.find((v) => v.status === "approved");
  if (!version) return err(409, "NO_APPROVED_VERSION", "Todavía no hay una versión aprobada del informe: apruebe una para poder descargarla.");
  if (version.status !== "approved") return err(409, "NOT_APPROVED", `La versión ${version.number} no está aprobada (${version.status === "draft" ? "es un borrador" : "fue reemplazada"}): solo se descarga la versión aprobada.`);

  const [basis, logo] = await Promise.all([loadReportBasis(db, user.id, study.id), loadClientLogo()]);
  const doc = buildReportDoc({ clientName: CLIENT.name, studyName: study.name, version, facts: basis.facts, currentHash: basis.inputHash, now: new Date() });
  const bytes = formato === "pdf" ? await reportPdf(doc, logo) : formato === "docx" ? await reportDocx(doc, logo) : await reportPptx(doc, logo);
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": kind.mime, "Content-Disposition": `attachment; filename="${doc.fileBase}.${kind.ext}"`, "Cache-Control": "no-store" } });
}
