/**
 * Fuente de datos de las vistas.
 *  · Sin sesión: datos de demostración (ficticios, los mismos de la prueba dorada).
 *  · Con sesión: el estudio activo del usuario, leído de PostgreSQL con withRls().
 */
import { cookies } from "next/headers";
import demo from "./demo.json";
import { analyze, type Analysis, type Mode, type Thresholds } from "@/domain/summary";
import type { ActivityInput, Params, StaffingInput } from "@/domain/engine";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { listStudies, loadStudyData } from "@/server/studies";

export const DEMO_THRESHOLDS: Thresholds = { high: 1, low: 0.5 }; // hoja Parametros: C9 = 100 %, C10 = 50 %

export interface Loaded { analysis: Analysis; params: Params; thresholds: Thresholds; mode: Mode; label: string; source: "demo" | "estudio" | "sin-estudio" | "error" }

export function parseMode(v: string | string[] | undefined): Mode | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "real" || s === "demo" || s === "all" ? s : undefined;
}

const EMPTY_PARAMS: Params = { workDaysPerWeek: 6, weeksPerMonth: 4.333333, weeksPerYear: 52, reservePct: 0.1, scenario: "base" };

export async function activeStudyId(userId: string): Promise<{ id: string; name: string; role: string } | null> {
  const list = await listStudies(getDb(), userId);
  if (list.length === 0) return null;
  const wanted = (await cookies()).get("estudio_id")?.value;
  return list.find((s) => s.id === wanted) ?? list[0];
}

export async function loadAnalysis(requested: Mode | undefined): Promise<Loaded> {
  const user = await getUser();
  if (!user) {
    const params = demo.params as Params, mode = requested ?? "demo";
    return { analysis: analyze(demo.positions as StaffingInput[], demo.activities as ActivityInput[], params, DEMO_THRESHOLDS, mode), params, thresholds: DEMO_THRESHOLDS, mode, label: "Datos de demostración (ficticios) · inicie sesión para ver su estudio", source: "demo" };
  }
  const mode = requested ?? "all";
  try {
    const study = await activeStudyId(user.id);
    if (!study) return { analysis: analyze([], [], EMPTY_PARAMS, DEMO_THRESHOLDS, mode), params: EMPTY_PARAMS, thresholds: DEMO_THRESHOLDS, mode, label: "Aún no tiene estudios: créelo en la sección Estudio", source: "sin-estudio" };
    const d = await loadStudyData(getDb(), user.id, study.id);
    return { analysis: analyze(d.staff, d.acts, d.params, d.thresholds, mode), params: d.params, thresholds: d.thresholds, mode, label: `Estudio: ${study.name}`, source: "estudio" };
  } catch {
    return { analysis: analyze([], [], EMPTY_PARAMS, DEMO_THRESHOLDS, mode), params: EMPTY_PARAMS, thresholds: DEMO_THRESHOLDS, mode, label: "No se pudieron leer los datos del estudio", source: "error" };
  }
}
