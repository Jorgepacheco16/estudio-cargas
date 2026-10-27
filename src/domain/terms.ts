/**
 * Términos de la pantalla (D-74). El libro de Excel dice «sede» o «punto de venta»; en la compañía el lugar de trabajo se llama «centro de operaciones»
 * (CO). Esta función adapta los textos que vienen del libro (encabezados y ayudas de los formularios). NO se aplica a los valores de las listas
 * desplegables ni a los encabezados de la hoja de Google: esos siguen idénticos al libro para que la hoja y la aplicación coincidan.
 */
export const CO = "Centro de operaciones";

/** Frases del libro cuyo género o concordancia no se resuelve con una regla general. */
const EXACT: Record<string, string> = {
  "Punto de venta, sede o centro de operación": `${CO} (CO)`,
  "Sede / punto de venta": `${CO} (CO)`,
  "Mismo nombre de cargo en todas las sedes para poder compararlas": "Mismo nombre de cargo en todos los centros de operaciones para poder compararlo",
};

export function ui(s: string): string {
  if (EXACT[s]) return EXACT[s];
  return s
    .replace(/\btodas las sedes\b/g, "todos los centros de operaciones").replace(/\bTodas las sedes\b/g, "Todos los centros de operaciones")
    .replace(/\bunas? sola sede\b/g, "un solo centro de operaciones")
    .replace(/\blas sedes\b/g, "los centros de operaciones").replace(/\bLas sedes\b/g, "Los centros de operaciones")
    .replace(/\bSedes\b/g, "Centros de operaciones").replace(/\bsedes\b/g, "centros de operaciones")
    .replace(/\bSede\b/g, CO)
    .replace(/\b(en|de|por|a|con|para) la sede\b/g, "$1 el centro de operaciones")
    .replace(/\b(en|de) esa sede\b/g, "$1 ese centro de operaciones")
    .replace(/\buna sede\b/g, "un centro de operaciones")
    .replace(/\bla sede\b/g, "el centro de operaciones")
    .replace(/\bsede\b/g, "centro de operaciones");
}
