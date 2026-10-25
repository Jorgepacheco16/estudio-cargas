/** Palabras en mayúsculas que se conservan: nombres de modo y siglas (el valor almacenado nunca cambia; esto es solo presentación). */
const KEEP = new Set(["DEMO", "REAL", "REALES", "TODOS", "COP", "CSV", "PDF", "KPI", "IA"]);

/**
 * Presenta un texto en estilo oración: las palabras de 3 o más letras escritas en mayúsculas pasan a minúscula (salvo siglas y nombres de modo),
 * «Parametros» se muestra con su tilde y la primera letra va en mayúscula. No cambia el significado ni ningún dato guardado.
 */
export function sentenceCase(s: string): string {
  const t = s
    .replace(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/g, (w) => (KEEP.has(w) ? w : w.toLowerCase()))
    .replace(/\bParametros\b/g, "Parámetros");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
