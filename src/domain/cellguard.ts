/** Salvaguardas de celdas que llegan de una hoja de cálculo (brief §12.5 y §13). Puro. */

/** Texto que una hoja de cálculo ejecutaría como fórmula (=, +, -, @ al inicio). Un número negativo o con signo no cuenta. */
export const looksLikeFormula = (s: string) => /^[=+\-@]/.test(s.trimStart()) && !/^[+-]?\d+([.,]\d+)?%?$/.test(s.trim());

/** Tope de correcciones automáticas por lote (D-19, propuesta del brief): por encima se pide confirmación antes de aplicar. */
export const AUTOFIX_BATCH_LIMIT = 50;
