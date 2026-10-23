/** Autocorrector: SOLO correcciones deterministas y reversibles. Nunca inventa datos ni rellena vacíos. */
export interface Fix { field: string; from: unknown; to: unknown; rule: "TRIM" | "DECIMAL_COMMA" | "LIST_CASE_ACCENT" | "LIST_FUZZY"; confidence: number; auto: boolean }
const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/** "6,5" → 6.5 ; "1.234,5" → 1234.5 ; "12 %" → null (los porcentajes se tratan con parsePercent). */
export function parseDecimalEs(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$|^-?\d+(\.\d+)?$/.test(t)) return null;
  const v = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(v) ? v : null;
}
export function parsePercent(raw: string): number | null {
  const m = raw.trim().match(/^(.+?)\s*%$/); if (!m) return null; const v = parseDecimalEs(m[1]); return v === null ? null : v / 100;
}
const lev = (a: string, b: string) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };

/** Empareja un texto con una lista desplegable. Solo mayúsculas/acentos/espacios se corrigen solos; el parecido (fuzzy) se SUGIERE. */
export function matchList(value: string, list: readonly string[]): { match: string | null; rule: Fix["rule"] | "EXACT" | "NONE"; confidence: number } {
  if (list.includes(value)) return { match: value, rule: "EXACT", confidence: 1 };
  const k = strip(value); const hit = list.find((x) => strip(x) === k);
  if (hit) return { match: hit, rule: "LIST_CASE_ACCENT", confidence: 1 };
  const best = list.map((x) => ({ x, d: lev(strip(x), k) })).sort((a, b) => a.d - b.d)[0];
  if (best && best.d <= 2 && k.length >= 4) return { match: best.x, rule: "LIST_FUZZY", confidence: 1 - best.d / Math.max(k.length, 1) };
  return { match: null, rule: "NONE", confidence: 0 };
}
export const isAutoApplicable = (r: ReturnType<typeof matchList>) => r.rule === "LIST_CASE_ACCENT";

/** Duplicados por clave normalizada → posiciones (1-based) de cada fila repetida. Nunca se borran automáticamente. */
export function findDuplicates(keys: readonly (string | null)[]): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  keys.forEach((k, i) => { if (k && k.trim()) { const n = strip(k); seen.set(n, [...(seen.get(n) ?? []), i + 1]); } });
  return new Map([...seen].filter(([, v]) => v.length > 1));
}
export const emptyRequired = <T extends Record<string, unknown>>(row: T, required: readonly (keyof T)[]) =>
  required.filter((f) => row[f] === null || row[f] === undefined || (typeof row[f] === "string" && !(row[f] as string).trim()));
