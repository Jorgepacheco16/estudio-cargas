import { activeCount, dependentOptions, filterQuery, fold, optionsOf, passes, readFilters } from "../src/domain/filters";
import { check, summary } from "./helpers";

/** Filtros de las secciones (D-74): lectura de la dirección, selección múltiple, combinación, búsqueda y opciones dependientes. Funciones puras. */
interface Row { co: string; area: string; cargo: string; estado: string; text: string }
const rows: Row[] = [
  { co: "CO 101 Prado", area: "Cajas", cargo: "Cajero", estado: "ok", text: "Arqueo de caja" },
  { co: "CO 101 Prado", area: "Cajas", cargo: "Fiscal", estado: "low", text: "Apertura de tienda" },
  { co: "CO 102 Norte", area: "Cajas", cargo: "Cajero", estado: "ok", text: "Cierre de caja" },
  { co: "CO 102 Norte", area: "Domicilios", cargo: "Auxiliar", estado: "low", text: "Entrega de pedidos" },
];
const get = { co: (r: Row) => r.co, area: (r: Row) => r.area, cargo: (r: Row) => r.cargo, estado: (r: Row) => r.estado };
const pick = (f: ReturnType<typeof readFilters>) => rows.filter((r) => passes(r, f, get, (x) => `${x.text} ${x.cargo}`)).map((r) => `${r.co.slice(3, 6)}/${r.cargo}`).join(" ");

async function main() {
  await check("Lectura de la dirección: valores repetidos o únicos, sin duplicados ni vacíos; solo las claves pedidas; la búsqueda aparte", () => {
    const f = readFilters({ co: ["A", "B", "A", " "], area: "Cajas", otra: "x", q: " apertura  " }, ["co", "area", "cargo"], true);
    if (JSON.stringify(f) !== JSON.stringify({ co: ["A", "B"], area: ["Cajas"], q: ["apertura"] })) throw new Error(JSON.stringify(f));
    if (activeCount(f) !== 3 || activeCount({}) !== 0) throw new Error("conteo");
    if (readFilters({ q: "x" }, ["co"], false).q) throw new Error("leyó la búsqueda sin pedirla");
  });

  await check("Selección múltiple: una fila pasa si su valor es UNO de los elegidos; sin filtros pasan todas", () => {
    if (pick({}) !== "101/Cajero 101/Fiscal 102/Cajero 102/Auxiliar") throw new Error(pick({}));
    if (pick({ co: ["CO 101 Prado", "CO 102 Norte"] }).split(" ").length !== 4) throw new Error("dos centros = todas");
    if (pick({ cargo: ["Cajero", "Auxiliar"] }) !== "101/Cajero 102/Cajero 102/Auxiliar") throw new Error(pick({ cargo: ["Cajero", "Auxiliar"] }));
  });

  await check("Filtros combinados con «y», y la búsqueda exige todas las palabras sin importar tildes ni mayúsculas", () => {
    if (pick({ co: ["CO 102 Norte"], estado: ["low"] }) !== "102/Auxiliar") throw new Error(pick({ co: ["CO 102 Norte"], estado: ["low"] }));
    if (pick({ q: ["CAJA arqueo"] }) !== "101/Cajero") throw new Error(pick({ q: ["CAJA arqueo"] }));
    if (pick({ q: ["cierre"], area: ["Domicilios"] }) !== "") throw new Error("y entre búsqueda y filtro");
    if (fold("Descripción ÚNICA") !== "descripcion unica") throw new Error("fold");
  });

  await check("Opciones: únicas, sin vacíos, en el orden pedido (o alfabético) y con etiquetas", () => {
    const o = optionsOf(["Baja", "Crítica", "Alta", "", "Alta"], ["Crítica", "Alta", "Media", "Baja"], { "Crítica": "Crítica (urgente)" });
    if (o.map((x) => x.value).join() !== "Crítica,Alta,Baja" || o[0].label !== "Crítica (urgente)") throw new Error(JSON.stringify(o));
    if (optionsOf(["b", "a", "á"]).map((x) => x.value).join() !== "a,á,b") throw new Error("alfabético");
  });

  await check("Opciones dependientes: el área solo ofrece las del centro elegido; el cargo, las del centro y área elegidos", () => {
    const t = rows.map((r) => ({ co: r.co, area: r.area, cargo: r.cargo }));
    const all = dependentOptions(t, {}); if (all.co.length !== 2 || all.area.join() !== "Cajas,Domicilios" || all.cargo.length !== 3) throw new Error(JSON.stringify(all));
    const norte = dependentOptions(t, { co: ["CO 102 Norte"] }); if (norte.area.join() !== "Cajas,Domicilios" || norte.cargo.join() !== "Auxiliar,Cajero") throw new Error(JSON.stringify(norte));
    const prado = dependentOptions(t, { co: ["CO 101 Prado"] }); if (prado.area.join() !== "Cajas" || prado.cargo.join() !== "Cajero,Fiscal") throw new Error(JSON.stringify(prado));
    const dom = dependentOptions(t, { co: ["CO 102 Norte"], area: ["Domicilios"] }); if (dom.cargo.join() !== "Auxiliar") throw new Error(JSON.stringify(dom));
  });

  await check("La dirección se arma repitiendo la clave por cada valor y codifica los caracteres especiales", () => {
    const q = filterQuery({ co: ["CO 101 Prado", "CO 102 Norte"], q: ["a&b"] });
    if (q !== "co=CO%20101%20Prado&co=CO%20102%20Norte&q=a%26b") throw new Error(q);
  });
}
main().then(summary);
