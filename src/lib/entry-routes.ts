/** Dónde vive cada formulario de captura (sección del menú). Solo rutas: sin acceso a datos, para poder usarlo también en next.config. */
export const ENTRY_BASE: Record<string, string> = {
  "2": "/cargos",
  "3": "/actividades",
  "5": "/diagnostico/medibilidad",
  "6": "/diagnostico/pertinencia",
  "7": "/diagnostico/riesgos",
  "8": "/diagnostico/oportunidades",
  "9": "/diagnostico/rediseno",
  "10": "/diagnostico/plan-de-accion",
};
export const PARAMETROS_PATH = "/parametros";
export const basePath = (id: string) => ENTRY_BASE[id] ?? "/";
/** Subsección de Diagnóstico y rediseño (último tramo de la ruta) → identificador de la hoja de captura. */
export const DIAGNOSTICO_SLUG: Record<string, string> = Object.fromEntries(Object.entries(ENTRY_BASE).filter(([, p]) => p.startsWith("/diagnostico/")).map(([id, p]) => [p.split("/")[2], id]));

/** Redirecciones desde las rutas anteriores («Datos de entrada»), para no romper enlaces guardados. */
export const LEGACY_REDIRECTS = [
  { source: "/datos", destination: "/cargos" },
  { source: "/datos/parametros", destination: PARAMETROS_PATH },
  ...Object.entries(ENTRY_BASE).flatMap(([id, to]) => [
    { source: `/datos/${id}`, destination: to },
    { source: `/datos/${id}/nuevo`, destination: `${to}/nuevo` },
    { source: `/datos/${id}/:rec`, destination: `${to}/:rec` },
  ]),
];