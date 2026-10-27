"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { createClient, getUser } from "@/lib/supabase/server";
import { activeStudyId } from "@/data/source";
import { createStudy, listStudies } from "@/server/studies";

const back = (kind: "ok" | "error", msg: string): never => redirect(`/estudio?${kind === "ok" ? "ok" : "error"}=${encodeURIComponent(msg)}`);

/** Convierte un error en un mensaje seguro para la pantalla (sin detalles internos de la base). */
function safeMessage(e: unknown): string {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42501") return "No tiene permiso para modificar este estudio (rol de solo lectura).";
  if (code === "23505") return "Ya existe un registro con ese código o clave en el estudio.";
  if (code === "23514") return "Un valor está fuera del rango permitido.";
  if (code === "23503") return "La referencia indicada no existe en este estudio.";
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Datos inválidos.";
  if (e instanceof Error && !code && e.message.length < 140) return e.message;
  return "No se pudo guardar. Intente de nuevo.";
}

async function session() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user!;
}

/** Número con coma o punto decimal. Vacío → null; texto no numérico → error (nunca se convierte en 0). */
const num = (label: string, min = 0, max = 1e9) => z.preprocess((v) => {
  const s = String(v ?? "").trim().replace(/,/g, ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}, z.number({ error: `${label}: escriba un número` }).min(min, `${label}: mínimo ${min}`).max(max, `${label}: máximo ${max}`).nullable());

const opt = <const T extends [string, ...string[]]>(values: T) => z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(values).nullable());

export async function signOutAction() {
  await (await createClient()).auth.signOut();
  redirect("/ingreso");
}

export async function createStudyAction(fd: FormData) {
  const user = await session();
  let id = "";
  try {
    id = await createStudy(getDb(), user.id, String(fd.get("name") ?? ""), String(fd.get("description") ?? ""));
    (await cookies()).set("estudio_id", id, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  } catch (e) { back("error", safeMessage(e)); }
  back("ok", "Estudio creado con sus 14 áreas.");
}

export async function selectStudyAction(fd: FormData) {
  const user = await session();
  const id = z.string().uuid().safeParse(fd.get("id"));
  const list = await listStudies(getDb(), user.id);
  if (id.success && list.some((s) => s.id === id.data)) (await cookies()).set("estudio_id", id.data, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  redirect("/estudio");
}


