/**
 * Respaldo completo del estudio en Excel (brief §16.1 «Pérdida de datos: exportación completa a Excel»): una hoja por tabla de datos del estudio,
 * con los nombres técnicos de las columnas. Es una copia legible; la restauración técnica se hace con pg_dump/pg_restore (docs/runbook.md).
 * Todo pasa por withRls(): quien no pertenece al estudio no obtiene nada.
 */
import { eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { withRls, type Db } from "../db/client";
import {
  actionItems, activities, areas, deviations, improvementOpportunities, measurabilityAssessments, measurements, positions, redesignProposals, riskAssessments, sites,
  staffingEntries, studies, studyParameters, suitabilityAssessments,
} from "../db/schema";
import type { Cell, Table } from "../lib/export";

const TABLES: [string, PgTable][] = [
  ["Parámetros", studyParameters], ["Áreas", areas], ["Sedes", sites], ["Cargos", positions], ["Dotación", staffingEntries], ["Actividades", activities],
  ["5 Medibilidad", measurabilityAssessments], ["6 Pertinencia", suitabilityAssessments], ["7 Riesgos", riskAssessments], ["8 Oportunidades", improvementOpportunities],
  ["9 Rediseño", redesignProposals], ["10 Plan de acción", actionItems], ["Mediciones", measurements], ["Desviaciones", deviations],
];

const cellOf = (v: unknown): Cell => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 30000);
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) && s.length < 16 ? Number(s) : s.slice(0, 30000);
};

/** Devuelve null si la persona no tiene acceso al estudio. */
export async function buildBackup(db: Db, sub: string, studyId: string): Promise<{ name: string; tables: Table[] } | null> {
  return withRls(db, { sub }, async (tx) => {
    const [st] = await tx.select({ name: studies.name, createdAt: studies.createdAt }).from(studies).where(eq(studies.id, studyId));
    if (!st) return null;
    const tables: Table[] = [{
      name: "Léame", columns: [{ key: "t", header: "Respaldo del estudio", width: 120 }],
      rows: [`Estudio: ${st.name}`, `Generado: ${new Date().toISOString()}`, "Copia legible de los datos del estudio (una hoja por tabla, nombres técnicos de columna).",
        "No incluye la bitácora ni las fotos del tablero. Para restaurar la base completa use pg_dump / pg_restore (ver docs/runbook.md).", "Contiene datos laborales: guárdela cifrada y compártala solo con quien deba verla."].map((t) => ({ t })),
    }];
    for (const [name, table] of TABLES) {
      const cols = getTableColumns(table) as Record<string, Parameters<typeof eq>[0]>;
      const rows = (await tx.select().from(table).where(eq(cols.studyId, studyId))) as Record<string, unknown>[];
      const keys = Object.keys(cols);
      tables.push({ name, columns: keys.map((k) => ({ key: k, header: k, width: 18 })), rows: rows.map((r) => Object.fromEntries(keys.map((k) => [k, cellOf(r[k])]))) });
    }
    return { name: st.name, tables };
  });
}
