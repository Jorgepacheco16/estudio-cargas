/**
 * Filtros de las secciones (D-74). Selección múltiple: cada filtro admite varios valores (la fila pasa si su valor es UNO de los elegidos) y todos los
 * filtros activos se combinan con «y». Un filtro sin valores no filtra. Viajan en la dirección de la página (`?co=A&co=B&area=Cajas`), así que se pueden
 * compartir y las exportaciones los respetan. Funciones puras: no dependen de la base de datos.
 */
export type Filters = Record<string, string[]>;
export interface FacetOption { value: string; label: string }
export interface FilterField { key: string; label: string; options: FacetOption[] }

/** Claves comunes: centro de operaciones, área y cargo. `q` es la búsqueda por texto. */
export const BASIC_KEYS = ["co", "area", "cargo"] as const;
export const SEARCH_KEY = "q";
export const BASIC_LABELS: Record<(typeof BASIC_KEYS)[number], string> = { co: "Centro de operaciones", area: "Área", cargo: "Cargo" };

type Params = Record<string, string | string[] | undefined>;
const many = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => x.trim()).filter(Boolean);

/** Lee de la dirección los filtros de `keys` (valores repetidos) y la búsqueda. Los valores se limitan en cantidad y largo. */
export function readFilters(sp: Params, keys: readonly string[], withSearch = false): Filters {
  const out: Filters = {};
  for (const k of keys) { const v = [...new Set(many(sp[k]))].slice(0, 200).map((x) => x.slice(0, 120)); if (v.length) out[k] = v; }
  if (withSearch) { const q = many(sp[SEARCH_KEY])[0]; if (q) out[SEARCH_KEY] = [q.slice(0, 80)]; }
  return out;
}

/** Cuántos filtros hay activos (la búsqueda cuenta como uno). */
export const activeCount = (f: Filters) => Object.values(f).filter((v) => v.length > 0).length;

/** Pares clave=valor para armar una dirección (se repite la clave por cada valor). */
export function filterQuery(f: Filters): string {
  return Object.entries(f).flatMap(([k, vs]) => vs.map((v) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)).join("&");
}

/** Texto sin tildes y en minúsculas, para la búsqueda. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * ¿La fila cumple los filtros? `get` entrega el valor de cada clave; `search` el texto donde se busca (todas las palabras deben aparecer).
 */
export function passes<T>(row: T, f: Filters, get: Record<string, (r: T) => string>, search?: (r: T) => string): boolean {
  for (const [k, vs] of Object.entries(f)) {
    if (!vs.length || k === SEARCH_KEY) continue;
    const g = get[k];
    if (g && !vs.includes(g(row))) return false;
  }
  const q = f[SEARCH_KEY]?.[0];
  if (q && search) { const hay = fold(search(row)); if (!fold(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false; }
  return true;
}

/** Opciones únicas (sin vacíos), ordenadas en español o según `order` (los que no estén en `order` van al final, ordenados). */
export function optionsOf(values: string[], order?: string[], labels?: Record<string, string>): FacetOption[] {
  const uniq = [...new Set(values.filter((v) => v !== ""))];
  const rank = (v: string) => { const i = order ? order.indexOf(v) : -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  uniq.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "es"));
  return uniq.map((value) => ({ value, label: labels?.[value] ?? value }));
}

export interface Triple { co: string; area: string; cargo: string }
/**
 * Opciones dependientes: el área ofrece solo las de los centros elegidos y el cargo solo los de los centros y áreas elegidos.
 * `sel` son las selecciones actuales; sin selección en un nivel, ese nivel no restringe.
 */
export function dependentOptions(triples: Triple[], sel: { co?: string[]; area?: string[] }): { co: string[]; area: string[]; cargo: string[] } {
  const u = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const byCo = triples.filter((t) => !sel.co?.length || sel.co.includes(t.co));
  const byArea = byCo.filter((t) => !sel.area?.length || sel.area.includes(t.area));
  return { co: u(triples.map((t) => t.co)), area: u(byCo.map((t) => t.area)), cargo: u(byArea.map((t) => t.cargo)) };
}
