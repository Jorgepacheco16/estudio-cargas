/**
 * Fuente de datos de las vistas.
 *  · Sin sesión: datos de demostración (ficticios, los mismos de la prueba dorada).
 *  · Con sesión: el estudio activo del usuario, leído de PostgreSQL con withRls().
 */
import { getMyAccess, type MyAccess } from "@/server/access";
import { cookies } from "next/headers";
import demo from "./demo.json";
import { analyze, type Analysis, type Mode, type Thresholds } from "@/domain/summary";
import { buildDashboard, type Dashboard } from "@/domain/dashboard";
import type { ActivityInput, Params, StaffingInput } from "@/domain/engine";
import { getDb } from "@/db/server";
import { getUser } from "@/lib/supabase/server";
import { AREAS_14, listStudies } from "@/server/studies";
import { loadDashboard } from "@/server/dashboard-data";
import { memo, requestEpoch } from "@/lib/request-cache";

export const DEMO_THRESHOLDS: Thresholds = { high: 1, low: 0.5 }; // hoja Parametros: C9 = 100 %, C10 = 50 %

export interface Loaded { analysis: Analysis; dashboard: Dashboard; params: Params; thresholds: Thresholds; mode: Mode; label: string; source: "demo" | "estudio" | "sin-estudio" | "error" }

export function parseMode(v: string | string[] | undefined): Mode | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "real" || s === "demo" || s === "all" ? s : undefined;
}

const EMPTY_PARAMS: Params = { workDaysPerWeek: 6, weeksPerMonth: 52 / 12, weeksPerYear: 52, reservePct: 0.1, scenario: "base" };

/** Tablero sin hojas 5–10 (modo demostración o estudio vacío). */
function bare(analysis: Analysis, params: Params, thresholds: Thresholds, mode: Mode, areaNames: string[]): Dashboard {
  return buildDashboard({ mode, analysis, params, thresholds, areaNames, assumptionsValidated: false, hourlyCost: null, meta: [], meas: [], suit: [], risks: [], opps: [], plans: [] });
}

/**
 * Estudios y permisos de la persona: una consulta por petición. La clave lleva, al final, el contador de cambios de la petición (request-cache.ts):
 * si algo se modificó antes de volver a leer, la clave es otra y se consulta de nuevo.
 */
const studiesFor = memo((key: string) => listStudies(getDb(), key.split("|")[0]));
const accessFor = memo((key: string) => { const [userId, studyId] = key.split("|"); return getMyAccess(getDb(), userId, studyId); });

/** Estudios de la persona (los mismos que usa activeStudyId; una consulta por petición). */
export const listMyStudies = (userId: string) => studiesFor(`${userId}|${requestEpoch()}`);

export async function activeStudyId(userId: string): Promise<{ id: string; name: string; role: string; access: MyAccess | null } | null> {
  const epoch = requestEpoch();
  const list = await studiesFor(`${userId}|${epoch}`);
  if (list.length === 0) return null;
  const wanted = (await cookies()).get("estudio_id")?.value;
  const s = list.find((x) => x.id === wanted) ?? list[0];
  return { ...s, access: await accessFor(`${userId}|${s.id}|${epoch}`) };
}

export async function loadAnalysis(requested: Mode | undefined): Promise<Loaded> {
  const user = await getUser();
  if (!user) {
    const params = demo.params as Params, mode = requested ?? "demo";
    const analysis = analyze(demo.positions as StaffingInput[], demo.activities as ActivityInput[], params, DEMO_THRESHOLDS, mode);
    return { analysis, dashboard: bare(analysis, params, DEMO_THRESHOLDS, mode, [...AREAS_14]), params, thresholds: DEMO_THRESHOLDS, mode, label: "Datos de demostración (ficticios) · inicie sesión para ver su estudio", source: "demo" };
  }
  const mode = requested ?? "real"; // el modo por defecto es REAL (brief §5.2)
  const empty = (label: string, source: Loaded["source"]): Loaded => {
    const analysis = analyze([], [], EMPTY_PARAMS, DEMO_THRESHOLDS, mode);
    return { analysis, dashboard: bare(analysis, EMPTY_PARAMS, DEMO_THRESHOLDS, mode, [...AREAS_14]), params: EMPTY_PARAMS, thresholds: DEMO_THRESHOLDS, mode, label, source };
  };
  try {
    const study = await activeStudyId(user.id);
    if (!study) return empty("Aún no tiene estudios: créelo en la sección Estudio", "sin-estudio");
    const d = await loadDashboard(getDb(), user.id, study.id, mode);
    return { analysis: d.analysis, dashboard: d.dashboard, params: d.params, thresholds: d.thresholds, mode, label: `Estudio: ${study.name}`, source: "estudio" };
  } catch {
    return empty("No se pudieron leer los datos del estudio", "error");
  }
}
