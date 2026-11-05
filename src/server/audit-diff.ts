/**
 * Qué guarda el registro de cambios cuando se ELIMINA un registro (D-96): los campos que tenía, como «antes → vacío». Así se sabe qué era y a qué área, cargo o actividad
 * pertenecía (el disparador de audit_log lee de aquí cuando el registro ya no existe). No se guardan los campos técnicos.
 */
const TECHNICAL = new Set(["id", "studyId", "version", "createdAt", "updatedAt", "createdBy", "updatedBy"]);

export function deletedDiff(row: Record<string, unknown> | undefined): Record<string, { from: unknown; to: null }> | null {
  if (!row) return null;
  const out: Record<string, { from: unknown; to: null }> = {};
  for (const [k, v] of Object.entries(row)) {
    if (TECHNICAL.has(k) || v === null || v === undefined || v === "") continue;
    out[k] = { from: v instanceof Date ? v.toISOString() : v, to: null };
  }
  return Object.keys(out).length ? out : null;
}
