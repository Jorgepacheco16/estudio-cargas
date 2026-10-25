/** Menú principal: orden, nombres visibles y rutas. Las etiquetas son lo único que ve la persona; las rutas y claves internas no cambian de significado. */
export const GRUPO_DIAGNOSTICO = "Diagnóstico y rediseño";

export interface NavLink { href: string; label: string }
export type NavEntry = NavLink | { group: string; items: NavLink[] };

export const MENU: NavEntry[] = [
  { href: "/", label: "Inicio" },
  { href: "/parametros", label: "Parámetros" },
  { href: "/estudio", label: "Estudio" },
  { href: "/cargos", label: "Cargos y dotación" },
  { href: "/actividades", label: "Actividades" },
  { href: "/calculo", label: "Cálculo de tiempos" },
  { href: "/drill", label: "Drill-down: Carga por áreas" },
  {
    group: GRUPO_DIAGNOSTICO,
    items: [
      { href: "/diagnostico/medibilidad", label: "Medibilidad" },
      { href: "/diagnostico/pertinencia", label: "Pertinencia" },
      { href: "/diagnostico/riesgos", label: "Riesgos" },
      { href: "/diagnostico/oportunidades", label: "Oportunidades" },
      { href: "/diagnostico/rediseno", label: "Rediseño" },
      { href: "/diagnostico/plan-de-accion", label: "Plan de acción" },
    ],
  },
  { href: "/sedes", label: "Comparador sedes" },
  { href: "/historia", label: "Historia y desviaciones" },
  { href: "/integraciones", label: "Integraciones" },
  { href: "/agente", label: "Agente de IA" },
];

export const isActive = (path: string, href: string) => path === href || (href !== "/" && path.startsWith(href + "/"));