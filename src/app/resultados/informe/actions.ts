"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { canEdit } from "@/lib/access";
import { rateLimit } from "@/lib/ratelimit";
import { SECTION_IDS, type SectionId } from "@/domain/report-text";
import { approveVersion, discardDraft, generateVersion, regenerateSection, saveSectionText, type ReportResult } from "@/server/report-version";

/**
 * Acciones del texto del informe (D-106). Redactar con el agente exige Edición en «Resultados» y en «Agente de IA» y todas las áreas (el agente analiza todo el estudio); editar,
 * aprobar y descartar exigen Edición en «Resultados». La base de datos vuelve a exigirlo (políticas y disparador de report_versions).
 */
const PATH = "/resultados/informe";
const uuid = z.string().uuid();
const fail = (message: string) => ({ ok: false as const, message });

type Ctx = { error: string; user?: undefined; study?: undefined } | { error?: undefined; user: NonNullable<Awaited<ReturnType<typeof getUser>>>; study: NonNullable<Awaited<ReturnType<typeof activeStudyId>>> };
async function ctx(needsAgent: boolean): Promise<Ctx> {
  const user = await getUser();
  if (!user) return { error: "Inicie sesión." };
  const study = await activeStudyId(user.id);
  if (!study) return { error: "Elija un estudio primero." };
  if (!canEdit(study, "resultados")) return { error: "Su rol no permite cambiar el informe: necesita Edición en Resultados." };
  if (needsAgent && (!canEdit(study, "agente") || !study.access?.allAreas)) return { error: "Redactar con el agente exige Edición en Resultados y en Agente de IA, y acceso a todas las áreas." };
  return { user, study };
}

export async function generateReportAction(): Promise<ReportResult> {
  const c = await ctx(true);
  if (c.error !== undefined) return fail(c.error);
  if (!rateLimit(`report:${c.user.id}`, 3, 60_000).ok) return fail("Espere un momento antes de volver a redactar.");
  const r = await generateVersion(getDb(), c.user.id, c.study.id);
  revalidatePath(PATH);
  return r;
}

export async function regenerateSectionAction(versionId: string, sectionId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = await ctx(true);
  if (c.error !== undefined) return fail(c.error);
  if (!uuid.safeParse(versionId).success || !(SECTION_IDS as readonly string[]).includes(sectionId)) return fail("La sección no es válida.");
  if (!rateLimit(`report:${c.user.id}`, 6, 60_000).ok) return fail("Espere un momento antes de volver a redactar.");
  const r = await regenerateSection(getDb(), c.user.id, c.study.id, versionId, sectionId as SectionId);
  revalidatePath(PATH);
  return r;
}

export async function saveSectionTextAction(versionId: string, sectionId: string, text: string): Promise<{ ok: true; status: string; note?: string } | { ok: false; message: string }> {
  const c = await ctx(false);
  if (c.error !== undefined) return fail(c.error);
  if (!uuid.safeParse(versionId).success || !(SECTION_IDS as readonly string[]).includes(sectionId)) return fail("La sección no es válida.");
  if (!rateLimit(`report-edit:${c.user.id}`, 30, 60_000).ok) return fail("Demasiados cambios seguidos. Espere un momento.");
  const r = await saveSectionText(getDb(), c.user.id, c.study.id, versionId, sectionId as SectionId, text);
  revalidatePath(PATH);
  return r;
}

export async function approveVersionAction(fd: FormData) {
  const c = await ctx(false);
  if (c.error !== undefined) redirect(`${PATH}?error=${encodeURIComponent(c.error)}`);
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) redirect(`${PATH}?error=${encodeURIComponent("La versión no es válida.")}`);
  const r = await approveVersion(getDb(), c.user.id, c.study.id, id.data!);
  revalidatePath(PATH);
  redirect(r.ok ? `${PATH}?v=${r.number}&ok=${encodeURIComponent(`Versión ${r.number} aprobada: es la versión oficial del informe.`)}` : `${PATH}?error=${encodeURIComponent(r.message)}`);
}

export async function discardDraftAction(fd: FormData) {
  const c = await ctx(false);
  if (c.error !== undefined) redirect(`${PATH}?error=${encodeURIComponent(c.error)}`);
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) redirect(`${PATH}?error=${encodeURIComponent("La versión no es válida.")}`);
  const r = await discardDraft(getDb(), c.user.id, c.study.id, id.data!);
  revalidatePath(PATH);
  redirect(r.ok ? `${PATH}?ok=${encodeURIComponent("Borrador descartado.")}` : `${PATH}?error=${encodeURIComponent(r.message)}`);
}
