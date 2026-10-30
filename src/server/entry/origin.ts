/**
 * Área, centro de operaciones y cargo de oportunidades, rediseño y plan de acción (D-90). Estos registros deben quedar amarrados a lo que los generó:
 *  · una oportunidad (hoja 8) con «Actividad relacionada» toma el área, el centro y el cargo de esa actividad;
 *  · una acción del plan (hoja 10) cuyo «Hallazgo u oportunidad de origen» es el código de una oportunidad toma los de esa oportunidad;
 *  · sin origen, la persona los escribe, y siempre deben ser un cargo ya registrado en Cargos y dotación (mismo tipo de dato, área y centro).
 * Si la persona escribe un valor distinto al del origen, no se guarda y se le dice cuál es el del origen. Esto es lo que permitirá restringir el acceso por área.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { activities, areas, improvementOpportunities, positions, sites } from "../../db/schema";
import { norm } from "../../domain/engine";
import { SITE_COL, type EntryDef } from "./defs";

const LINKED = ["8", "9", "10"];
/** El primer cargo de un texto con varios («Fiscal de caja; Auxiliar de domicilios»): el cargo principal. */
export const firstPosition = (s: string) => s.split(/[;\n]/)[0].trim().replace(/\s+/g, " ");

interface Origin { what: string; code: string; area: string; site: string; position: string }

async function findOrigin(tx: Tx, studyId: string, def: EntryDef, raw: Record<string, string>): Promise<Origin | null> {
  const col = (f: string) => def.fields.find((x) => x.field === f)?.col;
  if (def.id === "8") {
    const code = (raw[col("activityCode") ?? ""] ?? "").trim();
    if (!code) return null;
    const [a] = await tx.select({ code: activities.code, area: areas.name, site: sites.name, position: positions.name })
      .from(activities).innerJoin(positions, eq(positions.id, activities.positionId)).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(and(eq(activities.studyId, studyId), sql`lower(btrim(${activities.code})) = ${code.toLowerCase()}`));
    return a ? { what: "la actividad", ...a } : null;
  }
  if (def.id === "10") {
    const code = (raw[col("finding") ?? ""] ?? "").trim();
    if (!code) return null;
    const [o] = await tx.select({ code: improvementOpportunities.code, area: areas.name, site: sites.name, position: improvementOpportunities.positionName })
      .from(improvementOpportunities).leftJoin(areas, eq(areas.id, improvementOpportunities.areaId)).leftJoin(sites, eq(sites.id, improvementOpportunities.siteId))
      .where(and(eq(improvementOpportunities.studyId, studyId), sql`lower(btrim(${improvementOpportunities.code})) = ${code.toLowerCase()}`));
    return o ? { what: "la oportunidad", code: o.code, area: o.area ?? "", site: o.site ?? "", position: o.position ?? "" } : null;
  }
  return null;
}

/**
 * Completa el área, el centro de operaciones y el cargo desde el origen (si los dejó en blanco), avisa si no coinciden con los del origen y comprueba que el
 * cargo exista en Cargos y dotación. Devuelve los valores completados y los errores. Las hojas que no son 8, 9 o 10 pasan sin cambios.
 */
export async function applyOrigin(tx: Tx, studyId: string, def: EntryDef, raw: Record<string, string>): Promise<{ raw: Record<string, string>; errors: string[] }> {
  if (!LINKED.includes(def.id)) return { raw, errors: [] };
  const col = (f: string) => def.fields.find((x) => x.field === f)!.col;
  const cArea = col("area"), cPos = col("position"), cKind = def.fields.find((x) => x.field === "kind")?.col;
  const head = (c: string) => def.fields.find((x) => x.col === c)?.header ?? c;
  const out = { ...raw }, errors: string[] = [];
  const val = (c: string) => (out[c] ?? "").trim().replace(/\s+/g, " ");

  const origin = await findOrigin(tx, studyId, def, raw);
  if (origin) {
    for (const [c, want, isPos] of [[cArea, origin.area, false], [SITE_COL, origin.site, false], [cPos, firstPosition(origin.position), true]] as const) {
      if (!want) continue;
      const cur = val(c);
      if (cur === "") out[c] = want;
      else if (norm(isPos ? firstPosition(cur) : cur) !== norm(want)) errors.push(`${head(c)}: «${cur.slice(0, 60)}» no coincide con el de ${origin.what} ${origin.code} («${want.slice(0, 60)}»). Déjelo en blanco para tomarlo de allí.`);
    }
  }
  if (errors.length) return { raw: out, errors };

  const [area, site, position] = [val(cArea), val(SITE_COL), firstPosition(val(cPos))];
  if (area && site && position) {
    const kind = cKind && norm(out[cKind] ?? "") === "demo" ? "demo" : "real";
    const [p] = await tx.select({ id: positions.id }).from(positions).innerJoin(areas, eq(areas.id, positions.areaId)).innerJoin(sites, eq(sites.id, positions.siteId))
      .where(and(eq(positions.studyId, studyId), eq(positions.dataKind, kind), sql`lower(btrim(${areas.name})) = ${norm(area)}`, sql`lower(btrim(${sites.name})) = ${norm(site)}`, sql`lower(btrim(${positions.name})) = ${norm(position)}`));
    if (!p) errors.push(`${head(cPos)}: «${position.slice(0, 60)}» no está registrado en el área «${area.slice(0, 60)}» y el centro de operaciones «${site.slice(0, 60)}». Regístrelo primero en Cargos y dotación.`);
  }
  return { raw: out, errors };
}
